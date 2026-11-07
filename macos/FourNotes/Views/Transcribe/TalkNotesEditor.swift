import AppKit
import Combine
import SwiftUI

// Your notes on a talk: the note editor's writing surface (lists, checkboxes, the "/"
// menu), kept on the talk as plain text, as a note's content is. While the talk is
// being recorded each line remembers when it was written, so Enhance knows which part
// of the conversation it's about.
//
// Its inputs are plain values on purpose: the page around it redraws with every line
// of transcript, and a redraw lays the whole text view out again.

struct TalkNotesEditor<Header: View>: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @EnvironmentObject private var engine: AIEngine
    @StateObject private var controller = RichTextController()

    let talkId: String
    /// Lines written now are timed: the talk is being recorded.
    var recording = false
    let placeholder: String
    let header: Header

    @State private var attributed = NSAttributedString()
    @State private var loadedId: String?
    /// The text as last taken from the editor, and each line's time: what the next edit is compared with.
    @State private var plain = ""
    @State private var times: [String: Double] = [:]
    @State private var pending: Task<Void, Never>?
    @State private var writeId = UUID()

    static var column: TextColumn { TextColumn(maxWidth: 680, padding: 40, centered: true) }

    var body: some View {
        RichTextEditor(attributed: $attributed, controller: controller, onTextChange: changed,
                       column: Self.column, header: hostedHeader)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topLeading) { slashMenu }
            .onAppear {
                controller.onSlash = { run($0) }
                load()
            }
            .onReceive(TalkStore.shared.$all.map { [talkId] in $0.first { $0.id == talkId }?.notes }.removeDuplicates()) { notes in
                reloadIfChangedElsewhere(notes ?? "")
            }
            .onReceive(NotificationCenter.default.publisher(for: .talkNotesAdded)) { note in
                guard let info = note.userInfo, info["talkId"] as? String == talkId,
                      let line = info["line"] as? String else { return }
                take(line, at: info["at"] as? Double)
            }
            .onDisappear { save() }
    }

    /// The header the caller gives, then a hint while there's nothing written. A
    /// separate hierarchy: it needs the app's objects handed over.
    private var hostedHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if plain.isEmpty {
                Text(placeholder)
                    .font(FN.body)
                    .foregroundStyle(p.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: Self.column.maxWidth, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, Self.column.padding)
                    .padding(.bottom, 10)
            }
        }
        .background(p.bg)
        .environmentObject(store)
        .environmentObject(nav)
        .environmentObject(toasts)
        .environmentObject(engine)
    }

    // MARK: - Loading and saving

    private func load() {
        guard loadedId != talkId else { return }
        loadedId = talkId
        let talk = TalkStore.shared.talk(talkId)
        plain = talk?.notes ?? ""
        times = talk?.noteTimes ?? [:]
        attributed = NoteDocument.spaced(NoteDocument.usingBodyFont(NoteDocument.attributed(fromPlainText: plain)))
    }

    /// The notes changed somewhere else (the live page's editor, saved as it closed).
    /// Edits still waiting to be saved here are newer and win.
    private func reloadIfChangedElsewhere(_ notes: String) {
        guard loadedId == talkId, pending == nil, notes != plain else { return }
        plain = notes
        times = TalkStore.shared.talk(talkId)?.noteTimes ?? [:]
        attributed = NoteDocument.spaced(NoteDocument.usingBodyFont(NoteDocument.attributed(fromPlainText: notes)))
    }

    /// A line added from outside (Live Q&A's "Add to my notes"). Typing that isn't saved
    /// yet would be written over it, so it joins this text and the two are saved together.
    private func take(_ line: String, at: Double?) {
        guard loadedId == talkId else { return }
        if !plain.components(separatedBy: "\n").contains(line) {
            let base = plain.trimmingCharacters(in: .newlines)
            plain = base.isEmpty ? line : base + "\n" + line
            if let at { times[NoteTimes.key(line)] = at }
            attributed = NoteDocument.spaced(NoteDocument.usingBodyFont(NoteDocument.attributed(fromPlainText: plain)))
        }
        save()
    }

    private func changed(_ document: NSAttributedString) {
        let text = NoteDocument.plainText(from: document)
        guard text != plain else { return }
        let recorder = TalkRecorder.shared
        let now = recording && recorder.talkId == talkId ? recorder.startedAt.map { Date().timeIntervalSince($0) } : nil
        times = NoteTimes.update(times, old: plain, new: text, now: now)
        plain = text
        pending?.cancel()
        let id = talkId, timed = times
        PendingWrites.hold(writeId) { Self.write(id, text, timed) }
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            save()
        }
    }

    private func save() {
        pending?.cancel()
        pending = nil
        PendingWrites.release(writeId)
        guard let id = loadedId else { return }
        Self.write(id, plain, times)
    }

    private static func write(_ id: String, _ text: String, _ times: [String: Double]) {
        TalkStore.shared.update(id) { t in
            t.notes = text.isEmpty ? nil : text
            t.noteTimes = text.isEmpty || times.isEmpty ? nil : times
        }
    }

    // MARK: - The "/" menu

    private var slashMenu: some View {
        GeometryReader { geo in
            if let s = controller.slash {
                let frame = geo.frame(in: .global)
                let height = CGFloat(min(320, s.commands.count * 50) + 86)
                let below = s.caret.maxY - frame.minY + 6
                let above = s.caret.minY - frame.minY - height - 6
                let y = below + height > geo.size.height - 8 && above > 8 ? above : below
                let x = min(max(8, s.caret.minX - frame.minX - 18), geo.size.width - 328)
                SlashMenuView(commands: s.commands, active: s.active,
                              onPick: { controller.runSlash($0) },
                              onHover: { controller.hoverSlash($0) })
                    .offset(x: x, y: y)
                    .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .topLeading)))
            }
        }
        .animation(Motion.quick, value: controller.slash == nil)
    }

    /// What each "/" command does with the line it was typed on, as in a note. Tasks
    /// link to the talk's note, when it has one.
    private func run(_ command: SlashCommand) {
        let line = controller.currentLineText
        let needLine = { toasts.push("Type something on this line first, then use the command.", tone: .error) }
        let noteId = TalkStore.shared.talk(talkId)?.noteId
        switch command {
        case .todo:
            guard !line.isEmpty else { return needLine() }
            store.addTodo { $0.title = line; $0.noteId = noteId }
            if !controller.state.isChecklist { controller.toggleChecklist() }
            toasts.push("✅ Task added: \(line)")
        case .remind:
            guard !line.isEmpty else { return needLine() }
            let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            let iso = DateKit.iso(Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow)
            store.addTodo { $0.title = line; $0.noteId = noteId; $0.dueAt = iso; $0.remindAt = iso }
            controller.insertOnLine(" ⏰", atEnd: true)
            if !controller.state.isChecklist { controller.toggleChecklist() }
            toasts.push("⏰ Reminder \(Fmt.due(iso)): \(line)")
        case .expense:
            guard let amount = Money.parse(line), amount > 0 else {
                toasts.push("Add an amount on the line, like “lunch 45k”.", tone: .error)
                return
            }
            let merchant = line
                .replacingOccurrences(of: #"(?i)(rp|idr)?\.?\s*\d[\d.,]*\s*(rb|ribu|k|jt|juta)?\b"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            let tx = store.addTransaction {
                $0.merchant = merchant.isEmpty ? "Expense" : merchant
                $0.amount = amount
                $0.category = Wallet.guessCategory(line)
                $0.noteId = noteId
            }
            controller.insertOnLine("💸 ", atEnd: false)
            toasts.push("💸 Logged \(Money.format(amount, tx.currency)) (\(tx.category))")
        case .sticky:
            guard !line.isEmpty else { return needLine() }
            store.addNote { QuickNote.apply(line, to: &$0) }
            toasts.push("📌 Saved as a quick note on Today")
        case .ask:
            guard !line.isEmpty else { return needLine() }
            let title = TalkStore.shared.talk(talkId)?.title ?? "a talk"
            Task { _ = await AppModel.shared.assistant.send("\(line)\n\n(Context: from my notes on the talk “\(title)”)") }
        case .checklist: controller.toggleChecklist()
        case .bullet: controller.toggleBulletList()
        case .numbered: controller.toggleNumberedList()
        case .heading: controller.setHeading(2)
        case .quote: controller.toggleQuote()
        case .divider: controller.insertDivider()
        case .date: controller.insertText(todayFormat.string(from: Date()))
        case .time: controller.insertText(Fmt.time(Date()))
        }
    }
}

/// "/date": "Thursday, 22 October 2026", as a note writes it.
private let todayFormat: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US")
    f.dateFormat = "EEEE, d MMMM yyyy"
    return f
}()
