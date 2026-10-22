import AppKit
import SwiftUI

// Recipes on a talk's page: the app's and your own, run in a click from a row of chips
// or the header's menu. What one writes opens in a dialog to copy, save to Notes or run
// again; the follow-up email also opens in Mail, to the people invited.

/// A recipe to run, for the dialog that runs it.
struct RecipeRun: Identifiable {
    let id = UUID()
    let recipe: TalkRecipe
}

/// A recipe of yours to write or change; nil for a new one.
struct RecipeEdit: Identifiable {
    let id = UUID()
    var recipe: TalkRecipe?
}

/// The recipes as chips. Your own are changed or deleted from their menu (right-click).
struct RecipeChips: View {
    @ObservedObject private var book = RecipeBook.shared
    let onRun: (TalkRecipe) -> Void
    let onEdit: (TalkRecipe?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle("Recipes · one click to write it from this talk")
            FlowLayout(spacing: 6, alignment: .leading) {
                ForEach(book.all) { recipe in
                    PillButton(icon: recipe.icon ?? "sparkle", title: recipe.name) { onRun(recipe) }
                        .help(recipe.prompt)
                        .contextMenu {
                            if !recipe.isBuiltIn {
                                Button("Edit…") { onEdit(recipe) }
                                Button("Delete", role: .destructive) { book.delete(recipe.id) }
                            }
                        }
                }
                PillButton(icon: "plus", title: "Your own…") { onEdit(nil) }
                    .help("A recipe of your own: a name, and what to write")
            }
        }
    }
}

/// "Recipes" in the talk's header: every recipe, and making your own.
struct RecipesMenu: View {
    let onRun: (TalkRecipe) -> Void
    let onEdit: (TalkRecipe?) -> Void

    var body: some View {
        MenuButton(help: "Write something from this talk: a follow-up email, the decisions…", align: .trailing, entries: {
            let book = RecipeBook.shared
            var entries: [MenuEntry] = TalkRecipe.builtIn.map { r in .item(r.name, icon: r.icon) { onRun(r) } }
            if !book.custom.isEmpty {
                entries.append(.divider)
                entries += book.custom.map { r in .item(r.name, icon: "sparkle") { onRun(r) } }
            }
            entries.append(.divider)
            entries.append(.item("New recipe…", icon: "plus") { onEdit(nil) })
            if !book.custom.isEmpty {
                entries.append(.menu("Edit your recipes", book.custom.map { r in .item(r.name) { onEdit(r) } }))
            }
            return entries
        }) {
            RecipesLabel()
        }
    }
}

private struct RecipesLabel: View {
    @Environment(\.palette) private var p
    @Environment(\.menuIsOpen) private var open
    @State private var hovering = false

    var body: some View {
        let lit = hovering || open
        HStack(spacing: 8) {
            Icon("sparkle", size: 16)
            Text("Recipes")
            Icon("chevronDown", size: 12).foregroundStyle(p.textMuted)
        }
        .font(FN.font(14, .medium))
        .foregroundStyle(p.foreground)
        .padding(.horizontal, 14)
        .frame(height: 36)
        .background(lit ? p.surfaceMuted : p.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))
        .motion(lit, Motion.quick)
        .contentShape(Capsule())
        .onHover { hovering = $0 }
    }
}

// MARK: - What a recipe wrote

struct RecipeSheet: View {
    @Environment(\.palette) private var p
    @Environment(\.closeModal) private var closeModal
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var engine: AIEngine
    @EnvironmentObject private var toasts: ToastCenter
    let recipe: TalkRecipe
    let talkId: String

    @State private var text = ""
    @State private var by: LiveAnswer.By?
    @State private var running = false
    @State private var problem: String?
    @State private var run: Task<Void, Never>?

    private var talk: Talk? { TalkStore.shared.talk(talkId) }

