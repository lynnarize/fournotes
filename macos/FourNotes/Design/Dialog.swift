import SwiftUI

// The kit's dialog pieces, as on the web (src/components/ui.tsx `Modal`,
// src/components/TypeToConfirm.tsx).

/// A dialog's title bar: the title, extra buttons, and close; a hairline under it.
struct ModalTitleBar<Actions: View>: View {
    @Environment(\.palette) private var p
    @Environment(\.closeModal) private var closeModal
    @Environment(\.dismiss) private var dismiss
    let title: String
    @ViewBuilder var actions: () -> Actions

    init(_ title: String, @ViewBuilder actions: @escaping () -> Actions = { EmptyView() }) {
        self.title = title
        self.actions = actions
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(title)
                    .font(FN.font(15, .medium))
                    .foregroundStyle(p.foreground)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                actions()
                // `.btn .btn-plain .btn-icon`
                IconButton("x", size: 18, box: 36, help: "Close") {
                    if let closeModal { closeModal() } else { dismiss() }
                }
            }
            .padding(.leading, 20)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            Rectangle().fill(p.borderSubtle).frame(height: 1)
        }
        .background(p.surface)
    }
}

/// Confirmation for actions that permanently delete data: the button stays disabled
/// until the confirmation word is typed, so it can't be done by a stray click.
struct TypeToConfirm<Message: View>: View {
    @Environment(\.palette) private var p
    @Environment(\.closeModal) private var closeModal
    @Environment(\.dismiss) private var dismiss
    let title: String
    var word = "delete"
    let confirmLabel: String
    let onConfirm: () -> Void
    /// What will be deleted and what is kept.
    @ViewBuilder var message: () -> Message

    @State private var typed = ""
    @FocusState private var focused: Bool

    private var ready: Bool { typed.trimmingCharacters(in: .whitespaces).lowercased() == word.lowercased() }

    var body: some View {
        VStack(spacing: 0) {
            ModalTitleBar(title)
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    Icon("trash", size: 18)
                        .foregroundStyle(p.danger)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 6) { message() }
                        .font(FN.body)
                        .lineSpacing(5)
                        .foregroundStyle(p.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(16)
                .background(p.dangerSubtle, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Type \(Text(word).font(FN.bodyMedium).foregroundStyle(p.foreground)) to confirm")
                        .font(FN.body)
                        .foregroundStyle(p.textSecondary)
                    // `.field .field-lg`
                    TextField("", text: $typed)
                        .textFieldStyle(.plain)
                        .font(FN.body)
                        .foregroundStyle(p.foreground)
                        .focused($focused)
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                        .background(p.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .strokeBorder(focused ? p.borderStrong : p.border, lineWidth: 1))
                        .onSubmit(confirm)
                        .accessibilityLabel("Type \(word) to confirm")
                }

                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    KitButton(kind: .plain, title: "Cancel", action: close)
                    KitButton(kind: .primary, title: confirmLabel, tone: p.danger, disabled: !ready, action: confirm)
                }
            }
            .padding(20)
        }
        .frame(width: 512)
        .onAppear { focused = true }
    }

    private func close() {
        if let closeModal { closeModal() } else { dismiss() }
    }

    private func confirm() {
        guard ready else { return }
        onConfirm()
        close()
    }
}
