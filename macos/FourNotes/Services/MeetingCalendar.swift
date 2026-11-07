import AppKit
import EventKit
import Foundation
import SwiftUI

// Meetings from the calendars on this Mac (EventKit): every account added to it — iCloud,
// Google, Exchange, Outlook — with no sign-in of our own. Transcribe lists today's and
// tomorrow's, records one in a click with its name and who's invited, joins its call
// first when it has a link, and reminds you a couple of minutes before one starts.
// The calendar is only read, and stays on this Mac.

/// The link to join a meeting's call, and the app it opens in.
struct CallLink: Equatable, Hashable, Sendable {
    var url: URL
    /// "Zoom", "Google Meet"…
    var service: String
    /// The apps the call runs in, by bundle id, most likely first. Empty: in a browser.
    var apps: [String]

    /// The call in an event: its URL first, then where it is, then its notes (where
    /// Google Calendar puts the Meet link and Outlook the Teams one).
    static func find(url: URL?, location: String?, notes: String?) -> CallLink? {
        if let url, let link = classify(url) { return link }
        for text in [location, notes] {
            guard let text, !text.isEmpty else { continue }
            if let link = links(in: text).lazy.compactMap(classify).first { return link }
        }
        return nil
    }

    /// A link to a call, or nil for any other page (a doc, the calendar's own page).
    static func classify(_ url: URL) -> CallLink? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host?.lowercased() else { return nil }
        let path = url.path.lowercased()
        func on(_ domain: String) -> Bool { host == domain || host.hasSuffix("." + domain) }
        func link(_ service: String, _ apps: [String] = []) -> CallLink { CallLink(url: url, service: service, apps: apps) }

        if on("zoom.us") || on("zoomgov.com") {
            // Meetings and webinars; not the site's own pages.
            let meeting = ["/j/", "/my/", "/w/", "/s/", "/wc/"].contains { path.hasPrefix($0) }
            return meeting ? link("Zoom", ["us.zoom.xos"]) : nil
        }
        if host == "meet.google.com" {
            // "/abc-defg-hij" (or "/lookup/…"): a room, not the landing page.
            return path.count > 1 ? link("Google Meet") : nil
        }
        if on("teams.microsoft.com") || on("teams.live.com") {
            return path.contains("meetup-join") || path.hasPrefix("/meet/") || path.hasPrefix("/l/meet")
                ? link("Microsoft Teams", ["com.microsoft.teams2", "com.microsoft.teams"]) : nil
        }
        if on("webex.com") {
            return path.count > 1 ? link("Webex", ["Cisco-Systems.Spark", "com.webex.meetingmanager"]) : nil
        }
        if host == "call.whatsapp.com" { return link("WhatsApp", ["net.whatsapp.WhatsApp", "desktop.WhatsApp"]) }
        if host == "facetime.apple.com" { return link("FaceTime", ["com.apple.FaceTime"]) }
        if host == "app.slack.com", path.contains("/huddle/") { return link("Slack", ["com.tinyspeck.slackmacgap"]) }
        if host == "meet.jit.si" { return path.count > 1 ? link("Jitsi Meet") : nil }
        if on("whereby.com") { return path.count > 1 ? link("Whereby") : nil }
        return nil
    }

    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    private static func links(in text: String) -> [URL] {
        guard let detector else { return [] }
        return detector.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap(\.url)
    }
}

/// A meeting on the calendar: one occurrence of an event.
struct Meeting: Identifiable, Equatable, Hashable, Sendable {
    /// The event and when this one starts: the occurrences of a repeating event share an id.
    var id: String { "\(eventId)@\(Int(start.timeIntervalSince1970))" }
    /// The event's calendarItemIdentifier.
    var eventId: String
    var calendarId: String
    var title: String
    var start: Date
    var end: Date
    /// Everyone invited but you, by name (or address when there's no name).
    var attendees: [String]
    var link: CallLink?

    /// Someone to meet or a call to join: worth a reminder. A block of focus time isn't.
    var worthReminding: Bool { link != nil || !attendees.isEmpty }

    func isOn(at now: Date) -> Bool { start <= now && now < end }

    /// As a talk keeps it.
    var event: TalkEvent {
        TalkEvent(id: eventId, title: title, start: DateKit.iso(start), end: DateKit.iso(end),
                  attendees: attendees, url: link?.url.absoluteString)
    }

    /// Whether a talk was recorded for this occurrence of the event.
    func matches(_ event: TalkEvent?) -> Bool {
        guard let event, event.id == eventId, let at = DateKit.date(event.start) else { return false }
        return abs(at.timeIntervalSince(start)) < 60
    }

