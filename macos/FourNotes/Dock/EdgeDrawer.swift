import SwiftUI

// The edge dock's drawer: a slice of the app that grows out of the screen edge. The same ink
// frame and paper sheet as the main window, in one column: a header on the frame, one input
// that works out what you typed, then the day: the next meeting, what's due, what's coming up
// and what you've spent. The question and dictation take the sheet over, a click from Today.

/// What the one input reads a line as, shown before it's filed.
enum EdgeCapture: Equatable {
    case note
    case task(title: String, date: Date)
    case spend(Glance.Spend)
    case ask

    /// A question goes first, then an amount (so a payment message with a date in it stays
    /// spending), then a day or a time. Anything else is a note.
    static func read(_ text: String) -> EdgeCapture? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }
        let lower = clean.lowercased()
        if clean.hasSuffix("?") || lower.range(of: "^(what|when|how|who|why|where|did|do|does|is|are|can|should)\\b",
                                               options: .regularExpression) != nil {
            return .ask
        }
        let namesMoney = lower.range(of: "\\d\\s*(k|rb|ribu|jt|juta)\\b|(rp|idr|\\$)\\s*\\d|\\b\\d{4,}\\b",
                                     options: .regularExpression) != nil
        if namesMoney || Glance.looksLikeNotification(clean), let spend = Glance.spend(clean) {
            return .spend(spend)
        }
        if let split = NaturalDate.splitTitle(clean) {
            return .task(title: split.title, date: split.date)
        }
        return .note
    }
}

