import SwiftUI

// Today's cards, at a glance beside the brief, as on the web: the next meeting (record
// it in a click), what's due (tick it off right here) and what's coming up, what you've
// spent today against today's share of your budgets, and quick notes — a line to jot
// in, and the newest few.

private func cardHead(_ title: String, _ p: Palette) -> some View {
    Text(title)
        .font(FN.font(16, .medium))
        .foregroundStyle(p.foreground)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
}

// MARK: - Next meeting

/// Which meeting Today's card shows, and how it says when. Pure, so it's tested; the
/// web app's card follows the same rules.
enum NextMeeting {
    /// How far ahead the card looks.
    static let window: TimeInterval = 12 * 3600
    static let dismissedKey = "fournotes.today.nextMeetingDismissed"

    /// The meeting on now (the one that began last, when two overlap), else the next one
    /// within the window; and the one after it, when that's in the window too.
    static func pick(_ meetings: [Meeting], now: Date) -> (shown: Meeting, then: Meeting?)? {
        let ahead = meetings
            .filter { $0.end > now && $0.start <= now.addingTimeInterval(window) }
            .sorted { $0.start < $1.start }
        guard let shown = ahead.last(where: { $0.isOn(at: now) }) ?? ahead.first(where: { $0.start > now })
        else { return nil }
        let then = ahead.first { $0.id != shown.id && $0.start > now && $0.start >= shown.start }
        return (shown, then)
    }

    /// "Now · started 5 min ago", "Now · until 5:00 PM", "In 12 min", "At 3:30 PM",
    /// "Tomorrow at 9:00 AM".
    static func when(_ m: Meeting, now: Date, calendar: Calendar = .current) -> String {
        if m.isOn(at: now) {
            let minutes = Int(now.timeIntervalSince(m.start) / 60)
            if minutes < 1 { return "Now · just started" }
            return minutes < 60 ? "Now · started \(minutes) min ago" : "Now · until \(Fmt.time(m.end))"
        }
        let minutes = Int((m.start.timeIntervalSince(now) / 60).rounded(.up))
        if minutes <= 1 { return "Starting now" }
        if minutes < 60 { return "In \(minutes) min" }
        if calendar.isDate(m.start, inSameDayAs: now) { return "At \(Fmt.time(m.start))" }
        return "Tomorrow at \(Fmt.time(m.start))"
    }

    /// "3:30 – 4:00 PM", "11:30 AM – 12:30 PM".
    static func range(_ m: Meeting) -> String {
        let start = Fmt.time(m.start), end = Fmt.time(m.end)
        let half = { (s: String) in s.split(separator: " ").last.map(String.init) ?? "" }
        if half(start) == half(end), let bare = start.split(separator: " ").first { return "\(bare) – \(end)" }
        return "\(start) – \(end)"
    }
}

