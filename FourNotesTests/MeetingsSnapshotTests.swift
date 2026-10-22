import AppKit
import SwiftUI
import Testing
@testable import FourNotes

// Draws the meeting screens with sample data into PNGs, light and dark: the meetings
// list, notes while recording, enhanced notes, the library, the permissions step and
// Settings → Meetings. Nothing is recorded and no calendar is asked; the talks and the
// library live in the tests' own folders. The app is sandboxed, so the PNGs land in its
// temporary folder, printed after "SNAPSHOT |". Off by default; on with:
//
//   TEST_RUNNER_FOURNOTES_SNAPSHOT=1 ./scripts/run-tests.sh

private let enabled = ProcessInfo.processInfo.environment["FOURNOTES_SNAPSHOT"] == "1"

@MainActor
@Suite("Meeting snapshots", .enabled(if: enabled), .serialized)
struct MeetingsSnapshotTests {
    private static let notes = """
    budget — Q4 freeze?
    Andi owns vendor shortlist
    - launch slips to Nov 12
    ask Sari re hiring plan
    """

    private static func sampleTalk() -> Talk {
        var talk = Talk(title: "Weekly product sync", mode: .call, app: "Google Meet", lang: "en-US")
        talk.status = .done
        talk.engine = .whisper
        talk.duration = 1834
        talk.names = ["them:A": "Andi", "them:B": "Sari"]
        talk.template = TalkTemplate.general.rawValue
        talk.notes = notes
        talk.segments = [
            .init(speaker: "me", start: 4, end: 9, text: "Let's start with the budget. Are we freezing spend for Q4?"),
            .init(speaker: "them:A", start: 10, end: 19, text: "Finance wants a freeze on new tools, but contracts we've signed carry on."),
            .init(speaker: "them:B", start: 20, end: 31, text: "I'll still need two engineers for the hiring plan. Can we keep those roles open?"),
            .init(speaker: "me", start: 32, end: 38, text: "Yes, hiring is outside the freeze. Andi, can you own the vendor shortlist?"),
            .init(speaker: "them:A", start: 39, end: 46, text: "Sure, I'll have three vendors by Friday."),
            .init(speaker: "them:B", start: 47, end: 58, text: "One more thing: the launch moves to November twelfth because of the security review."),
        ]
        talk.enhanced = TalkNotes(sections: [
            .init(heading: "Budget", lines: [
                .init(text: "budget — Q4 freeze?", mine: true, at: 4),
                .init(text: "Finance freezes new tools in Q4; signed contracts carry on", mine: false, at: 10, depth: 1),
                .init(text: "Hiring is outside the freeze", mine: false, at: 32, depth: 1),
            ]),
            .init(heading: "Decisions", lines: [
                .init(text: "launch slips to Nov 12", mine: true, at: 47),
                .init(text: "Because of the security review", mine: false, at: 47, depth: 1),
            ]),
            .init(heading: "Next steps", lines: [
                .init(text: "Andi owns vendor shortlist", mine: true, at: 39),
                .init(text: "Three vendors by Friday", mine: false, at: 39, depth: 1),
                .init(text: "ask Sari re hiring plan", mine: true, at: 20),
                .init(text: "Sari needs two engineer roles kept open", mine: false, at: 20, depth: 1),
            ]),
        ], template: TalkTemplate.general.rawValue, basedOn: notes, createdAt: DateKit.iso(Date()))
        talk.summary = TalkSummary(
            text: "The weekly sync agreed a Q4 freeze on new tools, kept hiring open, and moved the launch to November 12.",
            keyPoints: ["Q4 freeze on new tools", "Hiring continues", "Launch on Nov 12"],
            actionItems: ["Andi: vendor shortlist by Friday", "Keep two engineer roles open"],
            people: [.init(speaker: "them:A", profile: "Owns the vendor shortlist."),
                     .init(speaker: "them:B", profile: "Leads hiring; raised the launch date.")])
        return talk
    }

