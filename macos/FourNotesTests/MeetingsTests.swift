import Foundation
import Testing
@testable import FourNotes

// Meetings on the Transcribe page: finding a meeting's call link and its app, which
// events count, where the Now line goes, when reminders come, and noticing a call app
// take the microphone. None of it needs a real calendar.

private let base = Date(timeIntervalSince1970: 1_792_000_000)

private func at(_ minutes: Double) -> Date { base.addingTimeInterval(minutes * 60) }

private func entry(_ title: String, _ start: Double, _ end: Double, calendar: String = "work",
                   attendees: [String] = [], location: String? = nil, notes: String? = nil, url: String? = nil,
                   allDay: Bool = false, declined: Bool = false, cancelled: Bool = false) -> CalendarEntry {
    CalendarEntry(eventId: "ev-\(title)", calendarId: calendar, title: title, start: at(start), end: at(end),
                  isAllDay: allDay, declined: declined, cancelled: cancelled, attendees: attendees,
                  url: url.flatMap(URL.init(string:)), location: location, notes: notes)
}

private func meeting(_ title: String, _ start: Double, _ end: Double, attendees: [String] = [], link: String? = nil) -> Meeting {
    Meeting(eventId: "ev-\(title)", calendarId: "work", title: title, start: at(start), end: at(end),
            attendees: attendees, link: link.flatMap(URL.init(string:)).flatMap(CallLink.classify))
}

@Suite("A meeting's call link")
struct CallLinkTests {
    @Test("Each service's meeting links are found, and the app it opens in")
    func services() {
        let cases: [(String, String, [String])] = [
            ("https://us02web.zoom.us/j/81234567890?pwd=abc", "Zoom", ["us.zoom.xos"]),
            ("https://zoom.us/my/andi", "Zoom", ["us.zoom.xos"]),
            ("https://meet.google.com/abc-defg-hij", "Google Meet", []),
            ("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0", "Microsoft Teams", ["com.microsoft.teams2", "com.microsoft.teams"]),
            ("https://teams.live.com/meet/9876543210", "Microsoft Teams", ["com.microsoft.teams2", "com.microsoft.teams"]),
            ("https://acme.webex.com/meet/andi", "Webex", ["Cisco-Systems.Spark", "com.webex.meetingmanager"]),
            ("https://facetime.apple.com/join#v=1&p=abc", "FaceTime", ["com.apple.FaceTime"]),
            ("https://call.whatsapp.com/video/AbC123", "WhatsApp", ["net.whatsapp.WhatsApp", "desktop.WhatsApp"]),
            ("https://app.slack.com/huddle/T012/C034", "Slack", ["com.tinyspeck.slackmacgap"]),
        ]
        for (url, service, apps) in cases {
            let link = CallLink.classify(URL(string: url)!)
            #expect(link?.service == service, "\(url)")
            #expect(link?.apps == apps, "\(url)")
        }
    }

    @Test("Other pages aren't calls: a doc, Zoom's own site, Meet's landing page")
    func notCalls() {
        for url in ["https://docs.google.com/document/d/1", "https://zoom.us/pricing", "https://meet.google.com/",
                    "https://www.google.com/calendar/event?eid=abc", "mailto:andi@example.com", "https://app.slack.com/client/T1"] {
            #expect(CallLink.classify(URL(string: url)!) == nil, "\(url)")
        }
    }

    @Test("The event's URL first, then where it is, then its notes")
    func order() {
        let notes = "Join with Google Meet: https://meet.google.com/abc-defg-hij\nOr dial: (US) +1 555-0100 PIN: 1234#"
        #expect(CallLink.find(url: nil, location: nil, notes: notes)?.service == "Google Meet")
        #expect(CallLink.find(url: nil, location: "https://us02web.zoom.us/j/1", notes: notes)?.service == "Zoom")
        #expect(CallLink.find(url: URL(string: "https://teams.live.com/meet/1"), location: "https://us02web.zoom.us/j/1",
                              notes: notes)?.service == "Microsoft Teams")
        // A URL that's the calendar's own page doesn't hide the link in the notes.
        #expect(CallLink.find(url: URL(string: "https://calendar.google.com/event?eid=1"), location: "Room 4",
                              notes: notes)?.service == "Google Meet")
        #expect(CallLink.find(url: nil, location: "Room 4, 2nd floor", notes: "Bring the slides") == nil)
    }
}