struct NextMeetingCard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @ObservedObject private var calendar = MeetingCalendar.shared
    @ObservedObject private var talks = TalkStore.shared
    @ObservedObject private var recorder = TalkRecorder.shared
    @AppStorage(NextMeeting.dismissedKey) private var dismissed = false
    /// The meeting being started, while its call opens.
    @State private var starting: String?

    var body: some View {
        if calendar.access == .allowed {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                card { HeadLink(title: "All meetings") { nav.tab = .transcribe } } content: {
                    upcoming(now: context.date)
                }
            }
        } else if !dismissed {
            card {
                IconButton("x", size: 12, box: 22, help: "Not now") {
                    withAnimation(Motion.standard) { dismissed = true }
                }
            } content: { connect }
        }
    }

    private func card<Trailing: View, Content: View>(@ViewBuilder _ trailing: () -> Trailing,
                                                     @ViewBuilder content: () -> Content) -> some View {
        let trailing = trailing(), content = content()
        return Card(padding: 8) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    cardHead("Next meeting", p)
                    trailing
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 8)
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.top, 2)
                    .padding(.bottom, 12)
            }
        }
    }

    @ViewBuilder
    private func upcoming(now: Date) -> some View {
        if let next = NextMeeting.pick(calendar.meetings, now: now) {
            meeting(next.shown, then: next.then, now: now)
        } else {
            Text("No more meetings today.")
                .font(FN.body)
                .foregroundStyle(p.textSecondary)
        }
    }

    private func meeting(_ m: Meeting, then: Meeting?, now: Date) -> some View {
        let talk = talks.all.first { $0.isAlive && m.matches($0.event) }
        let recording = talk != nil && recorder.isActive && talk?.id == recorder.talkId
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(NextMeeting.when(m, now: now))
                    .font(FN.small)
                    .foregroundStyle(p.textMuted)
                Text(m.title)
                    .font(FN.font(15, .medium))
                    .foregroundStyle(p.foreground)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(([NextMeeting.range(m)] + (m.detail.isEmpty ? [] : [m.detail])).joined(separator: " · "))
                    .font(FN.small)
                    .foregroundStyle(p.textSecondary)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            buttons(m, talk: talk, recording: recording)
            if let then {
                Text("Then \(Fmt.time(then.start)) · \(then.title)")
                    .font(FN.small)
                    .foregroundStyle(p.textMuted)
                    .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private func buttons(_ m: Meeting, talk: Talk?, recording: Bool) -> some View {
        HStack(spacing: 8) {
            if recording, let talk {
                RecordingDot(size: 8)
                Text("Recording").font(FN.small).foregroundStyle(p.textSecondary)
                Spacer(minLength: 0)
                SecondaryButton(title: "Open", small: true) { open(talk.id) }.fixedSize()
            } else if let talk {
                SecondaryButton(title: "Open notes", icon: "note", small: true) { open(talk.id) }.fixedSize()
            } else {
                let busy = starting == m.id
                // One talk records at a time.
                let blocked = recorder.isActive || starting != nil
                if m.link != nil {
                    PrimaryButton(title: busy ? "Joining…" : "Join and record", disabled: blocked, small: true) {
                        record(m, join: true)
                    }
                    .fixedSize()
                    SecondaryButton(title: "Record", small: true) { record(m, join: false) }
                        .fixedSize()
                        .disabled(blocked)
                } else {
                    PrimaryButton(title: busy ? "Starting…" : "Record", icon: "mic", disabled: blocked, small: true) {
                        record(m, join: false)
                    }
                    .fixedSize()
                }
            }
        }
    }

    private var connect: some View {
        let denied = calendar.access == .denied
        return VStack(alignment: .leading, spacing: 10) {
            Text(denied
                 ? "Calendar access is off. Turn it on in System Settings to see your next meeting here."
                 : "See your next meeting here, and record it in one click.")
                .font(FN.body)
                .foregroundStyle(p.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            SecondaryButton(title: denied ? "Open System Settings" : "Connect calendar", icon: "calendar", small: true) {
                Task { await calendar.requestAccess() }
            }
            .fixedSize()
        }
    }

    private func record(_ m: Meeting, join: Bool) {
        starting = m.id
        Task {
            defer { starting = nil }
            do {
                open(try await MeetingRecording.record(m, join: join))
            } catch {
                toasts.push(error.localizedDescription, tone: .error)
            }
        }
    }

    private func open(_ talkId: String) {
        nav.open(ChangeLink(kind: .talks, id: talkId))
    }
}

// MARK: - Due today

struct DueTodayCard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    let tasks: [Todo]
    let upcoming: [Todo]
    let focus: [Todo]

    var body: some View {
        let shown = Array(tasks.prefix(5))
        Card(padding: 8) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    cardHead("Due today", p)
                    HeadLink(title: "All tasks") { nav.tab = .todo }
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 8)

                if shown.isEmpty {
                    Text(focus.isEmpty ? "Nothing due today." : "Nothing has a date today.")
                        .font(FN.body)
                        .foregroundStyle(p.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.top, 4)
                        .padding(.bottom, 12)
                }
                ForEach(shown) { TodayTaskRow(todo: $0) }
                if tasks.count > shown.count {
                    HeadLink(title: "\(tasks.count - shown.count) more due") { nav.tab = .todo }
                        .padding(.horizontal, 8)
                }
                if tasks.isEmpty && !focus.isEmpty {
                    SectionTitle("High priority, no date")
                        .padding(.horizontal, 12)
                        .padding(.top, 4)
                        .padding(.bottom, -2)
                    ForEach(focus) { TodayTaskRow(todo: $0) }
                }
                if !upcoming.isEmpty {
                    Rectangle().fill(p.borderSubtle).frame(height: 1)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                    SectionTitle("Coming up")
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                        .padding(.bottom, -2)
                    ForEach(upcoming) { TodayTaskRow(todo: $0) }
                }
            }
            .animation(Motion.list, value: tasks.map(\.id) + upcoming.map(\.id))
        }
    }
}

