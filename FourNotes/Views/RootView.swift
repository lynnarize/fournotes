import SwiftUI

// The app shell: the ink frame (toolbar and sidebar) around the sheets, the views on them,
// and the chat dock. Ported from src/app/page.tsx.

struct RootView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var assistant: Assistant
    @ObservedObject private var updates = UpdateCheck.shared
    @State private var sidebarOpen = true

    var body: some View {
        VStack(spacing: 0) {
            if !focused {
                ToolbarView(sidebarOpen: $sidebarOpen)
                    .environment(\.palette, p.onFrame)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            HStack(spacing: 12) {
                if !focused && sidebarOpen {
                    SidebarView()
                        .environment(\.palette, p.onFrame)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                        .zIndex(1)
                }
                // Clipped, so a pane sliding out goes behind the sidebar instead of across it.
                main.clipped()
            }
            .padding(.horizontal, focused ? 0 : 12)
            .padding(.bottom, focused ? 0 : 12)
        }
        // The toolbar sits in the hidden title bar, level with the traffic lights. The note
        // editor keeps clear of them when it has the whole window.
        .padding(.top, focused ? 28 : 0)
        .ignoresSafeArea(.container, edges: .top)
        .animation(Motion.screen, value: focused)
        .animation(Motion.screen, value: sidebarOpen)
        .background((focused ? p.bg : p.frame).ignoresSafeArea())
        // Pages scroll to the top edge cleanly, with no blur or fade laid over
        // the first lines.
        .scrollEdgeEffectHidden(true, for: .top)
        .frame(minWidth: 1040, minHeight: 640)
        .overlay { paletteOverlay }
        .animation(Motion.quick, value: nav.sheet == .palette)
        // First-run setup takes the whole window, not a sheet.
        .overlay {
            if nav.sheet == .onboarding {
                OnboardingView()
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            }
        }
        .animation(Motion.screen, value: nav.sheet == .onboarding)
        // Search floats over the window instead (see paletteOverlay), and
        // setup covers it (above).
        .fnSheet(item: Binding(get: { nav.sheet == .palette || nav.sheet == .onboarding ? nil : nav.sheet },
                               set: { nav.sheet = $0 })) { sheet in
            switch sheet {
            case .settings: SettingsView()
            case .update: UpdateSheet()
            case .onboarding: EmptyView()
            case .palette: EmptyView()
            }
        }
        // Menus and dialogs, drawn in the web app's style over the window.
        // Toasts stay above them, as on the web.
        .popupHost()
        .overlay(ToastStack().allowsHitTesting(false))
        .task {
            // Notes, talks and the library, indexed for the assistant in the background.
            if !AppModel.isTesting { Knowledge.shared.start(store: store) }
            // A brand new install starts on the setup wizard.
            if store.needsOnboarding, nav.sheet == nil { nav.present(.onboarding) }
            // A release found on an earlier day is offered again a little after launch.
            try? await Task.sleep(for: .seconds(4))
            offerUpdate()
        }
        // …and one the daily check finds while the app is open.
        .onChange(of: updates.available?.version) { _, _ in offerUpdate() }
        .onChange(of: nav.tab) { _, tab in
            nav.clearPulse(tab)
            // Focus mode belongs to the note editor; any other tab brings the
            // app back.
            if tab != .notes { nav.focusMode = false }
        }
    }

    /// The update pop-up, once a launch, never over another sheet or the first-run setup.
    private func offerUpdate() {
        guard updates.shouldPrompt, nav.sheet == nil, !store.needsOnboarding else { return }
        updates.didPrompt()
        nav.present(.update)
    }

    /// Search and quick add, over a dimmed window. A sheet on macOS ignores
    /// clicks outside it; this closes on one, as Spotlight does.
    @ViewBuilder
    private var paletteOverlay: some View {
        if nav.sheet == .palette {
            GeometryReader { geo in
                ZStack(alignment: .top) {
                    Color.black.opacity(0.3)
                        .contentShape(Rectangle())
                        .onTapGesture { nav.sheet = nil }
                        .accessibilityLabel("Close search")
                        .accessibilityAddTraits(.isButton)
                        .transition(.opacity)
                    // A tenth and a bit of the way down, as the web's (12vh).
                    CommandPaletteView()
                        .frame(maxHeight: geo.size.height * 0.76, alignment: .top)
                        .padding(.top, geo.size.height * 0.12)
                        .transition(.scale(scale: 0.97, anchor: .top).combined(with: .opacity))
                }
            }
        }
    }

    /// The note editor has the whole window.
    private var focused: Bool { nav.focusMode && nav.tab == .notes }

    private var main: some View {
        ZStack(alignment: .bottom) {
            content
                .id(nav.tab)
                .transition(.opacity.combined(with: .offset(y: 8)))
                .animation(Motion.screen, value: nav.tab)
            // Today has the assistant in the middle of its page; everywhere
            // else it's a round button in the corner.
            if nav.tab != .today {
                ChatDock(minimized: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .entrance(delay: 0.03)
    }

    /// Every view lays out its own sheets, each scrolling on its own.
    @ViewBuilder
    private var content: some View {
        if !store.ready {
            Text("Loading…")
                .font(FN.body)
                .foregroundStyle(p.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .paper(p)
        } else {
            Group {
                switch nav.tab {
                case .today: TodayView()
                case .notes: NotesView()
                case .todo: TodoView()
                case .finance: FinanceView()
                case .transcribe: TranscribeView()
                case .library: LibraryView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