@Suite("Meetings from the calendar")
struct MeetingRulesTests {
    @Test("All-day, declined, cancelled and hidden-calendar events aren't meetings; the rest are in order")
    func which() {
        let entries = [
            entry("Standup", 60, 75, attendees: ["Andi"]),
            entry("Holiday", 0, 1440, allDay: true),
            entry("Declined", 30, 60, declined: true),
            entry("Cancelled", 30, 60, cancelled: true),
            entry("Gym", 90, 120, calendar: "personal"),
            entry("Design review", 30, 60, location: "https://us02web.zoom.us/j/1"),
            entry("   ", 200, 230),
        ]
        let meetings = MeetingRules.meetings(entries, hidden: ["personal"])
        #expect(meetings.map(\.title) == ["Design review", "Standup", "Meeting"])
        #expect(meetings[0].link?.service == "Zoom")
        #expect(meetings[0].detail == "Zoom")
        #expect(meetings[1].detail == "Andi")
    }

    @Test("The Now line goes after every meeting that has started")
    func nowLine() {
        let day = [meeting("A", 0, 60), meeting("B", 307, 337), meeting("C", 308, 338), meeting("D", 400, 430)]
        #expect(MeetingRules.nowLine(day, now: at(319)) == 3)
        #expect(MeetingRules.nowLine(day, now: at(-10)) == 0)
        #expect(MeetingRules.nowLine(day, now: at(500)) == 4)
        #expect(MeetingRules.nowLine(day, now: at(307)) == 2)
        #expect(MeetingRules.nowLine([], now: at(0)) == 0)
    }

    @Test("Reminders come minutes before meetings with a link or other people, never late")
    func reminders() {
        let meetings = [
            meeting("Zoom call", 10, 40, link: "https://us02web.zoom.us/j/1"),
            meeting("One-on-one", 30, 60, attendees: ["Budi"]),
            meeting("Focus time", 20, 80),
            meeting("Too soon", 1, 30, attendees: ["Citra"]),
            meeting("Started", -5, 25, attendees: ["Dewi"]),
            meeting("Next week", 7 * 1440, 7 * 1440 + 30, attendees: ["Eka"]),
        ]
        let plan = MeetingRules.reminders(meetings, now: at(0), minutes: 2)
        #expect(plan.map(\.meeting.title) == ["Zoom call", "One-on-one"])
        #expect(plan[0].at == at(8))
        #expect(plan[1].at == at(28))
        #expect(MeetingRules.reminders(meetings, now: at(0), minutes: 0).map(\.meeting.title) == ["Zoom call", "One-on-one", "Too soon"])
    }

    @Test("A talk belongs to the occurrence it was recorded for")
    func matches() {
        let m = meeting("Weekly", 60, 90, attendees: ["Andi"])
        #expect(m.matches(m.event))
        var nextWeek = m.event
        nextWeek.start = DateKit.iso(at(60 + 7 * 1440))
        #expect(!m.matches(nextWeek))
        var other = m.event
        other.id = "ev-other"
        #expect(!m.matches(other))
        #expect(!m.matches(nil))
        #expect(m.event.attendees == ["Andi"])
    }