    var body: some View {
        VStack(spacing: 0) {
            ModalTitleBar(recipe.name)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if running {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Writing it from the talk…")
                        }
                        .font(FN.body).foregroundStyle(p.textSecondary)
                    } else if let problem {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Icon("warning", size: 14)
                            Text(problem).fixedSize(horizontal: false, vertical: true)
                        }
                        .font(FN.body).foregroundStyle(p.danger)
                    } else {
                        TalkRichText.text(text)
                            .font(FN.font(15))
                            .lineSpacing(4)
                            .foregroundStyle(p.foreground)
                            .tint(p.foreground)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
            .frame(minHeight: 200, maxHeight: 460)
            Rectangle().fill(p.borderSubtle).frame(height: 1)
            HStack(spacing: 8) {
                if let by, !running {
                    if by.onThisMac { OnDeviceMark(origin: .onDevice, name: by.name) } else { CloudMark(name: by.name) }
                }
                Spacer(minLength: 0)
                KitButton(kind: .plain, title: "Run again", icon: "refresh", small: true, disabled: running) { start() }
                KitButton(kind: .secondary, title: "Copy", icon: "copy", small: true, disabled: running || text.isEmpty) { copy() }
                KitButton(kind: recipe.isEmail ? .secondary : .primary, title: "Save to Notes", icon: "noteAdd",
                          small: true, disabled: running || text.isEmpty) { save() }
                if recipe.isEmail {
                    KitButton(kind: .primary, title: "Write email", icon: "send", small: true, disabled: running || text.isEmpty) { email() }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        .frame(width: 600)
        .onAppear { start() }
        .onDisappear { run?.cancel() }
    }

    private func start() {
        run?.cancel()
        guard let talk else { return }
        // Your own recipe is your words to the model: refused here as the assistant's chat is.
        if !recipe.isBuiltIn, let refusal = Guard.blockedReply(recipe.prompt, tier: engine.chatRunsOnDevice ? .local : .cloud) {
            problem = refusal
            return
        }
        running = true
        problem = nil
        run = Task {
            defer { running = false }
            do {
                let (written, who) = try await engine.runRecipe(recipe, on: talk)
                text = written
                by = who
            } catch is CancellationError {
            } catch {
                problem = AIEngine.reason(error)
            }
        }
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        toasts.push("Copied")
    }

    private func save() {
        guard let talk else { return }
        let n = store.addNote {
            $0.title = "\(recipe.name): \(talk.title)"
            $0.content = text
            $0.source = .recording
            $0.tags = ["talk"]
        }
        close()
        toasts.push("📝 Saved to Notes", action: .init(label: "Open") {
            AppModel.shared.nav.open(ChangeLink(kind: .notes, id: n.id))
        })
    }

    private func email() {
        guard let talk else { return }
        if !TalkRecipes.compose(text, title: talk.title, attendees: talk.event?.attendees ?? []) {
            toasts.push("Mail couldn't open a new message. Copy the email instead.", tone: .error)
        }
    }

    private func close() {
        if let closeModal { closeModal() } else { dismiss() }
    }
}

// MARK: - Your own recipe

struct RecipeEditor: View {
    @Environment(\.palette) private var p
    @Environment(\.closeModal) private var closeModal
    @Environment(\.dismiss) private var dismiss
    let recipe: TalkRecipe?

    @State private var name = ""
    @State private var prompt = ""
    @FocusState private var promptFocused: Bool

    private var ready: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ModalTitleBar(recipe == nil ? "New recipe" : "Edit recipe")
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Name").font(FN.bodyMedium).foregroundStyle(p.foreground)
                    BoxedField(placeholder: "Pricing feedback", text: $name)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("What to write").font(FN.bodyMedium).foregroundStyle(p.foreground)
                    TextEditor(text: $prompt)
                        .font(FN.body)
                        .foregroundStyle(p.foreground)
                        .scrollContentBackground(.hidden)
                        .focused($promptFocused)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(height: 140)
                        .background(p.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(promptFocused ? p.borderStrong : p.border, lineWidth: 1))
                        .accessibilityLabel("What to write")
                    Text("As you'd ask a colleague who was there: “List every price they mentioned, with who said it.”")
                        .font(FN.small).foregroundStyle(p.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    if let recipe {
                        KitButton(kind: .danger, title: "Delete") {
                            RecipeBook.shared.delete(recipe.id)
                            close()
                        }
                    }
                    Spacer(minLength: 0)
                    KitButton(kind: .plain, title: "Cancel") { close() }
                    KitButton(kind: .primary, title: "Save", disabled: !ready) {
                        RecipeBook.shared.save(id: recipe?.id, name: name, prompt: prompt)
                        close()
                    }
                }
            }
            .padding(20)
        }
        .frame(width: 520)
        .onAppear {
            name = recipe?.name ?? ""
            prompt = recipe?.prompt ?? ""
        }
    }

    private func close() {
        if let closeModal { closeModal() } else { dismiss() }
    }
}
