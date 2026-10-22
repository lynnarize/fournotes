import AppKit
import SwiftUI
import Testing
@testable import FourNotes

// Draws screens into PNGs, light and dark, to set them beside the web app's without
// clicking through the app. The app is sandboxed, so they land in its own temporary
// folder, printed after "SNAPSHOT |". Nothing is changed: the screens only read.
// Off by default; on with:
//
//   TEST_RUNNER_FOURNOTES_SNAPSHOT=1 ./scripts/run-tests.sh

private let enabled = ProcessInfo.processInfo.environment["FOURNOTES_SNAPSHOT"] == "1"

/// Each section found by its name in "Find a setting", so it's at the top of the page.
private let settingsSections = ["appearance", "today", "ai and keys", "general", "edge dock", "backup and sync", "data and privacy", "about"]

@MainActor
@Suite("Screen snapshots", .enabled(if: enabled))
struct ScreenSnapshotTests {
    @Test("Settings, at each section", arguments: settingsSections)
    func settings(section: String) throws {
        for dark in [false, true] {
            try render(SettingsView(query: section), name: "settings-\(section.split(separator: " ")[0])",
                       dark: dark, size: CGSize(width: 1120, height: 800))
        }
    }

    @Test("Each tab of the main window", arguments: FourNotes.Tab.allCases)
    func tab(_ tab: FourNotes.Tab) throws {
        for dark in [false, true] {
            AppModel.shared.nav.tab = tab
            try render(RootView(), name: "tab-\(tab.rawValue)", dark: dark, size: CGSize(width: 1280, height: 820))
        }
    }

    @Test("First-run setup, each step", arguments: 0...9)
    func onboarding(step: Int) throws {
        for dark in [false, true] {
            try render(OnboardingView(step: step), name: "onboarding-\(step)", dark: dark, size: CGSize(width: 1280, height: 820))
        }
    }

    @Test("A task, open beside the board")
    func taskPanel() throws {
        guard let todo = AppModel.shared.store.liveTodos.first else { return }
        for dark in [false, true] {
            try render(TaskPanel(todo: todo, isNew: false, onClose: {}, onMove: { _ in }), name: "task-panel",
                       dark: dark, size: CGSize(width: 420, height: 760))
        }
    }

    @Test("Finance, the whole page")
    func financePage() throws {
        for dark in [false, true] {
            try render(ScrollView { FinanceView().padding(.horizontal, 32) }, name: "finance-page", dark: dark,
                       size: CGSize(width: 1032, height: 2000))
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
