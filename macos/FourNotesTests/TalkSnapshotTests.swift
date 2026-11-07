import AppKit
import SwiftUI
import Testing
@testable import FourNotes

// Draws a talk page with a sample talk into a PNG, to look at the layout without
// recording anything. The app is sandboxed, so it lands in its own temporary folder,
// printed after "SNAPSHOT |". Off by default; on with:
//
//   TEST_RUNNER_FOURNOTES_SNAPSHOT=1 ./scripts/run-tests.sh

private let enabled = ProcessInfo.processInfo.environment["FOURNOTES_SNAPSHOT"] == "1"

@MainActor
@Suite("Talk page snapshot", .enabled(if: enabled))
struct TalkSnapshotTests {
    @Test("A finished call with two people, a summary and a transcript")
    func page() throws {
        var talk = Talk(title: "Birthday dinner plans", mode: .call, app: "WhatsApp", lang: "en-US")
        talk.status = .done
        talk.engine = .whisper
        talk.duration = 187
        talk.names = ["them:A": "Budi"]
        talk.segments = [
            .init(speaker: "me", start: 0, end: 4, text: "Hi Budi, did you book the table at Bakmi for Saturday?"),
            .init(speaker: "them:A", start: 5, end: 11, text: "Yes, I booked it for seven in the evening. Can you bring the cake?"),
            .init(speaker: "me", start: 12, end: 15, text: "Sure, I'll bring the chocolate one from the bakery."),
            .init(speaker: "them:B", start: 16, end: 22, text: "And I'll pick up the balloons on Friday after work."),
        ]
        talk.summary = TalkSummary(
            text: "Planning Saturday's birthday dinner at Bakmi: the table is booked for 7 pm, you bring the cake and Caller B the balloons.",
            keyPoints: ["Table booked at Bakmi, Saturday 7 pm", "Chocolate cake from the bakery"],
            actionItems: ["Pick up the chocolate cake", "Caller B: buy balloons on Friday"],
            people: [.init(speaker: "them:A", profile: "Booked the table and asked for the cake."),
                     .init(speaker: "them:B", profile: "Offered to get the balloons.")])

        let model = AppModel.shared
        let view = TalkPage(talk: talk, onDeleted: {})
            .environment(\.palette, Palette.light)
            .environmentObject(model.store)
            .environmentObject(model.nav)
            .environmentObject(model.toasts)
            .environmentObject(model.assistant)
            .frame(width: 900, height: 1300)
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(x: 0, y: 0, width: 900, height: 1300)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("talk-page.png")
        try #require(rep.representation(using: .png, properties: [:])).write(to: url)
        print("SNAPSHOT | \(url.path)")
    }
}