/// The ring on the tab and in the drawer's header: it fills as the day's tasks are done, and
/// shows a check once nothing is left.
struct TasksRing: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dock) private var d

    var body: some View {
        let due = Glance.dueByToday(store.liveTodos)
        let done = Glance.doneToday(store.liveTodos).count
        let total = due.count + done
        ZStack {
            Circle().inset(by: 1.25).stroke(d.track, lineWidth: 2.5)
            Circle()
                .inset(by: 1.25)
                .trim(from: 0, to: due.isEmpty ? 1 : total == 0 ? 0 : CGFloat(done) / CGFloat(total))
                .stroke(d.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(Motion.data, value: done)
            if due.isEmpty {
                Icon("check", size: 10, weight: 3.2).foregroundStyle(d.accent)
            } else {
                Text("\(due.count)")
                    .font(FN.font(11, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(d.text)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(width: 21, height: 21)
    }
}

struct EdgeDrawer: View {
    @ObservedObject var dock: EdgeDock
    @EnvironmentObject private var store: Store
    @ObservedObject private var calendar = MeetingCalendar.shared
    @Environment(\.dock) private var d
    /// Kept across closing the drawer, and quitting, so a click elsewhere never costs a line.
    @AppStorage("fournotes.dock.noteDraft") private var draft = ""
    @State private var page = Page.today
    @State private var question: String?
    @State private var filed: String?
    @FocusState private var typing: Bool

    private enum Page: Equatable { case today, listen, ask }

    var body: some View {
        VStack(spacing: 0) {
            header
            sheet
                .background(d.sheet, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .padding([.horizontal, .bottom], 8)
        }
        .animation(Motion.standard, value: page)
    }

    // MARK: - On the frame

    private var header: some View {
        let open = Glance.dueByToday(store.liveTodos).count
        return HStack(spacing: 12) {
            TasksRing()
            VStack(alignment: .leading, spacing: 0) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day().locale(Locale(identifier: "en_US"))))
                    .font(FN.font(15, .semibold))
                    .foregroundStyle(d.frameText)
                Text(open == 0 ? "Nothing due today" : "\(open) due today")
                    .font(FN.font(13))
                    .monospacedDigit()
                    .foregroundStyle(d.frameMuted)
            }
            Spacer(minLength: 8)
            DockRoundButton(icon: "arrowUpRight", help: "Open Four Notes", size: 32, look: .filled) { dock.showApp() }
            DockRoundButton(icon: "x", help: "Close (Esc)", size: 32, look: .filled) { dock.close() }
        }
        .padding(.leading, 20)
        .padding(.trailing, 12)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .environment(\.dock, d.onFrame)
    }

    // MARK: - On the sheet

    @ViewBuilder
    private var sheet: some View {
        switch page {
        case .today:
            VStack(spacing: 0) {
                input
                ScrollView {
                    today
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
                .scrollIndicators(.never)
                if !dock.hidden.contains(.spend) { SpentLine(dock: dock) }
            }
        case .listen:
            takenOver { TranscribeMini(autoStart: true) }
        case .ask:
            takenOver { AskMini(dock: dock, firstQuestion: question) }
        }
    }

    /// Dictation and a question have the sheet to themselves, with the way back on top.
    private func takenOver<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            DockPlainButton(title: "Today", icon: "chevronLeft", height: 28) { page = .today }
            ScrollView { content() }.scrollIndicators(.never)
        }
        .padding(12)
    }

    private var input: some View {
        let read = EdgeCapture.read(draft)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                TextField("", text: $draft, prompt: Text("Note, task, spend or question").foregroundStyle(d.muted))
                    .textFieldStyle(.plain)
                    .font(FN.font(15))
                    .foregroundStyle(d.text)
                    .focused($typing)
                    .onSubmit(file)
                DockRoundButton(icon: "mic", help: "Dictate", size: 34) { page = .listen }
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .frame(height: 46)
            .background(d.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(typing ? d.text : d.hair, lineWidth: typing ? 1.5 : 1))

            if let read {
                HStack(spacing: 8) {
                    DockTag(text: label(read), tone: tone(read))
                    Text(line(read))
                        .font(FN.font(13.5))
                        .monospacedDigit()
                        .foregroundStyle(d.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    DockPrimaryButton(title: action(read), action: file)
                }
                .transition(.opacity.combined(with: .offset(y: -4)))
            } else if let filed {
                HStack(spacing: 6) {
                    Icon("check", size: 14, weight: 2).foregroundStyle(d.success)
                    Text(filed).font(FN.font(13, .semibold)).foregroundStyle(d.success)
                }
                .transition(.opacity)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 2)
        .animation(Motion.quick, value: read)
        .animation(Motion.quick, value: filed)
    }

    private func label(_ read: EdgeCapture) -> String {
        switch read {
        case .note: return "Note"
        case .task: return "Task"
        case .spend: return "Spend"
        case .ask: return "Ask"
        }
    }

    private func tone(_ read: EdgeCapture) -> Color {
        switch read {
        case .note: return d.series[2]
        case .task: return d.series[1]
        case .spend: return d.success
        case .ask: return d.ai
        }
    }

    private func line(_ read: EdgeCapture) -> String {
        switch read {
        case .note: return "Goes to Notes"
        case .task(_, let date): return "\(Fmt.due(DateKit.iso(date))) · Planner"
        case .spend(let spend): return "\(Money.format(abs(spend.amount), store.settings.currency)) · \(spend.category)"
        case .ask: return "Answers from your notes"
        }
    }

    private func action(_ read: EdgeCapture) -> String {
        switch read {
        case .note: return "Save"
        case .task: return "Add"
        case .spend: return "Log"
        case .ask: return "Ask"
        }
    }

    private func file() {
        guard let read = EdgeCapture.read(draft) else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        switch read {
        case .ask:
            question = text
            page = .ask
            return
        case .note:
            store.addNote { QuickNote.apply(text, to: &$0) }
            say("Saved to Notes")
        case .task(let title, let date):
            store.addTodo {
                $0.title = title
                $0.dueAt = DateKit.iso(date)
                // A time was named: remind then, as the assistant does.
                if date > Date() { $0.remindAt = DateKit.iso(date) }
            }
            say("Added to the Planner")
        case .spend(let spend):
            store.addTransaction {
                $0.merchant = spend.merchant
                $0.amount = spend.amount
                $0.category = spend.category
            }
            say("Logged to Money")
        }
    }

    private func say(_ text: String) {
        filed = text
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if filed == text { filed = nil }
        }
    }

    // MARK: - The day

    private var today: some View {
        let todos = store.liveTodos
        let due = Glance.dueByToday(todos)
        let done = Glance.doneToday(todos)
        let upcoming = Glance.upcoming(todos: todos, transactions: store.liveTransactions,
                                       currency: store.settings.currency, limit: 2)
        return VStack(alignment: .leading, spacing: 0) {
            if calendar.access == .allowed, let next = NextMeeting.pick(calendar.meetings, now: Date()) {
                section("Next up · \(NextMeeting.when(next.shown, now: Date()))")
                EdgeMeetingRow(dock: dock, meeting: next.shown)
            }
            if !dock.hidden.contains(.tasks) {
                section("Due today · \(due.isEmpty ? "all done" : "\(due.count) left")", link: "Planner") {
                    dock.showApp { $0.tab = .todo }
                }
                ForEach(due + done.prefix(3)) { todo in EdgeTaskRow(todo: todo) }
                if due.isEmpty && done.isEmpty {
                    Text("Nothing due today.").font(FN.font(14)).foregroundStyle(d.secondary).padding(.vertical, 6)
                }
            }
            if !dock.hidden.contains(.bills), !upcoming.isEmpty {
                section("Coming up")
                ForEach(upcoming) { item in
                    HStack(spacing: 10) {
                        DockCheckbox(checked: false)
                        Text(item.title).font(FN.font(15, .medium)).foregroundStyle(d.text).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(Money.format(item.amount, item.currency, compact: true))
                            .font(FN.font(13, .semibold)).monospacedDigit().foregroundStyle(d.secondary)
                    }
                    .padding(.vertical, 5)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func section(_ title: String, link: String? = nil, action: (() -> Void)? = nil) -> some View {
        HStack {
            Text(title).font(FN.font(13, .semibold)).foregroundStyle(d.muted)
            Spacer()
            if let link, let action {
                DockPlainButton(title: link, height: 24, action: action)
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 2)
    }
}

private struct EdgeTaskRow: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dock) private var d
    let todo: Todo

    var body: some View {
        DockRow {
            _ = store.toggleTodo(todo.id, done: !todo.done)
        } label: {
            HStack(spacing: 10) {
                DockCheckbox(checked: todo.done)
                Text(todo.title.isEmpty ? "Untitled task" : todo.title)
                    .font(FN.font(15, .medium))
                    .strikethrough(todo.done)
                    .foregroundStyle(todo.done ? d.muted : d.text)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(when)
                    .font(FN.font(13, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(late ? d.danger : d.secondary)
            }
            .padding(.vertical, 5)
        }
    }

    private var late: Bool {
        guard !todo.done, let due = DateKit.date(todo.dueAt) else { return false }
        return due < Calendar.current.startOfDay(for: Date())
    }

    private var when: String {
        guard let due = DateKit.date(todo.dueAt) else { return "" }
        if late { return "Overdue" }
        let c = Calendar.current.dateComponents([.hour, .minute], from: due)
        // End-of-day due dates are "today", not "23:59".
        let timed = !(c.hour == 23 && c.minute == 59) && !(c.hour == 0 && c.minute == 0)
        return timed ? Fmt.time(due) : "Any time"
    }
}

private struct EdgeMeetingRow: View {
    @ObservedObject var dock: EdgeDock
    @ObservedObject private var recorder = TalkRecorder.shared
    @Environment(\.dock) private var d
    @State private var starting = false
    let meeting: Meeting

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(d.spark).frame(width: 9, height: 9).frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(meeting.title).font(FN.font(15, .medium)).foregroundStyle(d.text).lineLimit(1)
                Text(([NextMeeting.range(meeting)] + (meeting.detail.isEmpty ? [] : [meeting.detail])).joined(separator: " · "))
                    .font(FN.font(13)).foregroundStyle(d.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            DockPrimaryButton(title: starting ? "Starting…" : "Record", disabled: starting || recorder.isActive, action: record)
        }
        .padding(.vertical, 6)
    }

    private func record() {
        starting = true
        Task {
            defer { starting = false }
            if let id = try? await MeetingRecording.record(meeting, join: false) {
                dock.showApp { $0.selectedTalkId = id; $0.tab = .transcribe }
            }
        }
    }
}

/// Spent today, on one line at the foot of the sheet.
private struct SpentLine: View {
    @ObservedObject var dock: EdgeDock
    @EnvironmentObject private var store: Store
    @Environment(\.dock) private var d

    var body: some View {
        let cur = store.settings.currency
        let today = DateKit.localDate()
        let total = store.liveTransactions
            .filter { $0.amount > 0 && $0.date == today }
            .reduce(0) { $0 + Insights.myShare($1, cur) }
        Button { dock.showApp { $0.tab = .finance } } label: {
            HStack(spacing: 10) {
                Text("Spent today").font(FN.font(13)).foregroundStyle(d.muted)
                Spacer(minLength: 8)
                Text(Money.format(total, cur)).font(FN.font(13, .semibold)).monospacedDigit().foregroundStyle(d.text)
            }
            .padding(.horizontal, 16)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .overlay(alignment: .top) { Rectangle().fill(d.hair).frame(height: 1) }
        .accessibilityLabel("Spent today, open Money")
    }
}
