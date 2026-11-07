import SwiftUI

// Notes: a list beside a large editor, as on the web (src/components/NotesView.tsx).
// The list carries the tab's title, a search field and the notes; the open one sits
// on the accent wash.

private let SORTS: [(id: String, label: String)] = [
    ("updated", "Last edited"),
    ("created", "Date created"),
    ("title", "Title, A to Z"),
]

private let SOURCE_LABEL: [NoteSource: String] = [
    .manual: "", .chat: "From chat", .ocr: "Scanned", .recording: "Recording", .share: "Shared",
]

struct NotesView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation

    @AppStorage("fournotes.notesSort") private var sort = "updated"
    @AppStorage("fournotes.notesListHidden") private var listHidden = false

    @State private var query = ""
    @State private var cleanedUp = false
    /// All notes, or only the quick ones.
    @State private var show = "all"
    @FocusState private var searchFocused: Bool

    private var liveNotes: [Note] { store.liveNotes }

    private var quickCount: Int { liveNotes.filter(QuickNote.isQuick).count }

    private var list: [Note] {
        let liveNotes = show == "quick" ? self.liveNotes.filter(QuickNote.isQuick) : self.liveNotes
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else {
            switch sort {
            case "created": return liveNotes.sorted { $0.createdAt > $1.createdAt }
            case "title":
                return liveNotes.sorted {
                    ($0.title.isEmpty ? "Untitled" : $0.title)
                        .localizedCaseInsensitiveCompare($1.title.isEmpty ? "Untitled" : $1.title) == .orderedAscending
                }
            default: return liveNotes.sorted { $0.updatedAt > $1.updatedAt }
            }
        }
        // Instant substring filter, then keyword ranking behind it.
        let substring = liveNotes.filter {
            $0.title.lowercased().contains(q) || $0.content.lowercased().contains(q)
        }
        guard q.count >= 3 else { return substring }
        let ranked = Search.relevantNotes(for: q, in: liveNotes, openNoteId: nav.selectedNoteId, limit: 30)
        var out = ranked
        for n in substring where !out.contains(where: { $0.id == n.id }) { out.append(n) }
        return out
    }

    private var selected: Note? {
        if let id = nav.selectedNoteId, let n = liveNotes.first(where: { $0.id == id }) { return n }
        // A valid selection is held even when sorting or searching changes the
        // list. Only an id from another space or a deleted row falls through.
        return liveNotes.first
    }

    var body: some View {
        Group {
            if liveNotes.isEmpty {
                emptyState
            } else {
                HStack(alignment: .top, spacing: 12) {
                    if let note = selected {
                        NoteEditorView(
                            note: note,
                            listHidden: listHidden,
                            onToggleList: { listHidden.toggle() },
                            focusMode: nav.focusMode,
                            onToggleFocus: { nav.focusMode.toggle() })
                            .id(note.id)
                            .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
                            .paper(p)
                            .transition(.opacity.combined(with: .offset(x: -8)))
                    }
                    if !listHidden && !nav.focusMode {
                        listColumn
                            .frame(width: 360)
                            .frame(maxHeight: .infinity)
                            .paper(p)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                            // Above the editor, whose text slides under it.
                            .zIndex(1)
                    }
                }
                .frame(maxHeight: .infinity)
                .animation(Motion.screen, value: listHidden)
                .animation(Motion.screen, value: nav.focusMode)
                .animation(Motion.screen, value: selected?.id ?? "")
            }
        }
        .onAppear {
            cleanUpBlanks()
            if nav.selectedNoteId == nil { nav.selectedNoteId = list.first?.id }
        }
        .task(id: nav.focus) {
            guard let link = nav.consumeFocus([.notes]) else { return }
            query = ""
            nav.selectedNoteId = link.id
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Notes")
                .font(FN.display(28))
                .tracking(FN.displayTracking(28))
                .foregroundStyle(p.foreground)
            VStack(spacing: 16) {
                EmptyStart(
                    title: "No notes yet",
                    hint: "Start a note, photograph handwriting, record a voice note — or ask the assistant to write one.",
                    prompts: ["Note: weekend trip ideas",
                              "Summarize this: standup notes, ship Friday, Andi on QA"])
                PrimaryButton(title: "New note", icon: "noteAdd", action: newNote)
            }
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 28)
        .padding(.top, 28)
    }

    // MARK: - List

    /// The list carries the tab's title, as on the web: "Notes", sort and New, a search
    /// field, then the notes.
    private var listColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text("Notes")
                    .font(FN.font(24, .bold))
                    .tracking(-0.6)
                    .foregroundStyle(p.foreground)
                    .help("\(liveNotes.count) note\(liveNotes.count == 1 ? "" : "s")")
                Spacer()
                IconMenu("sort", size: 18, box: 34, help: "Sort notes") {
                    SORTS.map { option in
                        .item(option.label, checked: sort == option.id) { sort = option.id }
                    }
                }
                Button(action: newNote) {
                    Icon("plus", size: 16)
                        .foregroundStyle(p.accentForeground)
                        .frame(width: 34, height: 34)
                        .background(p.accent, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.fn)
                .help("New note (⌘N)")
                .accessibilityLabel("New note")
            }
            .padding(.top, 24)
            .padding(.bottom, 12)

            HStack(spacing: 8) {
                Icon("search", size: 16).foregroundStyle(p.textMuted)
                TextField("", text: $query, prompt: Text("Search notes").foregroundStyle(p.textMuted))
                    .textFieldStyle(.plain)
                    .font(FN.font(16))
                    .foregroundStyle(p.foreground)
                    .focused($searchFocused)
                    .onExitCommand { query = ""; searchFocused = false }
                if !query.isEmpty {
                    IconButton("x", size: 12, box: 22, help: "Clear") { query = "" }
                        .transition(.opacity)
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .frame(height: 36)
            .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
                .strokeBorder(searchFocused ? p.borderStrong : p.border, lineWidth: 1))
            .motion(searchFocused, Motion.quick)
            .padding(.bottom, 12)

            if quickCount > 0 || show == "quick" {
                SegmentedTabs(items: [("all", "All"), ("quick", "Quick")], selection: $show, fill: true,
                              counts: ["all": liveNotes.count, "quick": quickCount])
                    .padding(.bottom, 4)
            }

            if query.trimmingCharacters(in: .whitespaces).count >= 3 {
                Text("Best matches first")
                    .font(FN.small)
                    .foregroundStyle(p.textMuted)
                    .padding(.horizontal, 12)
                    .padding(.top, -6)
                    .padding(.bottom, 6)
            }

            ScrollView {
                let rows = list
                let selectedID = selected?.id
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(groups(rows), id: \.label) { group in
                        // Listed under the month, as on the web: "This month", "Last month", "August".
                        if !group.label.isEmpty {
                            Text(group.label)
                                .font(FN.font(13, .semibold))
                                .foregroundStyle(p.textMuted)
                                .lineBox(13, 19.5)
                                .padding(.top, 18)
                                .padding(.bottom, 4)
                        }
                        ForEach(group.notes) { note in
                            noteCard(note, isSelected: note.id == selectedID)
                                .transition(.move(edge: .leading).combined(with: .opacity))
                        }
                    }
                    if !query.isEmpty && rows.isEmpty {
                        Text("No matching notes.")
                            .font(FN.body).foregroundStyle(p.textMuted)
                            .padding(.vertical, 24)
                    }
                }
                .animation(Motion.list, value: rows.map(\.id))
                .padding(.bottom, 24)
                // In the scroll view, so a raised row reaches 10pt past the column unclipped.
                .padding(.horizontal, 22)
            }
            .scrollIndicators(.never)
            .padding(.horizontal, -22)
        }
        .padding(.horizontal, 22)
        .animation(Motion.standard, value: query.isEmpty)
    }

    /// The notes under their month, newest first; one unlabelled group while searching
    /// or sorted by title.
    private func groups(_ rows: [Note]) -> [(label: String, notes: [Note])] {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty || sort == "title" { return rows.isEmpty ? [] : [("", rows)] }
        var out: [(label: String, notes: [Note])] = []
        for n in rows {
            let label = Self.monthGroup(sort == "created" ? n.createdAt : n.updatedAt)
            if out.last?.label == label { out[out.count - 1].notes.append(n) } else { out.append((label, [n])) }
        }
        return out
    }

    /// The heading a note is listed under: this month, last month, then the month's name.
    private static func monthGroup(_ iso: String, now: Date = Date()) -> String {
        guard let d = DateKit.date(iso) else { return "" }
        let cal = Calendar.current
        let back = (cal.component(.year, from: now) - cal.component(.year, from: d)) * 12
            + cal.component(.month, from: now) - cal.component(.month, from: d)
        if back <= 0 { return "This month" }
        if back == 1 { return "Last month" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = cal.component(.year, from: d) == cal.component(.year, from: now) ? "MMMM" : "MMMM yyyy"
        return f.string(from: d)
    }

    private static let cardDate: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d"
        return f
    }()

    private static let cardDateWithYear: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d, yyyy"
        return f
    }()

    /// "Apr 19", or "Apr 19, 2025" once it is not this year.
    private func cardDate(_ iso: String) -> String {
        guard let d = DateKit.date(iso) else { return "" }
        let sameYear = Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year)
        return (sameYear ? Self.cardDate : Self.cardDateWithYear).string(from: d)
    }

    private func noteCard(_ note: Note, isSelected: Bool) -> some View {
        let preview = NoteText.snippet(note.content)
        let tasks = store.liveTodos.filter { $0.noteId == note.id }.count
        let expenses = store.liveTransactions.filter { $0.noteId == note.id }.count
        let linked = [tasks > 0 ? "\(tasks) task\(tasks == 1 ? "" : "s")" : "",
                      expenses > 0 ? "\(expenses) expense\(expenses == 1 ? "" : "s")" : ""]
            .filter { !$0.isEmpty }.joined(separator: ", ")
        let tags = NoteText.tags(note.tags)
        let source = SOURCE_LABEL[note.source] ?? ""

        return Button { open(note.id) } label: {
            NoteRowBody(isSelected: isSelected) {
                HStack(alignment: .top, spacing: 14) {
                    Icon(!source.isEmpty ? "scan" : QuickNote.isQuick(note) ? "pin" : "lines", size: 17)
                        .foregroundStyle(p.textMuted)
                        .frame(width: 22, height: 22)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(note.title.isEmpty ? "Untitled" : note.title)
                            .font(FN.font(16, .medium))
                            .foregroundStyle(note.title.isEmpty ? p.textMuted : p.foreground)
                            .lineLimit(1)
                            .lineBox(16, 22)
                        Text(preview.isEmpty ? "No text yet" : preview)
                            .font(FN.font(14))
                            .foregroundStyle(p.textSecondary)
                            .lineLimit(1)
                            .lineBox(14, 20.3)
                        HStack(spacing: 10) {
                            Text(cardDate(note.updatedAt)).monospacedDigit()
                            ForEach(Array(tags.prefix(2)), id: \.self) { Text($0.prefix(1).uppercased() + $0.dropFirst()) }
                            if !linked.isEmpty {
                                HStack(spacing: 4) { Icon("link", size: 13); Text(linked) }
                                    .help("Linked to this note")
                            }
                        }
                        .font(FN.font(13.5))
                        .foregroundStyle(p.textMuted)
                        .lineLimit(1)
                        .lineBox(13.5, 20.25)
                        .padding(.top, 3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .buttonStyle(.fn)
        .flashes(nav.isFlashing(note.id), palette: p)
        .contextMenu {
            Button(EdgeStickies.shared.isStuck(note.id) ? "Take off screen edge" : "Stick to screen edge") {
                EdgeStickies.shared.toggle(note.id)
            }
            Divider()
            Button("Delete note", role: .destructive) { store.remove(.notes, note.id) }
        }
    }

    /// As many tags as fit on one line (at most three), then "+N", as outlined chips.
    private func tagRow(_ tags: [String]) -> some View {
        ViewThatFits(in: .horizontal) {
            ForEach(Array((0...min(3, tags.count)).reversed()), id: \.self) { count in
                HStack(spacing: 4) {
                    ForEach(tags.prefix(count), id: \.self) { tag in
                        outlinedChip(tag.prefix(1).uppercased() + tag.dropFirst())
                    }
                    if tags.count > count { Text("+\(tags.count - count)") }
                }
            }
        }
    }

    private func outlinedChip(_ text: String) -> some View {
        Text(text)
            .font(FN.small)
            .foregroundStyle(p.textMuted)
            .padding(.horizontal, 8)
            .frame(height: 20)
            .background(p.surface, in: Capsule(style: .circular))
            .overlay(Capsule(style: .circular).strokeBorder(p.border, lineWidth: 1))
            .fixedSize()
    }

    // MARK: - Actions

    /// A note that was opened but never written in: no title, no text, no scan,
    /// nothing linked.
    private func isBlank(_ n: Note) -> Bool {
        n.deletedAt == nil
            && (n.title.trimmingCharacters(in: .whitespaces).isEmpty || n.title == "Untitled")
            && n.content.trimmingCharacters(in: .whitespaces).isEmpty
            && n.imageDataUrl == nil
            && n.imageFile == nil
            && !store.liveTodos.contains { $0.noteId == n.id }
            && !store.liveTransactions.contains { $0.noteId == n.id }
    }

    /// Leaving a note you never wrote in discards it, so "New note" doesn't pile up blanks.
    private func leave(_ nextId: String?) {
        // What was typed a moment ago may still be waiting out its debounce:
        // write it first, or a new note typed in and left at once was deleted
        // as blank, and its text saved into the deleted note.
        PendingWrites.flushAll()
        guard let current = nav.selectedNoteId, current != nextId,
              let note = liveNotes.first(where: { $0.id == current }), isBlank(note) else { return }
        store.remove(.notes, note.id)
    }

    private func open(_ id: String) {
        leave(id)
        nav.selectedNoteId = id
    }

    private func newNote() {
        query = ""
        leave(nil)
        // Empty, so the "Untitled" placeholder doesn't need deleting.
        let n = store.addNote { $0.title = "" }
        nav.selectedNoteId = n.id
    }

    /// Blanks left behind earlier (e.g. by switching tabs) are cleaned up when
    /// Notes opens — only ones older than a few seconds, never the open note.
    private func cleanUpBlanks() {
        guard !cleanedUp else { return }
        cleanedUp = true
        let cutoff = Date().addingTimeInterval(-10)
        for n in store.notes where n.id != nav.selectedNoteId && isBlank(n)
            && (DateKit.date(n.updatedAt).map { $0 < cutoff } ?? false) {
            store.remove(.notes, n.id)
        }
    }
}

/// A note in the list: flat, tinted under the pointer, on the accent wash when open.
private struct NoteRowBody<Content: View>: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let isSelected: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(isSelected ? p.surface : (hovering ? p.surfaceMuted : .clear),
                        in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1)
                }
            }
            .padding(.horizontal, -10)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .motion(isSelected, Motion.quick)
            .motion(hovering, Motion.quick)
    }
}
