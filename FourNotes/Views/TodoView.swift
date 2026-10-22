import SwiftUI
import UniformTypeIdentifiers

// A board (To do, Doing, Done) with the open task in a panel beside it, as on the web
// (src/components/TodoView.tsx). Columns are neutral; colour marks only real status
// (due soon, overdue), always with words. Filters narrow the board; they never change
// a task.

private let DONE_SHOWN = 30
/// Narrower than this and labels, titles and dates start breaking mid-word;
/// the board scrolls sideways instead, as the web app's does.
private let COLUMN_MIN: CGFloat = 250

/// What the board shows: everything, or one kind of task.
private enum BoardFilter: String, CaseIterable {
    case all, week, repeating, bills, linked

    var label: String {
        switch self {
        case .all: return "All"
        case .week: return "Due this week"
        case .repeating: return "Repeating"
        case .bills: return "Bills"
        case .linked: return "Linked to a note"
        }
    }

    func test(_ t: Todo) -> Bool {
        switch self {
        case .all: return true
        case .week: return DateKit.date(t.dueAt).map { $0 < Date().addingTimeInterval(7 * 86_400) } ?? false
        case .repeating: return t.rrule != nil
        case .bills: return t.bill != nil
        case .linked: return t.noteId != nil
        }
    }
}

extension BoardColumn {
    var empty: String {
        switch self {
        case .todo: return "Nothing to do"
        case .doing: return "Nothing in progress"
        case .done: return "Nothing done yet"
        }
    }

    var hint: String {
        switch self {
        case .todo: return "Add a task, or drag one back here."
        case .doing: return "Drag a task here when you start it."
        case .done: return "Finished tasks land here."
        }
    }

    var label: String {
        switch self {
        case .todo: return "To do"
        case .doing: return "Doing"
        case .done: return "Done"
        }
    }

    func hue(_ p: Palette) -> Color {
        switch self {
        case .todo: return p.boardRed
        case .doing: return p.boardAmber
        case .done: return p.boardGreen
        }
    }

    func ink(_ p: Palette) -> Color {
        switch self {
        case .todo: return p.boardRedInk
        case .doing: return p.boardAmberInk
        case .done: return p.boardGreenInk
        }
    }
}