    /// "Zoom · 4 people", "2 people", "".
    var detail: String {
        var parts: [String] = []
        if let link { parts.append(link.service) }
        if !attendees.isEmpty { parts.append(attendees.count == 1 ? attendees[0] : "\(attendees.count) people") }
        return parts.joined(separator: " · ")
    }
}

/// What EventKit says about an event, in plain values, so the rules can be tested
/// without a calendar.
struct CalendarEntry: Sendable {
    var eventId: String
    var calendarId: String
    var title: String
    var start: Date
    var end: Date
    var isAllDay = false
    var declined = false
    var cancelled = false
    var attendees: [String] = []
    var url: URL?
    var location: String?
    var notes: String?
}

/// Which events are meetings, where the Now line goes, and when to remind.
enum MeetingRules {
    struct Reminder: Equatable {
        var meeting: Meeting
        var at: Date
    }

    /// The meetings among the calendar's events, in order: no all-day events, none you
    /// declined or that were cancelled, none from calendars you turned off.
    static func meetings(_ entries: [CalendarEntry], hidden: Set<String>) -> [Meeting] {
        entries
            .filter { !$0.isAllDay && !$0.declined && !$0.cancelled && !hidden.contains($0.calendarId) && $0.end > $0.start }
            .map { e in
                let title = e.title.trimmingCharacters(in: .whitespacesAndNewlines)
                return Meeting(eventId: e.eventId, calendarId: e.calendarId, title: title.isEmpty ? "Meeting" : title,
                               start: e.start, end: e.end, attendees: e.attendees,
                               link: CallLink.find(url: e.url, location: e.location, notes: e.notes))
            }
            .sorted { $0.start != $1.start ? $0.start < $1.start : $0.end < $1.end }
    }

    /// Where the Now line goes in a day's meetings (sorted by start): after every one
    /// that has started, so the ones under way sit just above it.
    static func nowLine(_ meetings: [Meeting], now: Date) -> Int {
        meetings.filter { $0.start <= now }.count
    }

    /// The reminders to have waiting: `minutes` before each meeting worth one that starts
    /// in the next day. One whose moment has passed gets none, rather than a late one.
    static func reminders(_ meetings: [Meeting], now: Date, minutes: Int, within: TimeInterval = 24 * 3600) -> [Reminder] {
        meetings.compactMap { m in
            guard m.worthReminding, m.start > now, m.start <= now.addingTimeInterval(within) else { return nil }
            let at = m.start.addingTimeInterval(-Double(max(0, minutes)) * 60)
            return at > now ? Reminder(meeting: m, at: at) : nil
        }
    }

    /// The meeting a call that just began is most likely for: one under way or starting
    /// in the next few minutes, the one whose call is in that app first (a browser's is
    /// one with no app of its own, as Meet), else the nearest.
    static func current(_ meetings: [Meeting], now: Date, app: String? = nil, browser: Bool = false) -> Meeting? {
        let near = meetings.filter { $0.start <= now.addingTimeInterval(5 * 60) && $0.end > now }
        let same = near.first { m in
            guard let link = m.link else { return false }
            if browser { return link.apps.isEmpty }
            guard let app = app?.lowercased() else { return false }
            return link.apps.contains { app.hasPrefix($0.lowercased()) }
        }
        return same ?? near.min { abs($0.start.timeIntervalSince(now)) < abs($1.start.timeIntervalSince(now)) }
    }

    /// "now", "in 12 min", "in 2 hr", "3:00 PM".
    static func when(_ m: Meeting, now: Date) -> String {
        if m.isOn(at: now) { return "now" }
        let minutes = Int((m.start.timeIntervalSince(now) / 60).rounded(.up))
        if minutes > 0, minutes < 60 { return "in \(minutes) min" }
        return time.string(from: m.start)
    }

    /// "3:07 PM"
    static let time: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "h:mm a"
        return f
    }()
}

@MainActor
final class MeetingCalendar: ObservableObject {
    static let shared = MeetingCalendar()

    enum Access: Equatable { case notAsked, allowed, denied }

    /// An account's calendars, for choosing which count.
    struct Source: Identifiable {
        struct Choice: Identifiable {
            var id: String
            var title: String
            var color: Color
        }
        var id: String
        var title: String
        var calendars: [Choice]
    }

    @Published private(set) var access: Access
    /// Today's and tomorrow's meetings, in order.
    @Published private(set) var meetings: [Meeting] = []
    @Published private(set) var sources: [Source] = []

