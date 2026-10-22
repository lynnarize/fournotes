import AppKit
import SwiftUI

// A task opened beside the board, in the same card as the Notes editor.
// Ported from the TaskPanel part of src/components/TodoView.tsx.

struct TaskPanel: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter

    let todo: Todo
    let isNew: Bool
    var expanded = false
    var onToggleExpand: () -> Void = {}
    let onClose: () -> Void
    let onMove: (BoardColumn) -> Void

    @State private var suggestion: (at: String, reason: String)?
    @FocusState private var titleFocused: Bool
    @FocusState private var detailsFocused: Bool

    private var note: Note? {
        todo.noteId.flatMap { id in store.liveNotes.first { $0.id == id } }
    }

    private var rule: Recurrence.Rule? { Recurrence.parse(todo.rrule) }

    private var autoSuggestion: (at: String, reason: String)? {
        guard !todo.done, todo.remindAt == nil else { return nil }
        return Insights.suggestReminder(todo, store.liveTodos)
    }

    private var shownSuggestion: (at: String, reason: String)? { suggestion ?? autoSuggestion }

    private var created: String {
        guard let d = DateKit.date(todo.createdAt) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d, yyyy, h:mm a"
        return f.string(from: d)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    title
                    // The status, as a segmented control across the panel.
                    SegmentedTabs(items: BoardColumn.allCases.map { ($0.rawValue, $0.label) },
                                  selection: Binding(get: { todo.column.rawValue },
                                                     set: { if let col = BoardColumn(rawValue: $0) { onMove(col) } }),
                                  fill: true)
                    VStack(alignment: .leading, spacing: 0) {
                        properties
                        if let rrule = todo.rrule {
                            Text("\(Recurrence.label(rrule)), completing it schedules the next one")
                                .font(FN.small)
                                .foregroundStyle(p.textMuted)
                                .padding(.top, 12)
                        }
                    }
                    calendar
                    details
                }
                .padding(.horizontal, 24)
                .padding(.top, expanded ? 36 : 12)
                .padding(.bottom, 24)
                .frame(maxWidth: expanded ? 672 : .infinity)
                .frame(maxWidth: .infinity)
            }
            footer
        }
        .background(p.surface)
        .clipShape(RoundedRectangle(cornerRadius: expanded ? 0 : FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous)
            .strokeBorder(expanded ? .clear : p.border, lineWidth: 1))
        .frame(maxHeight: expanded ? .infinity : 760)
        .onAppear { if isNew { titleFocused = true } }
    }

    // MARK: - Header and foot

    /// "Task", and the buttons to open it full width and to close it.
    private var header: some View {
        HStack(spacing: 4) {
            Text("Task")
                .font(FN.font(13))
                .foregroundStyle(p.textMuted)
                .padding(.leading, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
            IconButton(expanded ? "shrink" : "expand", size: 18, box: 36,
                       help: expanded ? "Back to side panel" : "Open full screen", action: onToggleExpand)
            IconButton("x", size: 18, box: 36, help: "Close (Esc)", action: onClose)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    /// Delete on the left; done (or paid, for a bill) on the right.
    private var footer: some View {
        HStack(spacing: 8) {
            KitButton(kind: .danger, title: "Delete", large: true) {
                let id = todo.id
                store.remove(.todos, id)
                toasts.push("Task deleted", action: Toast.Action(label: "Undo") { [store] in
                    store.updateTodo(id) { $0.deletedAt = nil }
                })
                onClose()
            }
            Spacer(minLength: 0)
            if todo.done {
                KitButton(kind: .secondary, title: "Mark as not done", large: true) { onMove(.todo) }
            } else {
                KitButton(kind: .primary, title: todo.bill != nil ? "Mark as paid" : "Mark as done",
                          icon: "check", large: true) { onMove(.done) }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .overlay(alignment: .top) { Rectangle().fill(p.borderSubtle).frame(height: 1) }
    }

    /// Google opens a prefilled event; Apple and Outlook take an .ics file.
    private var calendar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Add to calendar").font(FN.font(13)).foregroundStyle(p.textMuted)
            HStack(spacing: 8) {
                calendarButton("Google") { openURL(Calendars.googleURL(todo)) }
                calendarButton("Apple") { Calendars.exportIcs(todo, toasts: toasts) }
                    .help("Saves an .ics file")
                calendarButton("Outlook") { Calendars.exportIcs(todo, toasts: toasts) }
                    .help("Saves an .ics file")
            }
        }
    }

    private func calendarButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(FN.font(13, .medium))
                .foregroundStyle(p.foreground)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .background(p.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.fn)
    }

    // MARK: - Title and details

    private var title: some View {
        // 22pt medium beside the board; the display face when it has the page.
        CommittedField(placeholder: "New task", value: todo.title,
                       font: expanded ? FN.display(32) : FN.font(22, .medium), axis: .vertical) { value in
            store.updateTodo(todo.id) { $0.title = value.replacingOccurrences(of: "\n", with: " ") }
        }
        .tracking(expanded ? FN.displayTracking(32) : -0.02 * 22)
        .foregroundStyle(todo.done ? p.faint : p.text)
        .strikethrough(todo.done)
        .focused($titleFocused)
    }

    /// The kit's textarea `.field`: 14pt in, relaxed lines.
    private var details: some View {
        CommittedField(placeholder: "Add details, links or steps", value: todo.notes ?? "",
                       boxed: true, axis: .vertical, minHeight: 112) { value in
            store.updateTodo(todo.id) { $0.notes = value.isEmpty ? nil : value }
        }
        .lineSpacing(5)
        .focused($detailsFocused)
    }

    // MARK: - Properties

    private var properties: some View {
        // One bordered group, a hairline between rows, as the web's.
        VStack(spacing: 0) {
            prop("calendar", "Due") {
                OptionalDateField(value: todo.dueAt) { iso in
                    store.updateTodo(todo.id) {
                        $0.dueAt = iso
                        $0.rrule = recurrenceAnchored(to: iso)
                    }
                }
            }

            prop("bell", "Remind") {
                VStack(alignment: .leading, spacing: 6) {
                    OptionalDateField(value: todo.remindAt) { iso in
                        suggestion = nil
                        store.updateTodo(todo.id) { $0.remindAt = iso; $0.reminded = false }
                    }
                    if let s = shownSuggestion {
                        HStack(spacing: 8) {
                            Icon("sparkle", size: 12)
                            Text("\(Fmt.due(s.at)) · \(s.reason)")
                                .font(FN.small)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            Button("Use") {
                                store.updateTodo(todo.id) { $0.remindAt = s.at; $0.reminded = false }
                                suggestion = nil
                            }
                            .buttonStyle(.fn)
                            .font(FN.font(12, .medium))
                            .foregroundStyle(p.accent)
                        }
                        .foregroundStyle(p.text)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(p.stickyBlue, in: RoundedRectangle(cornerRadius: FN.radiusSmall, style: .continuous))
                        .transition(.opacity.combined(with: .offset(y: -6)))
                    } else if !todo.done && todo.remindAt == nil {
                        Button("✨ Suggest a time") {
                            if let s = Insights.suggestReminder(todo, store.liveTodos) {
                                suggestion = s
                            } else {
                                toasts.push("Complete a few tasks first so the app can learn when you usually get things done.")
                            }
                        }
                        .buttonStyle(.fn)
                        .font(FN.small)
                        .foregroundStyle(p.accent)
                        .transition(.opacity.combined(with: .offset(y: 6)))
                    }
                }
                .animation(Motion.standard, value: shownSuggestion?.at ?? "none")
            }

            prop("repeat", "Repeats") {
                HStack(spacing: 8) {
                    SelectMenu(options: [("", "Doesn't repeat"), ("DAILY", "Daily"), ("WEEKLY", "Weekly"),
                                         ("MONTHLY", "Monthly"), ("YEARLY", "Yearly")],
                               selection: Binding(
                        get: { rule?.freq.rawValue ?? "" },
                        set: { raw in
                            store.updateTodo(todo.id) {
                                $0.rrule = raw.isEmpty ? nil
                                    : recurrence(freq: Freq(rawValue: raw) ?? .MONTHLY,
                                                 interval: rule?.interval ?? 1)
                            }
                        }), quiet: true)
                        .fixedSize()

                    if let rule {
                        Text("every").font(FN.body).foregroundStyle(p.muted)
                        NumberStepper(value: Binding(
                            get: { rule.interval },
                            set: { newValue in
                                store.updateTodo(todo.id) {
                                    $0.rrule = recurrence(freq: rule.freq,
                                                          interval: max(1, newValue))
                                }
                            }
                        ), range: 1...99)
                        .transition(.opacity.combined(with: .offset(x: -6)))
                    }
                }
                .animation(Motion.standard, value: rule != nil)
            }

            prop("flag", "Priority") {
                SelectMenu(options: [(Priority.high, "High"), (Priority.medium, "Medium"), (Priority.low, "Low")],
                           selection: Binding(
                    get: { todo.priority },
                    set: { value in store.updateTodo(todo.id) { $0.priority = value } }), quiet: true)
                    .fixedSize()
            }

            prop("bill", "Bill") {
                HStack(spacing: 8) {
                    AmountField(value: todo.bill?.amount ?? 0, currency: store.settings.currency,
                                placeholder: "Empty", alignment: .leading, emptyIsZero: true) { amount in
                        store.updateTodo(todo.id) {
                            $0.bill = amount > 0
                                ? Bill(amount: amount,
                                       currency: todo.bill?.currency,
                                       category: todo.bill?.category ?? "Bills & Utilities")
                                : nil
                        }
                    }
                    .font(FN.body)
                    .padding(.horizontal, 10)
                    .frame(width: 130, height: 36)
                    .background(p.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                    .help("Logs the spending when the task is done")

                    if let bill = todo.bill {
                        SelectMenu(options: store.categories.filter { $0 != "Income" }.map { ($0, $0) },
                                   selection: Binding(
                            get: { bill.category },
                            set: { category in
                                store.updateTodo(todo.id) { $0.bill?.category = category }
                            }), quiet: true)
                            .fixedSize()
                            .transition(.opacity.combined(with: .offset(x: -6)))
                    }
                }
                .animation(Motion.standard, value: todo.bill != nil)
            }

            prop("link", "Note") {
                HStack(spacing: 8) {
                    SelectMenu(options: [("", "Empty")] + store.liveNotes.map { ($0.id, $0.title.isEmpty ? "Untitled" : $0.title) },
                               selection: Binding(
                        get: { todo.noteId ?? "" },
                        set: { id in store.updateTodo(todo.id) { $0.noteId = id.isEmpty ? nil : id } }), quiet: true)
                        .frame(maxWidth: 240, alignment: .leading)

                    if let note {
                        KitButton(kind: .plain, title: "Open", small: true) { nav.open(ChangeLink(kind: .notes, id: note.id)) }
                            .transition(.opacity.combined(with: .offset(x: -5)))
                    }
                }
                .animation(Motion.standard, value: note != nil)
            }

            prop("clock", "Created", last: true) {
                Text(created).font(FN.body).monospacedDigit().foregroundStyle(p.textSecondary)
                    .padding(.horizontal, 10)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    /// Rebuild the rule from its frequency and interval while keeping a
    /// month-end date anchored to the task's actual due date.
    private func recurrence(freq: Freq, interval: Int) -> String? {
        let base = Recurrence.make(freq, interval)
        let anchor = DateKit.date(todo.dueAt) ?? DateKit.date(todo.remindAt)
        if freq == .MONTHLY || freq == .YEARLY, let anchor {
            return Recurrence.normalised(base, anchoredTo: anchor)
        }
        guard rule?.freq == freq else { return base }
        return Recurrence.make(freq, interval, monthDay: rule?.monthDay)
    }

    private func recurrenceAnchored(to iso: String?) -> String? {
        guard let rule else { return nil }
        let base = Recurrence.make(rule.freq, rule.interval)
        guard let date = DateKit.date(iso) else {
            return Recurrence.make(rule.freq, rule.interval, monthDay: rule.monthDay)
        }
        return Recurrence.normalised(base, anchoredTo: date)
    }

    /// One property row: its name on the left, the value on the right.
    private func prop<Content: View>(_ icon: String, _ label: String, last: Bool = false,
                                     @ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(label)
                    .font(FN.font(13))
                    .foregroundStyle(p.textMuted)
                    .lineLimit(1)
                    .frame(width: 76, alignment: .leading)
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, 14)
            .padding(.trailing, 8)
            .padding(.vertical, 6)
            .frame(minHeight: 48)
            if !last { Rectangle().fill(p.borderSubtle).frame(height: 1) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func openURL(_ url: URL?) {
        guard let url else { return }
        NSWorkspace.shared.open(url)
    }
}

/// A date-and-time field that can be empty, matching `<input type="datetime-local">`.
struct OptionalDateField: View {
    @Environment(\.palette) private var p
    let value: String?
    let onChange: (String?) -> Void

    var body: some View {
        HStack(spacing: 6) {
            if let date = DateKit.date(value) {
                DatePicker("", selection: Binding(
                    get: { date },
                    set: { onChange(DateKit.iso($0)) }),
                    displayedComponents: [.date, .hourAndMinute])
                    .labelsHidden()
                    .datePickerStyle(.compact)
                Button { onChange(nil) } label: {
                    Icon("x", size: 12).foregroundStyle(p.faint)
                }
                .buttonStyle(.fn)
                .help("Clear")
                .transition(.opacity.combined(with: .offset(x: -5)))
            } else {
                Button("Empty") { onChange(DateKit.iso(defaultDate)) }
                    .buttonStyle(.fn)
                    .font(FN.body)
                    .foregroundStyle(p.faint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .transition(.opacity.combined(with: .offset(x: 5)))
            }
        }
        .animation(Motion.standard, value: value != nil)
    }

    /// A sensible first pick: the next full hour.
    private var defaultDate: Date {
        let cal = Calendar.current
        let next = cal.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        return cal.date(bySetting: .minute, value: 0, of: next) ?? next
    }
}

// MARK: - Calendar export

enum Calendars {
    private static func stamp(_ iso: String) -> String {
        guard let d = DateKit.date(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return f.string(from: d)
    }

    private static func window(_ todo: Todo) -> (start: String, end: String) {
        let start = todo.dueAt ?? todo.remindAt ?? DateKit.nowIso()
        let end = DateKit.date(start).map { DateKit.iso($0.addingTimeInterval(1800)) } ?? start
        return (start, end)
    }

    /// Opens Google Calendar prefilled — works without OAuth.
    static func googleURL(_ todo: Todo) -> URL? {
        let (start, end) = window(todo)
        var c = URLComponents(string: "https://calendar.google.com/calendar/render")
        var items = [
            URLQueryItem(name: "action", value: "TEMPLATE"),
            URLQueryItem(name: "text", value: todo.title),
            URLQueryItem(name: "details", value: todo.notes ?? "Created with Four Notes"),
            URLQueryItem(name: "dates", value: "\(stamp(start))/\(stamp(end))"),
        ]
        if let rrule = todo.rrule {
            let body = rrule.replacingOccurrences(of: "^RRULE:", with: "",
                                                  options: [.regularExpression, .caseInsensitive])
            items.append(URLQueryItem(name: "recur", value: "RRULE:\(body)"))
        }
        c?.queryItems = items
        return c?.url
    }

    /// .ics file for Apple Calendar / Outlook, with a built-in alarm.
    @MainActor
    static func exportIcs(_ todo: Todo, toasts: ToastCenter) {
        let (start, end) = window(todo)
        func esc(_ s: String) -> String {
            s.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: ",", with: "\\,")
                .replacingOccurrences(of: ";", with: "\\;")
                .replacingOccurrences(of: "\n", with: "\\n")
        }
        var lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Four Notes//EN", "BEGIN:VEVENT",
            "UID:\(todo.id)@fournotes", "DTSTAMP:\(stamp(DateKit.nowIso()))",
            "DTSTART:\(stamp(start))", "DTEND:\(stamp(end))", "SUMMARY:\(esc(todo.title))",
            "DESCRIPTION:\(esc(todo.notes ?? ""))",
        ]
        if let rrule = todo.rrule {
            lines.append("RRULE:" + rrule.replacingOccurrences(
                of: "^RRULE:", with: "", options: [.regularExpression, .caseInsensitive]))
        }
        lines += ["BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY",
                  "DESCRIPTION:\(esc(todo.title))", "END:VALARM", "END:VEVENT", "END:VCALENDAR"]

        let panel = NSSavePanel()
        panel.nameFieldStringValue = String(todo.title.prefix(40)) + ".ics"
        panel.allowedContentTypes = [.calendarEvent]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try lines.joined(separator: "\r\n").write(to: url, atomically: true, encoding: .utf8)
            toasts.push("Saved \(url.lastPathComponent)")
        } catch {
            toasts.push("Could not save: \(error.localizedDescription)", tone: .error)
        }
    }
}
