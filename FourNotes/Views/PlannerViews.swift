import SwiftUI

// The Planner's two reading views, as on the web (src/components/Planner.tsx). Day: a strip of
// dates, then tasks, calendar meetings and bills on one timeline with a line at the present
// moment. List: everything open, under Overdue, Today, This week and Later. Both use the one
// row: a ring, a title and a meta line. The board is in TodoView.swift, and details open on the
// side sheet there.

/// Every page's header: a 40pt title and one subtitle line on the left, controls on the right.
struct PageHead<Trailing: View>: View {
    @Environment(\.palette) private var p
    let title: String
    var sub: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(FN.display(40))
                    .tracking(FN.displayTracking(40))
                    .foregroundStyle(p.foreground)
                if let sub {
                    Text(sub).font(FN.font(15)).monospacedDigit().foregroundStyle(p.textMuted)
                }
            }
            Spacer(minLength: 12)
            trailing()
        }
        .padding(.bottom, 24)
    }
}

/// The one row, for a task.
struct PlanTaskRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @State private var hovering = false
    let todo: Todo
    var meta: String?
    var late = false
    var selected = false
    let onOpen: () -> Void
    let onToggle: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Button(action: onToggle) {
                ZStack {
                    Circle()
                        .strokeBorder(ringColor, lineWidth: ringWidth)
                        .background(Circle().fill(todo.done ? p.accent : .clear))
                    if todo.doing == true && !todo.done {
                        Circle().inset(by: 4.5).trim(from: 0.25, to: 0.75).rotation(.degrees(180)).fill(p.foreground)
                    }
                    if todo.done { Icon("check", size: 12, weight: 2.5).foregroundStyle(p.accentForeground) }
                }
                .frame(width: 22, height: 22)
                .contentShape(Circle().inset(by: -6))
            }
            .buttonStyle(.fn)
            .accessibilityLabel(todo.done ? "Mark not done" : "Complete")

            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(todo.title.isEmpty ? "Untitled task" : todo.title)
                        .font(FN.font(16, .medium))
                        .strikethrough(todo.done)
                        .foregroundStyle(todo.done ? p.textMuted : p.foreground)
                        .lineLimit(2)
                    if meta != nil || todo.rrule != nil || note != nil {
                        HStack(spacing: 10) {
                            if let meta {
                                Text(meta)
                                    .font(FN.font(13.5, .semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(late ? p.danger : p.textSecondary)
                            }
                            if let rrule = todo.rrule {
                                metaItem("repeat", Recurrence.label(rrule))
                            }
                            if let note { metaItem("link", note.title.isEmpty ? "Note" : note.title) }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)

            if let bill = todo.bill, bill.amount > 0 {
                Text(Money.format(bill.amount, bill.currency ?? store.settings.currency))
                    .font(FN.font(15, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(p.foreground)
            }
        }
        .padding(10)
        .background(selected ? p.surface : hovering ? p.surfaceMuted : .clear,
                    in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay {
            if selected {
                RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1)
            }
        }
        .padding(.horizontal, -10)
        .onHover { hovering = $0 }
    }

    private var note: Note? {
        todo.noteId.flatMap { id in store.liveNotes.first { $0.id == id } }
    }

    private var ringColor: Color {
        if todo.done { return p.accent }
        if late || todo.doing == true { return p.danger }
        return todo.priority == .high ? p.warning : p.borderStrong
    }

    private var ringWidth: CGFloat { todo.priority == .high && !todo.done ? 2.25 : 1.75 }

    private func metaItem(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 4) {
            Icon(icon, size: 13)
            Text(text).font(FN.font(13.5)).lineLimit(1)
        }
        .foregroundStyle(p.textMuted)
    }
}

private func shortDate(_ d: Date) -> String {
    d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
}

private struct SectionHead: View {
    @Environment(\.palette) private var p
    let title: String
    var late = false

    var body: some View {
        Text(title)
            .font(FN.font(13, .semibold))
            .foregroundStyle(late ? p.danger : p.textMuted)
            .padding(.top, 22)
            .padding(.bottom, 6)
    }
}

struct PlannerDay: View {
    @Environment(\.palette) private var p
    @ObservedObject private var calendar = MeetingCalendar.shared
    let todos: [Todo]
    @Binding var offset: Int
    let openId: String?
    let onOpen: (String) -> Void
    let onToggle: (Todo) -> Void
    @State private var only: Only?

    private enum Only { case tasks, meetings, overdue }
    private static let before = 3
    private static let strip = 14

    private let cal = Calendar.current
    private var now: Date { Date() }
    private var today: Date { cal.startOfDay(for: now) }
    private func day(_ offset: Int) -> Date { cal.date(byAdding: .day, value: offset, to: today) ?? today }
    private func tasks(on d: Date) -> [Todo] {
        todos.filter { (DateKit.date($0.dueAt).map { cal.isDate($0, inSameDayAs: d) }) ?? false }
    }
    private func meetings(on d: Date) -> [Meeting] {
        calendar.access == .allowed ? calendar.meetings.filter { cal.isDate($0.start, inSameDayAs: d) } : []
    }
    private func timed(_ d: Date) -> Bool {
        let c = cal.dateComponents([.hour, .minute], from: d)
        // End-of-day due dates mean the day, not 23:59.
        return !(c.hour == 23 && c.minute == 59) && !(c.hour == 0 && c.minute == 0)
    }

    var body: some View {
        let shown = day(offset)
        let isToday = offset == 0
        let dayTasks = tasks(on: shown)
        let dayMeetings = meetings(on: shown)
        let open = dayTasks.filter { !$0.done }
        let overdue = isToday
            ? todos.filter { !$0.done && (DateKit.date($0.dueAt).map { $0 < today } ?? false) }.sorted { ($0.dueAt ?? "") < ($1.dueAt ?? "") }
            : []
        let floating = dayTasks.filter { !timed(DateKit.date($0.dueAt) ?? shown) }
        let line = timeline(dayTasks, dayMeetings)
        let nextIndex = isToday ? line.firstIndex { $0.at > now } : nil

        VStack(alignment: .leading, spacing: 0) {
            strip
            summary(open: open.count, meetings: dayMeetings.count, overdue: overdue.count, isToday: isToday)

            if !overdue.isEmpty && (only == nil || only == .overdue) {
                SectionHead(title: "Overdue", late: true)
                ForEach(overdue) { row($0, meta: shortDate(DateKit.date($0.dueAt) ?? now), late: true) }
            }

            if only != .overdue {
                SectionHead(title: isToday ? "Today" : shortDate(shown))
                if line.isEmpty && floating.isEmpty {
                    Text("Nothing planned.").font(FN.font(15)).foregroundStyle(p.textMuted).padding(.vertical, 8)
                }
                ForEach(Array(line.enumerated()), id: \.element.id) { index, item in
                    if isToday && only == nil && nextIndex == index { nowLine }
                    if let todo = item.todo, only != .meetings {
                        row(todo, meta: Fmt.time(item.at))
                    } else if let meeting = item.meeting, only != .tasks {
                        PlanMeetingRow(meeting: meeting, recordable: isToday)
                    }
                }
                if isToday && only == nil && nextIndex == nil && !line.isEmpty { nowLine }
            }

            if only != .overdue && only != .meetings && !floating.isEmpty {
                SectionHead(title: "Anytime")
                ForEach(floating) { row($0) }
            }
        }
    }

    private struct Item: Identifiable {
        let id: String
        let at: Date
        var todo: Todo?
        var meeting: Meeting?
    }

    /// Tasks with a time and meetings, on one line through the day.
    private func timeline(_ tasks: [Todo], _ meetings: [Meeting]) -> [Item] {
        let timedTasks: [Item] = tasks.compactMap { t in
            guard let at = DateKit.date(t.dueAt), timed(at) else { return nil }
            return Item(id: t.id, at: at, todo: t)
        }
        return (timedTasks + meetings.map { Item(id: $0.id, at: $0.start, meeting: $0) }).sorted { $0.at < $1.at }
    }

    private func row(_ todo: Todo, meta: String? = nil, late: Bool = false) -> some View {
        PlanTaskRow(todo: todo, meta: meta, late: late, selected: openId == todo.id,
                    onOpen: { onOpen(todo.id) }, onToggle: { onToggle(todo) })
    }

    private var nowLine: some View {
        HStack(spacing: 10) {
            Text(Fmt.time(now)).font(FN.font(12, .bold)).monospacedDigit().foregroundStyle(p.danger)
            Rectangle().fill(p.spark.opacity(0.7)).frame(height: 1.5)
        }
        .padding(.vertical, 2)
    }

    private var strip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 2) {
                ForEach(-Self.before..<(Self.strip - Self.before), id: \.self) { i in
                    dayCell(i)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.never)
        .padding(.horizontal, -6)
    }

    private func dayCell(_ i: Int) -> some View {
        let d = day(i)
        let selected = i == offset
        let busy = tasks(on: d).contains { !$0.done } || !meetings(on: d).isEmpty
        let tone = i == 0 ? p.danger : p.foreground
        return Button {
            offset = i
            only = nil
        } label: {
            VStack(spacing: 4) {
                Text(d.formatted(.dateTime.weekday(.abbreviated)))
                    .font(FN.font(12))
                    .foregroundStyle(i == 0 ? p.danger : p.textMuted)
                Text("\(cal.component(.day, from: d))")
                    .font(FN.font(21, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(tone)
            }
            .frame(width: 58, height: 70)
            .overlay(alignment: .bottom) {
                if busy { Circle().fill(p.borderStrong).frame(width: 4, height: 4).padding(.bottom, 7) }
            }
            .background(selected ? p.surface : .clear, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
            .overlay {
                if selected {
                    RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
    }

    private func summary(open: Int, meetings: Int, overdue: Int, isToday: Bool) -> some View {
        HStack(spacing: 8) {
            Text(isToday ? "Today you have" : "That day has").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
            chip("\(open) \(open == 1 ? "task" : "tasks")", .tasks)
            if meetings > 0 { chip("\(meetings) \(meetings == 1 ? "meeting" : "meetings")", .meetings, red: true) }
            if overdue > 0 { chip("\(overdue) overdue", .overdue, red: true) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
        .padding(.top, 16)
    }

    private func chip(_ text: String, _ kind: Only, red: Bool = false) -> some View {
        Button { only = only == kind ? nil : kind } label: {
            Text(text)
                .font(FN.font(14, .semibold))
                .monospacedDigit()
                .foregroundStyle(red ? p.danger : p.textSecondary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(red ? p.dangerSubtle : p.surfaceMuted, in: Capsule(style: .circular))
                .overlay { if only == kind { Capsule(style: .circular).strokeBorder(red ? p.danger : p.textSecondary, lineWidth: 1.5) } }
                .contentShape(Capsule(style: .circular))
        }
        .buttonStyle(.fn)
    }
}

/// A calendar meeting in the day, with Record while it's today.
private struct PlanMeetingRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @ObservedObject private var recorder = TalkRecorder.shared
    @State private var starting = false
    let meeting: Meeting
    let recordable: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Circle().fill(p.spark).frame(width: 9, height: 9).frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(meeting.title).font(FN.font(16, .medium)).foregroundStyle(p.foreground).lineLimit(1)
                HStack(spacing: 10) {
                    Text(NextMeeting.range(meeting)).font(FN.font(13.5, .semibold)).monospacedDigit().foregroundStyle(p.textSecondary)
                    if !meeting.detail.isEmpty {
                        Text(meeting.detail).font(FN.font(13.5)).foregroundStyle(p.textMuted).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 8)
            if recordable {
                PrimaryButton(title: starting ? "Starting…" : "Record", icon: "mic", disabled: starting || recorder.isActive, small: true, action: record)
                    .fixedSize()
            }
        }
        .padding(10)
        .padding(.horizontal, -10)
    }

    private func record() {
        starting = true
        Task {
            defer { starting = false }
            do {
                nav.selectedTalkId = try await MeetingRecording.record(meeting, join: false)
                nav.tab = .transcribe
            } catch {
                toasts.push(error.localizedDescription, tone: .error)
            }
        }
    }
}

struct PlannerList: View {
    @Environment(\.palette) private var p
    let todos: [Todo]
    let openId: String?
    let onOpen: (String) -> Void
    let onToggle: (Todo) -> Void
    @State private var showDone = false

    private static let groups = ["Overdue", "Today", "This week", "Later"]
    private let cal = Calendar.current

    private func group(_ t: Todo) -> String {
        guard let due = DateKit.date(t.dueAt) else { return "Later" }
        let today = cal.startOfDay(for: Date())
        if due < today { return "Overdue" }
        if cal.isDateInToday(due) { return "Today" }
        return due < today.addingTimeInterval(7 * 86_400) ? "This week" : "Later"
    }

    private func when(_ t: Todo) -> String? {
        guard let due = DateKit.date(t.dueAt) else { return nil }
        if cal.isDateInToday(due) {
            let c = cal.dateComponents([.hour, .minute], from: due)
            return (c.hour == 23 && c.minute == 59) || (c.hour == 0 && c.minute == 0) ? nil : Fmt.time(due)
        }
        return shortDate(due)
    }

    var body: some View {
        let open = todos.filter { !$0.done }.sorted { ($0.dueAt ?? "9") < ($1.dueAt ?? "9") }
        let weekAgo = Date().addingTimeInterval(-7 * 86_400)
        let done = todos.filter { $0.done && (DateKit.date($0.completedAt).map { $0 >= weekAgo } ?? false) }
            .sorted { ($0.completedAt ?? "") > ($1.completedAt ?? "") }

        VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.groups, id: \.self) { g in
                let items = open.filter { group($0) == g }
                if !items.isEmpty {
                    SectionHead(title: g, late: g == "Overdue")
                    ForEach(items) { row($0, late: g == "Overdue") }
                }
            }
            if open.isEmpty {
                Text("Nothing open. Well done.").font(FN.font(15)).foregroundStyle(p.textMuted).padding(.vertical, 12)
            }
            if !done.isEmpty {
                Button { showDone.toggle() } label: {
                    HStack(spacing: 4) {
                        Text("Done this week · \(done.count)").font(FN.font(13, .semibold))
                        Icon("chevronDown", size: 14).rotationEffect(.degrees(showDone ? 180 : 0))
                    }
                    .foregroundStyle(p.textMuted)
                    .padding(.top, 22)
                    .padding(.bottom, 6)
                }
                .buttonStyle(.fn)
                if showDone { ForEach(done) { row($0) } }
            }
        }
    }

    private func row(_ t: Todo, late: Bool = false) -> some View {
        PlanTaskRow(todo: t, meta: when(t), late: late, selected: openId == t.id,
                    onOpen: { onOpen(t.id) }, onToggle: { onToggle(t) })
    }
}
