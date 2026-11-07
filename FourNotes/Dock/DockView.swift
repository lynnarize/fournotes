import SwiftUI

// What the edge dock draws: the handle while closed, the drawer while open (see
// EdgeDrawer.swift), and the one shape that grows from one into the other.

enum MiniApp: String, CaseIterable, Identifiable, Hashable {
    case note, tasks, bills, transcribe, spend, ask

    var id: String { rawValue }

    var title: String {
        switch self {
        case .note: return "Quick note"
        case .tasks: return "Today"
        case .bills: return "Coming up"
        case .transcribe: return "Transcribe"
        case .spend: return "Spend"
        case .ask: return "Ask"
        }
    }

    /// Where each starts: Today, what's due and Ask in the column nearest the
    /// edge — under the pointer that just opened the drawer.
    static let defaultLayout: [[MiniApp]] = [[.tasks, .bills, .ask], [.note, .transcribe, .spend]]

    /// "tasks,bills,ask|note,transcribe,spend" back into columns. Anything
    /// unknown or repeated is dropped; anything missing (a mini app added in
    /// an update) goes where it starts by default.
    static func layout(from saved: String?) -> [[MiniApp]] {
        guard let saved, !saved.isEmpty else { return defaultLayout }
        var seen = Set<MiniApp>()
        var columns = saved.components(separatedBy: "|").prefix(2).map { column in
            column.split(separator: ",").compactMap { MiniApp(rawValue: String($0)) }
                .filter { seen.insert($0).inserted }
        }
        while columns.count < 2 { columns.append([]) }
        for (index, column) in defaultLayout.enumerated() {
            for app in column where !seen.contains(app) { columns[index].append(app) }
        }
        return columns
    }

    static func encode(_ layout: [[MiniApp]]) -> String {
        layout.map { $0.map(\.rawValue).joined(separator: ",") }.joined(separator: "|")
    }
}

/// The dock's root: the shared objects and the theme, resolved once.
struct DockScene: View {
    let model: AppModel
    @ObservedObject var dock: EdgeDock
    @AppStorage("fournotes.theme") private var themeRaw = ThemeChoice.system.rawValue
    @AppStorage(Palette.frameKey) private var frameRaw = "ink"
    @Environment(\.colorScheme) private var systemScheme

    var body: some View {
        let theme = ThemeChoice(rawValue: themeRaw) ?? .system
        let scheme = theme.colorScheme ?? systemScheme
        let chosen = DockStyle.style(for: theme, scheme: scheme)
        let style = frameRaw == "light" && scheme != .dark ? chosen.withLightFrame : chosen
        DockRoot(dock: dock)
            .tracking(-0.16)
            .environment(\.colorScheme, scheme)
            .environment(\.palette, theme.palette(for: scheme))
            .environment(\.dock, style)
            .tint(style.accent)
            .environmentObject(model.store)
            .environmentObject(model.nav)
            .environmentObject(model.toasts)
            .environmentObject(model.assistant)
            .environmentObject(model.engine)
            .environment(\.openURL, .webOnly)
    }
}

struct DockRoot: View {
    @ObservedObject var dock: EdgeDock
    @ObservedObject private var stickies = EdgeStickies.shared
    @EnvironmentObject private var store: Store
    @Environment(\.dock) private var d

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let g = shown
            let mirrored = dock.edge == .left
            let shape = EdgeTabShape(g, mirrored: mirrored)
            let drawerWindow = width > DockGeometry.handlePeekWidth + DockGeometry.handleMargin + 1
            ZStack(alignment: .topLeading) {
                // Stuck notes, a bubble each, split off the handle's top and
                // bottom. Behind the handle, which hides where they come from.
                if dock.islandShown {
                    StickyIsland(dock: dock, progress: dock.islandProgress, expansion: dock.expansion,
                                 previousExpansion: dock.previousExpansion, pulse: dock.pulse,
                                 ids: dock.bubbleIds, ys: dock.bubbleYs, expanded: dock.expandedBubble,
                                 previous: dock.previousBubble, pulsing: dock.pulsingBubble,
                                 handleCenter: CGPoint(x: x(for: DockGeometry.handleWidth, in: width),
                                                       y: g.centerFromTop),
                                 handleHalf: g.bodyHeight / 2, edge: dock.edge, width: width,
                                 fill: d.frame)
                        .environment(\.dock, d.onFrame)
                }

                // The closed handle's soft shadow, kept outside it: under the
                // see-through body it would darken the handle itself. None on
                // the open drawer: it spread a grey band over the app beside
                // it, and the thin edge is enough to set it apart.
                shape.fill(Color.black)
                    .shadow(color: .black.opacity(0.25), radius: 4, y: 1)
                    .mask {
                        Rectangle()
                            .overlay { shape.fill(Color.black).blendMode(.destinationOut) }
                            .compositingGroup()
                    }
                    .opacity(dock.isOpen ? 0 : 1)
                    .allowsHitTesting(false)
                // Solid ink, like the frame around the main window's sheets. A hairline edge,
                // so the body reads against dark apps.
                shape.fill(d.frame)
                shape.stroke(d.frameHair, lineWidth: 1)

                ZStack(alignment: .topLeading) {
                    HandleFace(dock: dock)
                        .environment(\.dock, d.onFrame)
                        .frame(width: g.bodyWidth, height: DockGeometry.handleHeight)
                        .position(x: x(for: g.bodyWidth, in: width), y: g.centerFromTop)
                        .opacity(dock.isOpen ? 0 : 1)
                        .allowsHitTesting(!dock.isOpen)

                    // Always there, only hidden while closed: a click beside the
                    // drawer must not cost a draft, a reply on its way or the
                    // scroll position. Clipped away by the handle's shape.
                    let showsDrawer = dock.isOpen
                    EdgeDrawer(dock: dock)
                        .frame(width: DockGeometry.drawerWidth, height: dock.drawerHeight)
                        .position(x: x(for: DockGeometry.drawerWidth, in: width),
                                  y: drawerWindow ? proxy.size.height / 2 : g.centerFromTop)
                        .opacity(showsDrawer ? 1 : 0)
                        .allowsHitTesting(showsDrawer)
                        .accessibilityHidden(!showsDrawer)
                }
                .clipShape(shape)
            }
        }
        .ignoresSafeArea()
    }

    /// The geometry as drawn: the handle peeks out further under the pointer.
    private var shown: DockGeometry {
        var g = dock.geometry
        if !dock.isOpen && dock.hovering { g.bodyWidth = DockGeometry.handlePeekWidth }
        return g
    }

    private func x(for bodyWidth: CGFloat, in width: CGFloat) -> CGFloat {
        dock.edge == .right ? width - bodyWidth / 2 : bodyWidth / 2
    }

}