private struct TodayTaskRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @State private var checking = false
    let todo: Todo

    private var due: Date? { DateKit.date(todo.dueAt) }
    private var overdue: Bool { due.map { $0 < Date() } ?? false }
    private var sameDay: Bool { due.map { Calendar.current.isDateInToday($0) } ?? false }

    /// "6:00 PM", "Today", "Overdue, Oct 19" or "Sat, Oct 24".
    private var when: String {
        guard let due else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        if sameDay {
            let cal = Calendar.current
            return cal.component(.hour, from: due) == 0 && cal.component(.minute, from: due) == 0 ? "Today" : Fmt.time(due)
        }
        f.dateFormat = overdue ? "MMM d" : "EEE, MMM d"
        return overdue ? "Overdue, \(f.string(from: due))" : f.string(from: due)
    }

    private var repeats: String? {
        guard let rule = todo.rrule?.uppercased(), let range = rule.range(of: "FREQ=") else { return nil }
        let freq = rule[range.upperBound...].prefix { $0.isLetter }
        return ["DAILY": "Daily", "WEEKLY": "Weekly", "MONTHLY": "Monthly", "YEARLY": "Yearly"][String(freq)]
    }

    var body: some View {
        let note = todo.noteId.flatMap { id in store.liveNotes.first { $0.id == id } }
        HStack(alignment: .top, spacing: 12) {
            Button(action: complete) {
                // The kit's round `.check`, red-rimmed when overdue.
                Circle()
                    .strokeBorder(checking ? p.accent : (overdue ? p.danger : p.borderStrong), lineWidth: 1.5)
                    .background(Circle().fill(checking ? p.accent : .clear))
                    .overlay { if checking { Icon("check", size: 12, weight: 2.4).foregroundStyle(p.accentForeground) } }
                    .frame(width: 20, height: 20)
                    .padding(.top, 1)
                    .contentShape(Rectangle().inset(by: -12))
            }
            .buttonStyle(.fn)
            .accessibilityLabel("Complete \(todo.title)")

            Button { nav.open(ChangeLink(kind: .todos, id: todo.id)) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(todo.title)
                        .font(FN.body)
                        .foregroundStyle(p.foreground)
                        .lineLimit(1)
                    if !when.isEmpty || note != nil || repeats != nil {
                        HStack(spacing: 6) {
                            if !when.isEmpty {
                                Text(when)
                                    .monospacedDigit()
                                    .foregroundStyle(overdue && !sameDay ? p.danger : p.textMuted)
                            }
                            if !when.isEmpty && (note != nil || repeats != nil) { Text("·") }
                            if let note {
                                HStack(spacing: 4) {
                                    Icon("link", size: 12)
                                    Text(note.title.isEmpty ? "Untitled" : note.title).lineLimit(1)
                                }
                            } else if let repeats {
                                HStack(spacing: 4) {
                                    Icon("repeat", size: 12)
                                    Text(repeats)
                                }
                            }
                        }
                        .font(FN.small)
                        .foregroundStyle(p.textMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)

            if let bill = todo.bill, bill.amount > 0 {
                Text(Money.format(bill.amount, bill.currency ?? store.settings.currency))
                    .font(FN.font(13))
                    .monospacedDigit()
                    .foregroundStyle(p.textSecondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .flashes(nav.isFlashing(todo.id), palette: p)
        .transition(.opacity.combined(with: .offset(x: -8)))
    }

    /// The check fills, then the task goes.
    private func complete() {
        withAnimation(Motion.quick) { checking = true }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(220))
            let extra = store.toggleTodo(todo.id, done: true)
            toasts.push(([todo.title + " done"] + extra).joined(separator: "\n"))
        }
    }
}

// MARK: - Spent today

/// Today's spending, and, with budgets set, how much of today's share of them is left:
/// what the budgets have left this month, spread over the days that are left.
struct SpentTodayCard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    let yesterdayTotal: Double

    var body: some View {
        let cur = store.settings.currency
        let now = Date()
        let today = DateKit.localDate(now)
        let month = String(today.prefix(7))
        let live = store.liveTransactions.filter { $0.amount > 0 }
        let todays = live.filter { $0.date == today }
        let total = todays.reduce(0) { $0 + Insights.myShare($1, cur) }
        var seen = Set<String>()
        let merchants = todays.map(\.merchant).filter { seen.insert($0).inserted }.prefix(3).joined(separator: ", ")

        let budgets = store.settings.budgets.filter { $0.value > 0 }
        let monthly = budgets.values.reduce(0, +)
        let before = live.filter { budgets[$0.category] != nil && $0.date.hasPrefix(month) && $0.date < today }
            .reduce(0) { $0 + Insights.myShare($1, cur) }
        let todayInBudget = todays.filter { budgets[$0.category] != nil }.reduce(0) { $0 + Insights.myShare($1, cur) }
        let cal = Calendar.current
        let daysInMonth = cal.range(of: .day, in: .month, for: now)?.count ?? 30
        let daysLeft = daysInMonth - cal.component(.day, from: now) + 1
        let allowance: Double? = monthly > 0 ? max(0, (monthly - before) / Double(daysLeft)) : nil
        let left = allowance.map { $0 - todayInBudget }
        let pct: Int = allowance.map { $0 > 0 ? min(100, Int((todayInBudget / $0 * 100).rounded())) : 100 } ?? 0
        let over = (left ?? 0) < 0
        let sub: String = {
            if let left {
                return over ? "\(Money.format(-left, cur)) over today's share of your budgets"
                    : "\(Money.format(left, cur)) left for today"
            }
            if yesterdayTotal > 0 { return "\(Money.format(yesterdayTotal, cur)) yesterday" }
            return todays.isEmpty ? "Nothing logged yet today"
                : "\(todays.count) \(todays.count == 1 ? "purchase" : "purchases") today"
        }()

        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    cardHead("Spent today", p)
                    HeadLink(title: "Finance") { nav.tab = .finance }
                }
                Text(Money.format(total, cur))
                    .font(FN.display(28))
                    .tracking(FN.displayTracking(28))
                    .monospacedDigit()
                    .foregroundStyle(p.foreground)
                    .contentTransition(.numericText())
                    .padding(.top, 12)
                Text(sub)
                    .font(FN.font(13))
                    .monospacedDigit()
                    .foregroundStyle(over ? p.danger : p.textSecondary)
                    .padding(.top, 4)
                    .help(allowance != nil ? "What your monthly budgets have left, spread over the days left this month" : "")
                if allowance != nil {
                    ProgressBar(ratio: Double(pct) / 100, tone: over ? p.danger : p.accent)
                        .padding(.top, 14)
                        .accessibilityLabel("Today's share of your budgets used")
                        .accessibilityValue("\(pct) percent")
                    HStack {
                        Text(merchants).lineLimit(1)
                        Spacer(minLength: 12)
                        Text("\(pct)%").monospacedDigit()
                    }
                    .font(FN.small)
                    .foregroundStyle(p.textMuted)
                    .padding(.top, 8)
                } else if !merchants.isEmpty {
                    Text(merchants).font(FN.small).foregroundStyle(p.textMuted).lineLimit(1).padding(.top, 8)
                }
            }
        }
    }
}