    /// Calendars turned off in Settings: their events aren't meetings here.
    @Published var hidden: Set<String> {
        didSet {
            UserDefaults.standard.set(Array(hidden).sorted(), forKey: Self.hiddenKey)
            reload()
        }
    }
    @Published var remindersOn: Bool {
        didSet {
            UserDefaults.standard.set(remindersOn, forKey: Self.remindersKey)
            reschedule()
        }
    }
    /// How many minutes before a meeting its reminder comes.
    @Published var remindMinutes: Int {
        didSet {
            UserDefaults.standard.set(remindMinutes, forKey: Self.minutesKey)
            reschedule()
        }
    }

    /// "Not now" on the row offering to connect the calendar.
    static let connectDismissedKey = "fournotes.meetings.connectDismissed"
    private static let hiddenKey = "fournotes.meetings.hiddenCalendars"
    private static let remindersKey = "fournotes.meetings.reminders"
    private static let minutesKey = "fournotes.meetings.remindMinutes"

    private var store = EKEventStore()
    /// Whether `store` was made with access given: one made before sees no events.
    private var storeCanRead: Bool
    private var watching: NSObjectProtocol?
    private var timer: Timer?

    private init() {
        let defaults = UserDefaults.standard
        hidden = Set(defaults.stringArray(forKey: Self.hiddenKey) ?? [])
        remindersOn = defaults.object(forKey: Self.remindersKey) as? Bool ?? true
        remindMinutes = defaults.object(forKey: Self.minutesKey) as? Int ?? 2
        let access = Self.currentAccess()
        self.access = access
        storeCanRead = access == .allowed
    }

    /// These meetings, as if the calendar had them: how the snapshot tests draw the list
    /// without asking for anyone's calendar.
    func show(_ meetings: [Meeting]) {
        access = .allowed
        self.meetings = meetings
    }

    static func currentAccess() -> Access {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return .allowed
        case .notDetermined: return .notAsked
        default: return .denied
        }
    }

    /// At launch: read the calendar if it's allowed, and keep reading it as it changes.
    func start() {
        guard timer == nil else { return }
        access = Self.currentAccess()
        watch()
        reload()
        // Today becomes tomorrow, and the reminders' day ahead moves on.
        timer = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    /// Asks macOS for the calendar. False when it was refused, now or before.
    @discardableResult
    func requestAccess() async -> Bool {
        if access == .denied {
            openPrivacySettings()
            return false
        }
        // A store of its own: the request runs off the main actor.
        let asking = EKEventStore()
        let granted = (try? await asking.requestFullAccessToEvents()) ?? false
        reload()
        return granted
    }

    func openPrivacySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Reads today's and tomorrow's events again, and the reminders with them.
    func reload() {
        access = Self.currentAccess()
        guard access == .allowed else {
            meetings = []
            sources = []
            reschedule()
            return
        }
        // Allowed since the store was made (here, or in System Settings): a new one.
        if !storeCanRead {
            store = EKEventStore()
            storeCanRead = true
            watch()
        }
        let calendars = store.calendars(for: .event).filter { $0.type != .birthday }
        sources = Dictionary(grouping: calendars) { $0.source?.sourceIdentifier ?? "" }
            .map { id, calendars in
                Source(id: id, title: calendars.first?.source?.title ?? "Calendars",
                       calendars: calendars.map { .init(id: $0.calendarIdentifier, title: $0.title, color: Color(cgColor: $0.cgColor)) }
                           .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending })
            }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }

        let day = Calendar.current.startOfDay(for: Date())
        guard !calendars.isEmpty, let end = Calendar.current.date(byAdding: .day, value: 2, to: day) else {
            meetings = []
            reschedule()
            return
        }
        let predicate = store.predicateForEvents(withStart: day, end: end, calendars: calendars)
        meetings = MeetingRules.meetings(store.events(matching: predicate).map(Self.entry), hidden: hidden)
        reschedule()
    }

    /// The meeting with this id, if it's still on the calendar.
    func meeting(_ id: String) -> Meeting? { meetings.first { $0.id == id } }

    private func reschedule() {
        let plan = remindersOn && access == .allowed
            ? MeetingRules.reminders(meetings, now: Date(), minutes: remindMinutes) : []
        // Ones already recorded (or being recorded) need no nudge.
        let talks = TalkStore.shared.all.filter(\.isAlive)
        let left = plan.filter { r in !talks.contains { r.meeting.matches($0.event) } }
        Task { await MeetingAlerts.schedule(left) }
    }

    private func watch() {
        if let watching { NotificationCenter.default.removeObserver(watching) }
        watching = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
    }

    private static func entry(_ event: EKEvent) -> CalendarEntry {
        let people = (event.attendees ?? [])
            .filter { !$0.isCurrentUser && ($0.participantType == .person || $0.participantType == .unknown) }
        var names = people.map(name)
        if let organizer = event.organizer, !organizer.isCurrentUser {
            let n = name(organizer)
            if !names.contains(n) { names.insert(n, at: 0) }
        }
        let mine = event.attendees?.first { $0.isCurrentUser }
        return CalendarEntry(eventId: event.calendarItemIdentifier, calendarId: event.calendar?.calendarIdentifier ?? "",
                             title: event.title ?? "", start: event.startDate, end: event.endDate,
                             isAllDay: event.isAllDay, declined: mine?.participantStatus == .declined,
                             cancelled: event.status == .canceled, attendees: names,
                             url: event.url, location: event.location, notes: event.notes)
    }

    private static func name(_ p: EKParticipant) -> String {
        if let name = p.name?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        let address = p.url.absoluteString
        return address.lowercased().hasPrefix("mailto:") ? String(address.dropFirst(7)) : address
    }
}

