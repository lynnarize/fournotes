import AppKit
import UserNotifications

// The notifications Transcribe sends, each with the button that does the obvious thing:
// a meeting about to start (Start transcribing, or Join and transcribe when it has a
// link), a call that began without one (Start transcribing), and a call that ended while
// it was being recorded (Stop recording). Without notifications allowed, the same
// offer comes as a toast in the app.

@MainActor
enum MeetingAlerts {
    nonisolated static let meetingCategory = "fournotes.meeting"
    nonisolated static let meetingLinkCategory = "fournotes.meeting.link"
    nonisolated static let callCategory = "fournotes.call"
    nonisolated static let callEndedCategory = "fournotes.call.ended"
    /// Says the recording stopped with its call: nothing to press.
    nonisolated static let callStoppedCategory = "fournotes.call.stopped"

    private static let startAction = "fournotes.start"
    private static let joinAction = "fournotes.join"
    private static let stopAction = "fournotes.stop"
    /// Reminders' request ids: this, then the meeting's id.
    private static let reminderPrefix = "fournotes.meeting."

    /// Once, before launch finishes, so a button that opened the app still lands.
    static func registerCategories() {
        let start = UNNotificationAction(identifier: startAction, title: "Start transcribing", options: [.foreground])
        let join = UNNotificationAction(identifier: joinAction, title: "Join and transcribe", options: [.foreground])
        let stop = UNNotificationAction(identifier: stopAction, title: "Stop recording", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: meetingCategory, actions: [start], intentIdentifiers: []),
            UNNotificationCategory(identifier: meetingLinkCategory, actions: [join, start], intentIdentifiers: []),
            UNNotificationCategory(identifier: callCategory, actions: [start], intentIdentifiers: []),
            UNNotificationCategory(identifier: callEndedCategory, actions: [stop], intentIdentifiers: []),
            UNNotificationCategory(identifier: callStoppedCategory, actions: [], intentIdentifiers: []),
        ])
    }

    /// Transcribe's, rather than a task's reminder.
    nonisolated static func isOurs(_ category: String) -> Bool {
        [meetingCategory, meetingLinkCategory, callCategory, callEndedCategory, callStoppedCategory].contains(category)
    }

    // MARK: - Meetings

    /// Replaces the reminders waiting with these.
    static func schedule(_ reminders: [MeetingRules.Reminder]) async {
        let center = UNUserNotificationCenter.current()
        let waiting = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(reminderPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: waiting)
        guard !reminders.isEmpty, await allowed() else { return }
        for r in reminders {
            let m = r.meeting
            let content = UNMutableNotificationContent()
            let minutes = Int((m.start.timeIntervalSince(r.at) / 60).rounded())
            content.title = minutes > 0 ? "\(m.title) in \(minutes) min" : "\(m.title) is starting"
            content.body = [m.detail, m.link != nil ? "Join and transcribe it from here." : "Transcribe it from here."]
                .filter { !$0.isEmpty }.joined(separator: " · ")
            content.sound = .default
            content.categoryIdentifier = m.link != nil ? meetingLinkCategory : meetingCategory
            content.userInfo = ["meeting": m.id]
            let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: r.at)
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: reminderPrefix + m.id, content: content, trigger: trigger))
        }
    }

    /// A meeting being recorded needs no reminder.
    static func cancelReminder(_ meetingId: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [reminderPrefix + meetingId])
    }

    // MARK: - Calls

    /// An app began a call and nothing is recording.
    static func callStarted(_ app: CallApp, meeting: Meeting?) async {
        let title = meeting.map { "Transcribe “\($0.title)”?" } ?? "Transcribe this call?"
        let body = "\(app.name) is using the microphone."
        let info = ["bundle": app.bundleId, "meeting": meeting?.id ?? ""]
        if await post(title: title, body: body, category: callCategory, info: info, id: "fournotes.call") { return }
        AppModel.shared.toasts.push("\(app.name) is on a call. Transcribe it?", action: .init(label: "Start") {
            Task { await start(bundleId: app.bundleId, meetingId: meeting?.id) }
        })
    }

    /// The call being recorded ended: offer to stop, or say it stopped.
    static func callEnded(_ app: CallApp, stopped: Bool) async {
        if stopped {
            if await post(title: "Call ended", body: "\(app.name) hung up, so the recording stopped. It's being transcribed now.",
                          category: callStoppedCategory, info: [:], id: "fournotes.call.ended") { return }
            AppModel.shared.toasts.push("The call in \(app.name) ended. Recording stopped.")
            return
        }
        if await post(title: "Call ended. Stop recording?", body: "\(app.name) isn't using the microphone any more.",
                      category: callEndedCategory, info: [:], id: "fournotes.call.ended") { return }
        AppModel.shared.toasts.push("The call in \(app.name) ended. Stop recording?", action: .init(label: "Stop") {
            Task { await TalkRecorder.shared.stop() }
        })
    }

    // MARK: - Answers

    /// A notification's button, or a click on the notification itself.
    static func handle(action: String, category: String, info: [String: String]) async {
        guard isOurs(category) else { return }
        let meeting = info["meeting"].flatMap { MeetingCalendar.shared.meeting($0) }
        switch action {
        case startAction where category == callCategory:
            await start(bundleId: info["bundle"], meetingId: meeting?.id)
        case startAction, joinAction:
            MeetingRecording.show(nil)
            guard let meeting else {
                AppModel.shared.toasts.push("That meeting isn't on your calendar any more.", tone: .error)
                return
            }
            do {
                MeetingRecording.show(try await MeetingRecording.record(meeting, join: action == joinAction))
            } catch {
                AppModel.shared.toasts.push(error.localizedDescription, tone: .error)
            }
        case stopAction:
            await TalkRecorder.shared.stop()
        default:
            // The notification itself: to the recording, or to Transcribe.
            MeetingRecording.show(nil)
        }
    }

    private static func start(bundleId: String?, meetingId: String?) async {
        MeetingRecording.show(nil)
        let meeting = meetingId.flatMap { MeetingCalendar.shared.meeting($0) }
        do {
            MeetingRecording.show(try await MeetingRecording.recordCall(bundleId: bundleId, meeting: meeting))
        } catch {
            AppModel.shared.toasts.push(error.localizedDescription, tone: .error)
        }
    }

    // MARK: - Posting

    private static func allowed() async -> Bool {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        return status == .authorized || status == .provisional
    }

    /// Shows a notification now. False when notifications aren't allowed, for the toast instead.
    private static func post(title: String, body: String, category: String, info: [String: String], id: String) async -> Bool {
        guard await allowed() else { return false }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = category
        content.userInfo = info
        // The same id each time: a newer offer replaces the last rather than piling up.
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        return true
    }
}