// MARK: - Quick notes

struct QuickNotesCard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @State private var draft = ""
    @FocusState private var focused: Bool
    let quickNotes: [Note]

    var body: some View {
        let shown = Array(quickNotes.prefix(3))
        Card(padding: 8) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    cardHead("Quick notes", p)
                    Text("Today's go into the brief").font(FN.small).foregroundStyle(p.textMuted)
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 8)

                TextField("Jot something down", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(FN.body)
                    .lineSpacing(7)
                    .foregroundStyle(p.foreground)
                    .lineLimit(1...5)
                    .focused($focused)
                    .onSubmit(save)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .frame(minHeight: 40)
                    .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
                        .strokeBorder(focused ? p.borderStrong : p.border, lineWidth: 1))
                    .motion(focused, Motion.quick)
                    .accessibilityHint("Return saves it")

                VStack(spacing: 0) {
                    ForEach(shown) { QuickNoteRow(note: $0) }
                }
                .padding(.top, shown.isEmpty ? 0 : 4)
                .animation(Motion.list, value: shown.map(\.id))

                if quickNotes.count > shown.count {
                    HeadLink(title: "All notes") { nav.tab = .notes }
                        .padding(.horizontal, 8)
                }
            }
        }
    }

    private func save() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.addNote { QuickNote.apply(text, to: &$0) }
        draft = ""
        toasts.push("Quick note saved")
    }
}