struct TodoView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter

    @State private var openId: String?
    /// The task "New" just made: removed again if it's closed while still empty.
    @State private var fresh: String?
    @State private var dragging: String?
    @State private var dropTarget: BoardColumn?
    @State private var showAllDone = false
    /// The open task fills the page instead of sitting beside the board.
    @State private var expanded = false
    @State private var cleanedUp = false
    @State private var boardWidth: CGFloat = 0
    @State private var filter: BoardFilter = .all

    private var live: [Todo] { store.liveTodos }
    private var openTodo: Todo? { live.first { $0.id == openId } }

    private func column(_ c: BoardColumn) -> [Todo] {
        let items = live.filter { $0.column == c && filter.test($0) }
        // Soonest first (overdue on top); undated tasks after dated ones, newest first.
        if c == .done {
            return items.sorted { ($0.completedAt ?? $0.updatedAt) > ($1.completedAt ?? $1.updatedAt) }
        }
        return items.sorted {
            let a = $0.dueAt ?? "~", b = $1.dueAt ?? "~"
            return a == b ? $0.createdAt > $1.createdAt : a < b
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            if !(expanded && openTodo != nil) {
                VStack(alignment: .leading, spacing: 0) {
                    toolbar

                    if live.isEmpty {
                        EmptyStart(
                            title: "Nothing to do yet",
                            hint: "Press New, or ask the assistant — it understands dates, reminders and repeats.",
                            prompts: ["Remind me to pay rent every month on the 5th at 9am",
                                      "Call the dentist tomorrow at 10am"])
                    }

                    board
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                .transition(.opacity)
            }

            if let todo = openTodo {
                TaskPanel(todo: todo, isNew: fresh == todo.id, expanded: expanded,
                          onToggleExpand: { expanded.toggle() },
                          onClose: close, onMove: { move(todo.id, to: $0) })
                    // Without this the panel keeps its state between tasks: task
                    // A's reminder suggestion stays on screen for task B, and a
                    // new task's title field never takes focus.
                    .id(todo.id)
                    .frame(width: expanded ? nil : 420)
                    .frame(maxWidth: expanded ? .infinity : nil)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(Motion.screen, value: openId)
        .animation(Motion.screen, value: expanded)
        .onAppear(perform: cleanUpBlanks)
        .task(id: nav.focus) {
            guard let link = nav.consumeFocus([.todos]) else { return }
            if live.first(where: { $0.id == link.id })?.done == true { showAllDone = true }
            show(link.id)
        }
    }

    /// "2 open, 1 done this week", New, and the filters.
    private var toolbar: some View {
        let weekAgo = Date().addingTimeInterval(-7 * 86_400)
        let doneThisWeek = live.filter { $0.done && (DateKit.date($0.completedAt).map { $0 >= weekAgo } ?? false) }.count
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text("\(live.filter { !$0.done }.count) open, \(doneThisWeek) done this week")
                    .font(FN.font(16))
                    .monospacedDigit()
                    .foregroundStyle(p.textSecondary)
                Spacer()
                PrimaryButton(title: "New task", icon: "plus") { create(.todo) }
            }
            if !live.isEmpty {
                HStack(spacing: 8) {
                    ForEach(BoardFilter.allCases, id: \.self) { f in
                        PillButton(title: f.label, selected: filter == f) {
                            withAnimation(Motion.standard) { filter = f }
                        }
                    }
                }
            }
        }
        .padding(.top, -8)
        .padding(.bottom, 20)
    }


    /// The three columns share the width, never narrower than COLUMN_MIN;
    /// past that the row scrolls sideways. One layout for both cases: it used
    /// to switch between two (ViewThatFits), and a card could keep the narrow
    /// width it had while the task panel was open, its chips spilling out.
    private var board: some View {
        let spacing: CGFloat = 16
        let fits = (boardWidth - spacing * 2) / 3
        let width = max(COLUMN_MIN, fits.isFinite ? fits : COLUMN_MIN)
        let overflows = fits < COLUMN_MIN
        return ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: spacing) {
                ForEach(BoardColumn.allCases) { col in
                    columnView(col).frame(width: width, alignment: .top)
                }
            }
            .padding(.bottom, overflows ? 10 : 0)
        }
        .scrollDisabled(!overflows)
        .scrollIndicators(overflows ? .automatic : .hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { boardWidth = $0 }
    }

    // MARK: - Column

    private func columnView(_ col: BoardColumn) -> some View {
        let items = column(col)
        let shown = col == .done && !showAllDone ? Array(items.prefix(DONE_SHOWN)) : items
        let isDropTarget = dropTarget == col && dragging != nil

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(col.label)
                    .font(FN.bodyMedium)
                    .foregroundStyle(p.foreground)
                    .lineLimit(1)
                    .fixedSize()
                Text("\(items.count)")
                    .font(FN.font(13)).monospacedDigit()
                    .foregroundStyle(p.textMuted)
                    .fixedSize()
                    .contentTransition(.numericText())
                Spacer()
                IconButton("plus", size: 16, box: 32, help: "Add to \(col.label)") { create(col) }
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .frame(height: 40)

            if shown.isEmpty {
                VStack(spacing: 6) {
                    Text(filter == .all ? col.empty : "Nothing here")
                        .font(FN.font(16, .medium))
                        .foregroundStyle(p.foreground)
                    Text(filter == .all ? col.hint : "No tasks in this column match the filter.")
                        .font(FN.font(13))
                        .foregroundStyle(p.textMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                .padding(.vertical, 28)
                .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
                    .strokeBorder(p.borderStrong, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                .transition(.opacity)
            }

            ForEach(shown) { todo in
                TodoCard(todo: todo, column: col, selected: openId == todo.id,
                         dragging: dragging == todo.id,
                         onOpen: { show(todo.id) },
                         onToggle: { move(todo.id, to: todo.done ? .todo : .done) })
                    .onDrag {
                        dragging = todo.id
                        return NSItemProvider(object: todo.id as NSString)
                    }
                    .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
            .animation(Motion.list, value: items.map(\.id))

            if col == .done, items.count > shown.count {
                GhostButton(action: { showAllDone = true }) {
                    Text("Show \(items.count - shown.count) older").frame(maxWidth: .infinity)
                }
            }

            // Done has none, as on the web: tasks get there by being done.
            if col != .done {
                Button { create(col) } label: {
                    NewTaskRow()
                }
                .buttonStyle(.fn)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .top)
        .background(isDropTarget ? p.accent.mixed(with: p.surfaceMuted, ratio: 0.95) : p.surfaceMuted,
                    in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous)
            .strokeBorder(p.accent.opacity(isDropTarget ? 1 : 0), lineWidth: 1.5))
        .motion(isDropTarget, Motion.quick)
        .onDrop(of: [.text], delegate: ColumnDrop(column: col, dragging: $dragging,
                                                  dropTarget: $dropTarget, move: move))
    }

    // MARK: - Actions

    /// Moves a task between columns; finishing one still logs its bill and
    /// schedules the next repeat.
    private func move(_ id: String, to: BoardColumn) {
        guard let t = live.first(where: { $0.id == id }), t.column != to else { return }
        if to == .done {
            let extra = store.toggleTodo(id, done: true)
            if !extra.isEmpty { toasts.push(extra.joined(separator: "\n")) }
            return
        }
        if t.done { store.toggleTodo(id, done: false) }
        store.updateTodo(id) { $0.doing = (to == .doing) }
    }

    /// A task made with "New" that was closed before anything was typed into it.
    private func isBlank(_ t: Todo) -> Bool {
        t.deletedAt == nil && t.title.trimmingCharacters(in: .whitespaces).isEmpty
            && (t.notes ?? "").trimmingCharacters(in: .whitespaces).isEmpty
            && t.dueAt == nil && t.remindAt == nil && t.bill == nil && t.rrule == nil && t.noteId == nil
    }

    private func dropFresh(except: String? = nil) {
        // A title typed a moment ago may still be waiting out its debounce:
        // write it first, or "Buy milk" + Esc deleted the task as blank.
        PendingWrites.flushAll()
        if let fresh, fresh != except, let t = live.first(where: { $0.id == fresh }), isBlank(t) {
            store.remove(.todos, t.id)
        }
        if fresh != except { fresh = nil }
    }

    private func show(_ id: String) {
        dropFresh(except: id)
        openId = id
    }

    private func close() {
        dropFresh()
        openId = nil
        expanded = false
    }

    private func create(_ column: BoardColumn) {
        dropFresh()
        let t = store.addTodo { $0.title = "" }
        switch column {
        case .doing: store.updateTodo(t.id) { $0.doing = true }
        case .done: store.updateTodo(t.id) { $0.done = true; $0.completedAt = DateKit.nowIso() }
        case .todo: break
        }
        fresh = t.id
        openId = t.id
    }

    /// Empty tasks left behind (e.g. by switching tabs) are cleaned up when To-Do opens.
    private func cleanUpBlanks() {
        guard !cleanedUp else { return }
        cleanedUp = true
        let cutoff = Date().addingTimeInterval(-10)
        for t in store.todos where isBlank(t) && (DateKit.date(t.updatedAt).map { $0 < cutoff } ?? false) {
            store.remove(.todos, t.id)
        }
    }
}

// MARK: - Drop target

private struct ColumnDrop: DropDelegate {
    let column: BoardColumn
    @Binding var dragging: String?
    @Binding var dropTarget: BoardColumn?
    let move: (String, BoardColumn) -> Void

    func dropEntered(info: DropInfo) { if dragging != nil { dropTarget = column } }
    func dropExited(info: DropInfo) { if dropTarget == column { dropTarget = nil } }
    func validateDrop(info: DropInfo) -> Bool { dragging != nil }

    func performDrop(info: DropInfo) -> Bool {
        defer { dragging = nil; dropTarget = nil }
        guard let id = dragging else { return false }
        move(id, column)
        return true
    }
}

// MARK: - Card

private struct TodoCard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @State private var hovering = false

    let todo: Todo
    let column: BoardColumn
    let selected: Bool
    let dragging: Bool
    let onOpen: () -> Void
    let onToggle: () -> Void

    private var note: Note? {
        todo.noteId.flatMap { id in store.liveNotes.first { $0.id == id } }
    }

    private var overdue: Bool {
        !todo.done && (DateKit.date(todo.dueAt).map { $0 < Date() } ?? false)
    }

    /// Overdue, or due within three days: the only times a task takes a status colour.
    private var status: (text: String, danger: Bool)? {
        guard !todo.done, let iso = todo.dueAt, let due = DateKit.date(iso) else { return nil }
        if due < Date() { return ("Overdue", true) }
        let n = CardDates.dayDiff(due)
        if n > 3 { return nil }
        return (n == 0 ? "Due today, \(CardDates.clock(due))" : n == 1 ? "Due tomorrow, \(CardDates.clock(due))" : "Due in \(n) days", false)
    }

    /// What the card says besides its title, in the order it's read, as on the web.
    private var meta: [(key: String, icon: String, text: String)] {
        var out: [(key: String, icon: String, text: String)] = []
        if todo.done {
            if let done = DateKit.date(todo.completedAt) { out.append(("done", "check", CardDates.doneWhen(done))) }
        } else {
            if let due = DateKit.date(todo.dueAt), status == nil || status?.danger == true {
                out.append(("due", "calendar", CardDates.when(due)))
            }
            if let rule = todo.rrule, let short = CardDates.repeatShort(rule) { out.append(("repeat", "repeat", short)) }
            if let remind = DateKit.date(todo.remindAt) {
                let sameDay = DateKit.date(todo.dueAt).map { CardDates.dayDiff($0) == CardDates.dayDiff(remind) } ?? false
                out.append(("remind", "bell", sameDay ? CardDates.clock(remind) : CardDates.when(remind)))
            }
            if todo.priority != .medium { out.append(("priority", "flag", todo.priority == .high ? "High" : "Low")) }
        }
        if let note { out.append(("note", "link", note.title.isEmpty ? "Note" : note.title)) }
        return out
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onToggle) {
                ZStack {
                    Circle()
                        .strokeBorder(todo.done ? p.accent : (hovering ? p.textMuted : p.borderStrong), lineWidth: 1.5)
                        .background(Circle().fill(todo.done ? p.accent : .clear))
                        .frame(width: 20, height: 20)
                    if todo.done {
                        Icon("check", size: 12, weight: 2.5).foregroundStyle(p.accentForeground)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    }
                }
                .padding(.top, 1)
                .contentShape(Circle().inset(by: -6))
                .motion(todo.done, Motion.standard)
            }
            .buttonStyle(.fn)
            .accessibilityLabel(todo.done ? "Mark as not done" : "Mark as done")

            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: todo.done ? 6 : 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(todo.title.isEmpty ? "New task" : todo.title)
                            .font(FN.body)
                            .lineSpacing(3)
                            .foregroundStyle(todo.done || todo.title.isEmpty ? p.textMuted : p.foreground)
                            .strikethrough(todo.done)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        if let bill = todo.bill {
                            Text(Money.format(bill.amount, bill.currency ?? store.settings.currency))
                                .font(FN.font(13))
                                .monospacedDigit()
                                .foregroundStyle(p.textSecondary)
                        }
                    }

                    let meta = meta
                    if !meta.isEmpty || status != nil {
                        FlowLayout(spacing: 6, alignment: .leading) {
                            if let status {
                                // The kit's `.badge .badge-dot`, in the status's tone.
                                StatusPill(text: status.text, tone: status.danger ? .bad : .warn)
                            }
                            ForEach(meta, id: \.key) { m in
                                if m.key == "done" {
                                    Text(m.text).font(FN.small).foregroundStyle(p.textMuted)
                                } else {
                                    chip(m.icon, m.text)
                                        .frame(maxWidth: m.key == "note" ? 160 + 28 : nil, alignment: .leading)
                                }
                            }
                        }
                        .transition(.opacity.combined(with: .offset(y: -4)))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .animation(Motion.standard, value: meta.map(\.key))
            }
            .buttonStyle(.fn)
        }
        .padding(14)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
            .strokeBorder(selected ? p.accent : (hovering ? p.borderStrong : p.border), lineWidth: 1))
        .background(RoundedRectangle(cornerRadius: FN.radiusControl + 3, style: .continuous)
            .fill(selected ? p.accentSubtle : .clear).padding(-3))
        .opacity(dragging ? 0.4 : 1)
        .scaleEffect(dragging ? 0.97 : 1)
        .motion(hovering || dragging || selected, Motion.quick)
        .motion(todo.done, Motion.standard)
        .flashes(nav.isFlashing(todo.id), palette: p)
        .onHover { hovering = $0 }
    }

    /// A small grey label on a card: date, repeat, reminder, linked note.
    private func chip(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            Icon(icon, size: 12)
            Text(text).lineLimit(1).monospacedDigit()
        }
        .font(FN.small)
        .foregroundStyle(p.textSecondary)
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(p.surfaceMuted, in: Capsule())
    }
}