// MARK: - Recording one

/// Starting a talk for a meeting, or for a call that began without one: from a row on
/// the Transcribe page, a reminder's button, or the call detector's.
@MainActor
enum MeetingRecording {
    /// Records a meeting: a call, in its app, when it has a link (opened first when
    /// `join`), otherwise in person. `title` is a name typed for it. Returns the new
    /// talk's id.
    @discardableResult
    static func record(_ meeting: Meeting, join: Bool, title: String? = nil) async throws -> String {
        var app: SystemAudio.App?
        if let link = meeting.link {
            if join {
                NSWorkspace.shared.open(link.url)
                app = await waitForApp(own: installed(link.apps), then: apps(for: link))
            } else {
                app = await runningApp(apps(for: link))
            }
        }
        let options = TalkRecorder.Options(mode: meeting.link != nil ? .call : .room, app: app,
                                           title: title ?? meeting.title, lang: language, event: meeting.event)
        let id = try await TalkRecorder.shared.start(options)
        MeetingAlerts.cancelReminder(meeting.id)
        return id
    }

    /// Records a call an app began, named after the meeting on now if there is one.
    @discardableResult
    static func recordCall(bundleId: String?, meeting: Meeting?) async throws -> String {
        var candidates = bundleId.map { [$0] } ?? []
        if let link = meeting?.link { candidates += apps(for: link) }
        let options = TalkRecorder.Options(mode: .call, app: await runningApp(candidates),
                                           title: meeting?.title ?? "", lang: language, event: meeting?.event)
        let id = try await TalkRecorder.shared.start(options)
        if let meeting { MeetingAlerts.cancelReminder(meeting.id) }
        return id
    }

    /// Brings the app forward on the talk being recorded.
    static func show(_ talkId: String?) {
        EdgeDock.shared.showApp { nav in
            nav.tab = .transcribe
            nav.selectedTalkId = talkId ?? TalkRecorder.shared.talkId
        }
    }

    /// The language Transcribe was last set to.
    private static var language: String {
        UserDefaults.standard.string(forKey: "fournotes.transcribe.lang") ?? TranscribeLanguages.preferred
    }

    /// The apps a link's call may be in: its own app if it's installed, then whatever
    /// opens the link (the browser, for Meet, or for Zoom without Zoom).
    static func apps(for link: CallLink) -> [String] {
        var out = installed(link.apps)
        if let handler = NSWorkspace.shared.urlForApplication(toOpen: link.url),
           let id = Bundle(url: handler)?.bundleIdentifier, !out.contains(id) {
            out.append(id)
        }
        return out
    }

    private static func installed(_ bundleIds: [String]) -> [String] {
        bundleIds.filter { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) != nil }
    }

    /// The first of the apps that's open with a window, as the recorder hears it; nil
    /// records all of this Mac's sound.
    static func runningApp(_ bundleIds: [String]) async -> SystemAudio.App? {
        guard !bundleIds.isEmpty, let open = try? await SystemAudio.apps() else { return nil }
        for id in bundleIds {
            if let app = open.first(where: { $0.bundleId.lowercased() == id.lowercased() }) { return app }
        }
        return nil
    }

    /// After opening a link: the call's own app once its window is up, waited for up to
    /// ten seconds, since the browser that passed the link on is open already. Without
    /// it, whichever of the rest is open.
    private static func waitForApp(own: [String], then all: [String]) async -> SystemAudio.App? {
        if !own.isEmpty {
            for _ in 0..<20 {
                if let app = await runningApp(own) { return app }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        return await runningApp(all)
    }
}