    @Test("A call that starts is matched to the meeting under way, the one in its app first")
    func current() {
        let meetings = [
            meeting("Standup", -5, 10, attendees: ["Andi"]),
            meeting("Zoom with Budi", 4, 30, link: "https://us02web.zoom.us/j/1"),
            meeting("Design review", 3, 30, link: "https://meet.google.com/abc-defg-hij"),
            meeting("Later", 120, 150, attendees: ["Citra"]),
        ]
        #expect(MeetingRules.current(meetings, now: at(0), app: "us.zoom.xos")?.title == "Zoom with Budi")
        #expect(MeetingRules.current(meetings, now: at(0), app: "com.google.Chrome", browser: true)?.title == "Design review")
        // An app none of them is in: the nearest.
        #expect(MeetingRules.current(meetings, now: at(0), app: "com.hnc.Discord")?.title == "Design review")
        #expect(MeetingRules.current(Array(meetings.prefix(1)), now: at(0), app: "com.hnc.Discord")?.title == "Standup")
        #expect(MeetingRules.current(meetings, now: at(60)) == nil)
    }

    @Test("When, in words")
    func when() {
        let m = meeting("A", 12, 40)
        #expect(MeetingRules.when(m, now: at(0)) == "in 12 min")
        #expect(MeetingRules.when(m, now: at(20)) == "now")
        #expect(NewRecordingView.people(["Andi"]) == "Andi")
        #expect(NewRecordingView.people(["Andi", "Budi", "Citra"]) == "Andi, Budi and Citra")
        #expect(NewRecordingView.people(["Andi", "Budi", "Citra", "Dewi", "Eka"]) == "Andi, Budi, Citra and 2 more")
    }
}

@Suite("Noticing calls")
struct CallDetectorTests {
    @Test("Call apps are known by bundle id, helpers included, and nothing else is")
    func apps() {
        #expect(CallApp.of(bundleId: "us.zoom.xos", safariOpen: false)?.name == "Zoom")
        #expect(CallApp.of(bundleId: "com.google.Chrome.helper", safariOpen: false)?.name == "Google Chrome")
        #expect(CallApp.of(bundleId: "com.google.Chrome.helper", safariOpen: false)?.isBrowser == true)
        #expect(CallApp.of(bundleId: "com.microsoft.teams2", safariOpen: false)?.bundleId == "com.microsoft.teams2")
        #expect(CallApp.of(bundleId: "COM.TINYSPECK.SLACKMACGAP.helper", safariOpen: false)?.name == "Slack")
        #expect(CallApp.of(bundleId: "com.apple.WebKit.GPU", safariOpen: true)?.name == "Safari")
        #expect(CallApp.of(bundleId: "com.apple.WebKit.GPU", safariOpen: false) == nil)
        #expect(CallApp.of(bundleId: "com.spotify.client", safariOpen: true) == nil)
        #expect(CallApp.of(bundleId: "", safariOpen: true) == nil)
        if let me = Bundle.main.bundleIdentifier {
            #expect(CallApp.of(bundleId: me, safariOpen: true) == nil)
        }
    }

    @Test("A call counts once the app has held the microphone for two looks, and ends after two without")
    func watch() {
        let zoom = CallApp.of(bundleId: "us.zoom.xos", safariOpen: false)!
        let slack = CallApp.of(bundleId: "com.tinyspeck.slackmacgap", safariOpen: false)!
        var w = CallWatch()
        // Slack checks the microphone for a moment: not a call.
        #expect(w.look([slack]).isEmpty)
        #expect(w.look([]).isEmpty)
        #expect(w.look([zoom]).isEmpty)
        #expect(w.look([zoom]) == [.started(zoom)])
        #expect(w.look([zoom]).isEmpty)
        // A moment without it (switching microphones) isn't the end.
        #expect(w.look([]).isEmpty)
        #expect(w.look([zoom]).isEmpty)
        #expect(w.onCall == [zoom])
        #expect(w.look([]).isEmpty)
        #expect(w.look([]) == [.ended(zoom)])
        #expect(w.onCall.isEmpty)
        #expect(w.look([]).isEmpty)
    }

    @Test("CoreAudio says which apps use the microphone, inside the sandbox")
    func coreAudio() {
        // The tests run in the sandboxed app, so this is the app's own view of it.
        #expect(CallDetector.micUsers() != nil)
    }
}