/// "+ Add a task" at the foot of a column: plain until hovered.
private struct NewTaskRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Icon("plus", size: 16)
            Text("Add a task").font(FN.body).lineLimit(1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(hovering ? p.foreground : p.textMuted)
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(hovering ? p.hover : .clear, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
    }
}

/// How a card says when, as on the web: "Today, 6:00 PM", "Yesterday, 6:00 PM",
/// "Sat, Oct 24, 9:00 AM"; "Done today", "Done Oct 20"; "Monthly", "Every 2 weeks".
private enum CardDates {
    static func dayDiff(_ date: Date, now: Date = Date()) -> Int {
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: date)).day ?? 0
    }

    static func clock(_ date: Date) -> String { Fmt.time(date) }

    static func when(_ date: Date, now: Date = Date()) -> String {
        let n = dayDiff(date, now: now)
        let day: String
        switch n {
        case 0: day = "Today"
        case 1: day = "Tomorrow"
        case -1: day = "Yesterday"
        default:
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US")
            let sameYear = Calendar.current.isDate(date, equalTo: now, toGranularity: .year)
            f.dateFormat = sameYear ? "EEE, MMM d" : "EEE, MMM d, yyyy"
            day = f.string(from: date)
        }
        return "\(day), \(clock(date))"
    }

    static func doneWhen(_ date: Date, now: Date = Date()) -> String {
        switch dayDiff(date, now: now) {
        case 0: return "Done today"
        case -1: return "Done yesterday"
        default:
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US")
            f.dateFormat = "MMM d"
            return "Done \(f.string(from: date))"
        }
    }

    static func repeatShort(_ rrule: String) -> String? {
        guard let rule = Recurrence.parse(rrule) else { return nil }
        guard rule.interval == 1 else { return Recurrence.label(rrule) }
        return ["day": "Daily", "week": "Weekly", "month": "Monthly", "year": "Yearly"][rule.freq.unit] ?? Recurrence.label(rrule)
    }
}
