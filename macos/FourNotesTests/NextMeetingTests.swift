import Foundation
import Testing
@testable import FourNotes

@Suite("Today's next meeting")
struct NextMeetingTests {
    private let now = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 15, minute: 0))!

    private func meeting(_ title: String, from start: Double, minutes: Double = 30, link: Bool = false) -> Meeting {
        let s = now.addingTimeInterval(start * 60)
        return Meeting(eventId: title, calendarId: "c", title: title, start: s, end: s.addingTimeInterval(minutes * 60),
                       attendees: ["Sari"],
                       link: link ? CallLink(url: URL(string: "https://zoom.us/j/1")!, service: "Zoom", apps: []) : nil)
    }

    @Test("The one on now comes first, then the next")
    func onNowFirst() throws {
        let past = meeting("Standup", from: -90, minutes: 15)
        let on = meeting("Design review", from: -10)
        let next = meeting("1:1", from: 40)
        let pick = try #require(NextMeeting.pick([next, past, on], now: now))
        #expect(pick.shown.title == "Design review")
        #expect(pick.then?.title == "1:1")
    }

    @Test("Of two on now, the one that began last")
    func overlapping() throws {
        let long = meeting("Workshop", from: -120, minutes: 240)
        let call = meeting("Quick call", from: -5)
        #expect(try #require(NextMeeting.pick([long, call], now: now)).shown.title == "Quick call")
    }

    @Test("Nothing within twelve hours shows nothing")
    func window() {
        #expect(NextMeeting.pick([meeting("Late", from: 13 * 60)], now: now) == nil)
        #expect(NextMeeting.pick([meeting("Done", from: -60)], now: now) == nil)
        #expect(NextMeeting.pick([], now: now) == nil)
    }

    @Test("Only the next one: nothing follows it")
    func alone() throws {
        let pick = try #require(NextMeeting.pick([meeting("1:1", from: 40)], now: now))
        #expect(pick.then == nil)
    }

    @Test("When it is, in words")
    func when() {
        #expect(NextMeeting.when(meeting("a", from: -5), now: now) == "Now · started 5 min ago")
        #expect(NextMeeting.when(meeting("a", from: 0), now: now) == "Now · just started")
        #expect(NextMeeting.when(meeting("a", from: -90, minutes: 180), now: now) == "Now · until 4:30 PM")
        #expect(NextMeeting.when(meeting("a", from: 0.5), now: now) == "Starting now")
        #expect(NextMeeting.when(meeting("a", from: 11.2), now: now) == "In 12 min")
        #expect(NextMeeting.when(meeting("a", from: 90), now: now) == "At 4:30 PM")
        #expect(NextMeeting.when(meeting("a", from: 18 * 60), now: now) == "Tomorrow at 9:00 AM")
    }

    @Test("The time range says AM or PM once when it can")
    func range() {
        #expect(NextMeeting.range(meeting("a", from: 30)) == "3:30 – 4:00 PM")
        let morning = meeting("b", from: -210, minutes: 60)  // 11:30 AM – 12:30 PM
        #expect(NextMeeting.range(morning) == "11:30 AM – 12:30 PM")
    }
}