// MARK: - The handle

private struct HandleFace: View {
    @ObservedObject var dock: EdgeDock
    @GestureState private var dragging = false
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var assistant: Assistant
    @ObservedObject private var transcriber = QuickTranscriber.shared
    @Environment(\.dock) private var d

    var body: some View {
        let due = Glance.dueByToday(store.liveTodos)
        VStack(spacing: 7) {
            Icon(dock.edge == .right ? "chevronLeft" : "chevron", size: 11, weight: 2.6)
                .foregroundStyle(d.muted)
                .opacity(dock.hovering ? 1 : 0)
                .frame(height: dock.hovering ? 11 : 0)

            if transcriber.phase == .listening || assistant.recording {
                LiveBadge(levels: transcriber.phase == .listening ? transcriber.levels : [])
            } else {
                TasksRing()
            }
        }
        .animation(Motion.standard, value: dock.hovering)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .updating($dragging) { _, state, _ in state = true }
            .onChanged { _ in dock.dragChanged() }
            .onEnded { _ in if !dock.dragEnded() { dock.open() } })
        // Reset on cancel too, which onEnded never hears about.
        .onChange(of: dragging) { _, now in if !now { dock.dragCancelled() } }
        .contextMenu { HandleMenu(dock: dock) }
        .help(due.isEmpty ? "Four Notes — nothing due today" : "Four Notes — \(due.count) due today")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Four Notes edge dock")
        .accessibilityValue(due.isEmpty ? "Nothing due today" : "\(due.count) due today")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { dock.open() }
    }
}

/// Recording: a red dot and the level, so it's plain the microphone is on
/// even with the drawer closed.
private struct LiveBadge: View {
    @Environment(\.dock) private var d
    let levels: [Float]
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 6) {
            Circle().fill(d.danger)
                .frame(width: 8, height: 8)
                .opacity(pulse ? 0.35 : 1)
                .animation(Motion.pulse, value: pulse)
                .onAppear { pulse = true }
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { i in
                    let level = levels.isEmpty ? 0.3 : CGFloat(levels[max(0, levels.count - 1 - i * 3)])
                    Capsule(style: .circular).fill(d.danger)
                        .frame(width: 2.5, height: 4 + 14 * level)
                }
            }
            .frame(height: 18)
            .animation(.linear(duration: 0.08), value: levels)
        }
    }
}

private struct HandleMenu: View {
    @ObservedObject var dock: EdgeDock
    @ObservedObject private var stickies = EdgeStickies.shared

    var body: some View {
        Button("Open Drawer") { dock.open() }
        Button("Open Four Notes") { dock.showApp() }
        Divider()
        Menu("Sticky Notes") {
            ForEach(stickies.shownIds, id: \.self) { id in
                Button(stickies.note(id).map { $0.title.isEmpty ? "Untitled" : $0.title } ?? "Untitled") {
                    dock.openSticky(id)
                }
            }
            if !stickies.shownIds.isEmpty { Divider() }
            Button("New Sticky Note") { stickies.stickNew() }
        }
        Divider()
        Picker("Edge", selection: Binding(get: { dock.edge }, set: { dock.setEdge($0) })) {
            Text("Right Edge").tag(DockEdge.right)
            Text("Left Edge").tag(DockEdge.left)
        }
        .pickerStyle(.inline)
        Divider()
        Button("Hide Edge Dock") { dock.setEnabled(false) }
    }
}