private struct QuickNoteRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @ObservedObject private var stickies = EdgeStickies.shared
    @State private var hovering = false
    let note: Note

    var body: some View {
        let title = note.title.isEmpty ? "Untitled" : note.title
        let stuck = stickies.isStuck(note.id)
        HStack(spacing: 12) {
            Circle().fill(p.noteYellow).frame(width: 8, height: 8)
            Button { nav.open(ChangeLink(kind: .notes, id: note.id)) } label: {
                Text(title)
                    .font(FN.body)
                    .foregroundStyle(p.foreground)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            Text(Self.ago(note.createdAt)).font(FN.small).foregroundStyle(p.textMuted)
            // Mac only: stick it to the screen edge.
            if hovering || stuck {
                IconButton("pin", size: 14, box: 36, tone: stuck ? p.accent : nil,
                           help: stuck ? "Take off the screen edge" : "Stick to the screen edge") {
                    stickies.toggle(note.id)
                }
                .transition(.opacity)
            }
            // Shown on hover, its room kept, as on the web.
            IconButton("x", size: 14, box: 36, help: "Delete “\(title)”") { store.remove(.notes, note.id) }
                .opacity(hovering ? 1 : 0)
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .flashes(nav.isFlashing(note.id), palette: p)
        .transition(.opacity.combined(with: .offset(y: -6)))
    }

    /// "Just now", "5 min ago", "2 hours ago", "Yesterday", "3 days ago", "Oct 2".
    static func ago(_ iso: String) -> String {
        guard let date = DateKit.date(iso) else { return "" }
        let mins = Int((Date().timeIntervalSince(date) / 60).rounded())
        if mins < 1 { return "Just now" }
        if mins < 60 { return "\(mins) min ago" }
        let h = Int((Double(mins) / 60).rounded())
        if h < 24 { return h == 1 ? "1 hour ago" : "\(h) hours ago" }
        let d = Int((Double(h) / 24).rounded())
        if d < 7 { return d == 1 ? "Yesterday" : "\(d) days ago" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d"
        return f.string(from: date)
    }
}

// MARK: - Quiet controls

/// A quiet, pill-shaped text control: "Refresh brief", "One paragraph ⌄".
struct QuietLabel: View {
    @Environment(\.palette) private var p
    @Environment(\.menuIsOpen) private var open
    @State private var hovering = false
    var icon: String?
    let title: String
    var trailingIcon: String?

    var body: some View {
        HStack(spacing: 6) {
            if let icon { Icon(icon, size: 14) }
            Text(title)
            if let trailingIcon { Icon(trailingIcon, size: 14) }
        }
        .font(FN.font(13))
        .foregroundStyle(hovering || open ? p.foreground : p.textMuted)
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(hovering || open ? p.hover : .clear, in: Capsule())
        .contentShape(Capsule())
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
    }
}

struct QuietButton: View {
    @Environment(\.isEnabled) private var enabled
    var icon: String?
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) { QuietLabel(icon: icon, title: title) }
            .buttonStyle(.fn)
            .opacity(enabled ? 1 : 0.4)
    }
}