    private static func sampleMeetings(now: Date = Date()) -> [Meeting] {
        func at(_ minutes: Double) -> Date { now.addingTimeInterval(minutes * 60) }
        let meet = CallLink(url: URL(string: "https://meet.google.com/abc-defg-hij")!, service: "Google Meet", apps: [])
        let zoom = CallLink(url: URL(string: "https://zoom.us/j/123456789")!, service: "Zoom", apps: ["us.zoom.xos"])
        return [
            Meeting(eventId: "e1", calendarId: "c", title: "Standup", start: at(-95), end: at(-80),
                    attendees: ["Andi", "Sari", "Budi"], link: meet),
            Meeting(eventId: "e2", calendarId: "c", title: "Design review", start: at(-10), end: at(20),
                    attendees: ["Rina", "Dewi"], link: zoom),
            Meeting(eventId: "e3", calendarId: "c", title: "1:1 with Sari", start: at(40), end: at(70),
                    attendees: ["Sari"], link: meet),
            Meeting(eventId: "e4", calendarId: "c", title: "Focus time", start: at(120), end: at(180),
                    attendees: [], link: nil),
            Meeting(eventId: "e5", calendarId: "c", title: "Customer call — Warung Pintar", start: at(60 * 24), end: at(60 * 24 + 45),
                    attendees: ["dimas@warungpintar.co"], link: zoom),
        ]
    }

    @Test("Transcribe, with today's meetings above the talks")
    func transcribe() throws {
        let talk = Self.sampleTalk()
        TalkStore.shared.add(talk)
        MeetingCalendar.shared.show(Self.sampleMeetings())
        AppModel.shared.nav.tab = .transcribe
        AppModel.shared.nav.selectedTalkId = talk.id
        for dark in [false, true] {
            try render(RootView(), name: "meetings-transcribe", dark: dark, size: CGSize(width: 1280, height: 820))
        }
    }

    @Test("A finished talk, each tab")
    func talkPage() throws {
        let talk = Self.sampleTalk()
        for dark in [false, true] {
            try render(TalkPage(talk: talk, onDeleted: {}), name: "meetings-talk-notes", dark: dark,
                       size: CGSize(width: 900, height: 900))
        }
    }

    @Test("Notes while recording")
    func live() throws {
        var talk = Self.sampleTalk()
        talk.status = .recording
        talk.enhanced = nil
        // The notes editor reads the talk's notes from the store.
        TalkStore.shared.add(talk)
        for dark in [false, true] {
            try render(LiveRecordingView(talk: talk), name: "meetings-live", dark: dark, size: CGSize(width: 1100, height: 760))
        }
    }

    @Test("The library, with a file in it")
    func library() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("Q4 plan.md")
        try """
        # Q4 plan

        ## Budget
        New tools are frozen for the quarter. Contracts already signed carry on.

        ## Hiring
        Two engineer roles stay open: one backend, one mobile.
        """.write(to: file, atomically: true, encoding: .utf8)
        let ids = Knowledge.shared.add(files: [file])
        for _ in 0..<40 where Knowledge.shared.working.isEmpty == false || Knowledge.shared.sources.isEmpty {
            try await Task.sleep(for: .milliseconds(100))
        }
        AppModel.shared.nav.tab = .library
        AppModel.shared.nav.selectedSourceId = ids.first
        for dark in [false, true] {
            try render(RootView(), name: "meetings-library", dark: dark, size: CGSize(width: 1280, height: 820))
        }
    }

    @Test("First-run setup, the permissions step")
    func permissions() throws {
        for dark in [false, true] {
            try render(OnboardingView(step: 7), name: "meetings-onboarding", dark: dark, size: CGSize(width: 1280, height: 820))
        }
    }

    @Test("Settings → Meetings")
    func settings() throws {
        MeetingCalendar.shared.show(Self.sampleMeetings())
        for dark in [false, true] {
            try render(SettingsView(query: "meetings"), name: "meetings-settings", dark: dark, size: CGSize(width: 1120, height: 900))
        }
    }

    private func render<V: View>(_ view: V, name: String, dark: Bool, size: CGSize) throws {
        let model = AppModel.shared
        let root = PaletteProvider {
            view
                .environmentObject(model.store)
                .environmentObject(model.nav)
                .environmentObject(model.toasts)
                .environmentObject(model.engine)
                .environmentObject(model.assistant)
        }
        .environment(\.colorScheme, dark ? .dark : .light)
        .frame(width: size.width, height: size.height)
        .background(dark ? Palette.dark.surface : Palette.light.surface)
        let host = NSHostingView(rootView: root)
        host.frame = NSRect(origin: .zero, size: size)
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(1.2))
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(dark ? "dark" : "light").png")
        try #require(rep.representation(using: .png, properties: [:])).write(to: url)
        print("SNAPSHOT | \(url.path)")
    }
}
