import SwiftUI

// The sidebar sits on the frame and holds places only, as on the web
// (src/components/Sidebar.tsx): the tabs, recent notes and spaces, with Settings and sync at
// its foot. Starting something lives in the toolbar's omnibar. It's drawn with the frame's
// palette (see Palette.onFrame).

struct SidebarView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var assistant: Assistant
    @ObservedObject private var servers = LocalServers.shared
    @ObservedObject private var updates = UpdateCheck.shared
    @ObservedObject private var talks = TalkStore.shared
    @ObservedObject private var recorder = TalkRecorder.shared
    @ObservedObject private var library = Knowledge.shared

    private var counts: [Tab: Int] {
        let month = DateKit.localMonth()
        let endToday = Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: Date()) ?? Date()
        return [
            .today: store.liveTodos.filter { !$0.done && (DateKit.date($0.dueAt).map { $0 <= endToday } ?? false) }.count,
            .notes: store.liveNotes.count,
            .todo: store.liveTodos.filter { !$0.done }.count,
            .finance: store.liveTransactions.filter { $0.date.hasPrefix(month) }.count,
            .transcribe: talks.live(in: store.currentSpaceId).count,
            .library: library.sources(in: store.currentSpaceId).count,
        ]
    }

    /// The newest notes, one click from anywhere.
    private var recent: [Note] {
        Array(store.liveNotes.filter { !$0.title.isEmpty }.sorted { $0.updatedAt > $1.updatedAt }.prefix(3))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // The places. The count gives way to a menu of quick actions while a row is in use.
            let counts = counts
            VStack(spacing: 2) {
                ForEach(Tab.allCases) { tab in
                    TabRow(tab: tab, count: counts[tab] ?? 0, entries: { entries(for: tab) })
                }
            }

            if !recent.isEmpty {
                sectionLabel("Recent")
                VStack(spacing: 2) {
                    ForEach(recent) { note in
                        NavRow(icon: "note", title: note.title) {
                            nav.selectedNoteId = note.id
                            nav.tab = .notes
                        }
                    }
                }
            }

            // Shared spaces are only there once signed in.
            if !store.spaces.isEmpty {
                sectionLabel("Spaces")
                VStack(spacing: 2) {
                    NavRow(icon: "users", title: "Personal", selected: store.currentSpaceId == nil) { store.switchSpace(nil) }
                    ForEach(store.spaces) { space in
                        NavRow(icon: "users", title: space.name, selected: store.currentSpaceId == space.id) {
                            store.switchSpace(space.id)
                        }
                    }
                }
            }

            Spacer(minLength: 16)

            VStack(alignment: .leading, spacing: 4) {
                // A local model server holds a model in memory until it's stopped.
                ForEach(servers.running) { kind in
                    ServerRunningRow(kind: kind)
                        .transition(.opacity.combined(with: .offset(y: 6)))
                }
                NavRow(icon: "settings", title: "Settings", shortcut: "⌘,",
                       badge: updates.hasUnseenUpdate ? "A new version is available" : nil) {
                    // With a new version waiting, open where it can be downloaded.
                    if updates.hasUnseenUpdate { nav.openSettings(section: "about") } else { nav.present(.settings) }
                }
                // Where the data lives.
                SyncStatusRow(sync: AppModel.shared.sync.isAvailable ? AppModel.shared.sync : nil)
            }
        }
        .padding(.top, 2)
        .padding(.bottom, 4)
        .frame(width: 236, alignment: .leading)
        .animation(Motion.standard, value: servers.running)
        .entrance()
        .task { servers.startWatching() }
        .onDisappear { servers.stopWatching() }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(FN.font(12, .semibold))
            .tracking(0.36)
            .foregroundStyle(p.textMuted)
            .padding(.horizontal, 12)
            .padding(.top, 20)
            .padding(.bottom, 6)
    }

    // MARK: - Tab actions

    /// What a tab's "…" menu offers: making the thing that tab holds.
    private func entries(for tab: Tab) -> [MenuEntry] {
        switch tab {
        case .today:
            return [
                .item("Open Today", icon: "today") { nav.tab = .today },
                .item("Search or quick add…", icon: "search") { nav.present(.palette) },
            ]
        case .notes:
            return [
                .item("New note", icon: "noteAdd") { QuickCreate.note(store: store, nav: nav) },
                .item("Scan a note…", icon: "scan") { assistant.pickAndScan() },
                .item(assistant.recording ? "Stop recording" : "Record to note", icon: assistant.recording ? "stop" : "mic") {
                    assistant.recording ? assistant.stopRecording() : assistant.startRecording()
                },
            ]
        case .todo:
            return [.item("New task", icon: "todo") { QuickCreate.task(store: store, nav: nav) }]
        case .finance:
            return [
                .item("New transaction", icon: "finance") { QuickCreate.transaction(store: store, nav: nav) },
                .item("Scan a receipt…", icon: "scan") { assistant.pickAndScan() },
            ]
        case .transcribe:
            if recorder.isActive, let id = recorder.talkId {
                return [.item("Go to the recording") { nav.open(ChangeLink(kind: .talks, id: id)) }]
            }
            return [.item("New recording…") { nav.selectedTalkId = TranscribeView.newRecording; nav.tab = .transcribe }]
        case .library:
            return [
                .item("Add files…", icon: "fileText") { nav.tab = .library; library.pickFiles() },
                .item("Add a folder…", icon: "folder") { nav.tab = .library; library.pickFolder() },
                .item("Add a web page…", icon: "link") { nav.selectedSourceId = LibraryView.newPage; nav.tab = .library },
            ]
        }
    }
}

// MARK: - Rows

/// One place: icon and name, its count, and a "…" menu. The kit's nav row: the open
/// one on the accent wash, its icon in the accent.
private struct TabRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @State private var hovering = false

    let tab: Tab
    let count: Int
    @ObservedObject private var recorder = TalkRecorder.shared
    let entries: () -> [MenuEntry]

    var body: some View {
        let selected = nav.tab == tab
        let hasNew = nav.pulsing.contains(tab) && !selected

        ZStack(alignment: .trailing) {
            Button { nav.tab = tab } label: {
                HStack(spacing: 12) {
                    Icon(tab.sidebarIcon, size: 18)
                        .foregroundStyle(selected ? p.accent : p.textSecondary)
                    Text(tab.title)
                        .font(FN.font(15, .medium))
                        .foregroundStyle(p.foreground)
                    Spacer(minLength: 4)
                    if hasNew {
                        Circle()
                            .fill(p.accent)
                            .frame(width: 7, height: 7)
                            .transition(.scale(scale: 0.2).combined(with: .opacity))
                            .accessibilityLabel("New from the assistant")
                    }
                    // A talk being recorded, whichever tab is showing.
                    if tab == .transcribe && recorder.isActive {
                        RecordingDot(size: 7)
                            .opacity(hovering ? 0 : 1)
                            .help("Recording")
                    } else if count > 0 {
                        // The count gives way to the menu while the row is in use.
                        Text("\(count)")
                            .font(FN.small)
                            .monospacedDigit()
                            .foregroundStyle(p.textMuted)
                            .contentTransition(.numericText())
                            .opacity(hovering ? 0 : 1)
                    }
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                .background(selected ? p.accentSubtle : (hovering ? p.hover : .clear),
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            .accessibilityLabel(tab.title)
            .accessibilityValue(count > 0 ? "\(count) item\(count == 1 ? "" : "s")" : "")
            .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)

            if hovering {
                IconMenu("more", size: 18, box: 28, help: "\(tab.title) actions", entries: entries)
                    .padding(.trailing, 4)
                    .transition(.opacity)
            }
        }
        .motion(selected, Motion.quick)
        .motion(hovering, Motion.quick)
        .motion(hasNew, Motion.standard)
        .onHover { hovering = $0 }
    }
}

/// A row at the bottom of the sidebar (Settings), in the nav row's style, with its
/// shortcut at the end.
private struct NavRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let icon: String
    let title: String
    var shortcut: String?
    /// Puts a small dot on the icon; the text says why, for VoiceOver and the tooltip.
    var badge: String?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Icon(icon, size: 18)
                    .foregroundStyle(p.textSecondary)
                    .overlay(alignment: .topTrailing) {
                        if badge != nil {
                            Circle()
                                .fill(p.danger)
                                .frame(width: 7, height: 7)
                                .overlay(Circle().stroke(p.sidebar, lineWidth: 1.5))
                                .offset(x: 3, y: -2)
                                .transition(.scale(scale: 0.2).combined(with: .opacity))
                        }
                    }
                    .animation(Motion.standard, value: badge != nil)
                Text(title).font(FN.font(15, .medium)).lineLimit(1)
                Spacer(minLength: 0)
                if let shortcut {
                    Text(shortcut).font(FN.small).foregroundStyle(p.textMuted)
                }
            }
            .foregroundStyle(p.foreground)
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(selected || hovering ? p.hover : .clear,
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .help(badge ?? "")
        .accessibilityLabel(title)
        .accessibilityValue(badge ?? "")
    }
}

/// Half of the capture row: the kit's secondary button, at regular weight.
/// "LM Studio is running" with a Stop button, while a local server is on.
private struct ServerRunningRow: View {
    @Environment(\.palette) private var p
    @ObservedObject private var servers = LocalServers.shared
    let kind: LocalServers.Kind

    var body: some View {
        let working = servers.working.contains(kind)
        HStack(spacing: 8) {
            Icon("warning", size: 14).foregroundStyle(p.warning)
            VStack(alignment: .leading, spacing: 0) {
                Text("\(kind.name) is running").font(FN.font(13, .medium)).foregroundStyle(p.text).lineLimit(1)
                Text("Using memory until stopped").font(FN.tiny).foregroundStyle(p.faint).lineLimit(1)
            }
            Spacer(minLength: 4)
            Button(working ? "Stopping…" : "Stop") { Task { await servers.stop(kind) } }
                .buttonStyle(.fn)
                .font(FN.font(12, .medium))
                .foregroundStyle(p.danger)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(p.dangerSubtle, in: Capsule(style: .circular))
                .disabled(working)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(p.warningSubtle, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kind.name) server is running")
    }
}

extension Tab {
    /// The sidebar uses the app's own glyphs, not SF Symbols.
    var sidebarIcon: String {
        switch self {
        case .today: return "today"
        case .notes: return "note"
        case .todo: return "calendar"
        case .finance: return "wallet"
        case .transcribe: return "wave"
        case .library: return "book"
        }
    }
}

/// Where the data lives, as the web sidebar's last line: "Saved on this Mac", or the
/// sync state, green once synced, red on an error. Opens Settings at Sync.
private struct SyncStatusRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    /// Nil when this build has no sync.
    var sync: GoogleSync?

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(p.borderSubtle).frame(height: 1)
            if let sync {
                SyncLine(sync: sync)
            } else {
                HStack(spacing: 8) {
                    Icon("cloud", size: 16)
                    Text("Saved on this Mac").lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(FN.small)
                .foregroundStyle(p.textMuted)
                .padding(.horizontal, 12)
                .frame(minHeight: 32)
                .padding(.top, 10)
            }
        }
    }
}

private struct SyncLine: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @ObservedObject var sync: GoogleSync
    @State private var hovering = false

    private var label: String {
        guard sync.account != nil else { return "Saved on this Mac" }
        switch sync.status {
        case .syncing: return "Syncing… · Google Drive"
        case .offline: return "Offline · Google Drive"
        case .error: return "Sync error · Google Drive"
        case .synced: return "Synced · Google Drive"
        case .idle: return sync.lastSynced == nil ? "Not synced yet · Google Drive" : "Synced · Google Drive"
        }
    }

    private var tone: Color {
        guard sync.account != nil else { return p.textMuted }
        switch sync.status {
        case .error: return p.danger
        case .synced: return p.success
        case .idle: return sync.lastSynced == nil ? p.textMuted : p.success
        case .syncing, .offline: return p.textMuted
        }
    }

    private var help: String {
        if sync.status == .error, let message = sync.message { return message }
        if let last = sync.lastSynced { return "Last synced \(last.formatted(.relative(presentation: .named)))" }
        return "Keep this Mac and the web app in step through Google Drive"
    }

    var body: some View {
        Button { nav.openSettings(section: "sync") } label: {
            HStack(spacing: 8) {
                Icon("cloud", size: 16)
                    .foregroundStyle(tone)
                    .opacity(sync.status == .syncing ? 0.6 : 1)
                    .motion(sync.status, Motion.quick)
                Text(label).lineLimit(1).truncationMode(.tail)
                    .foregroundStyle(hovering ? p.foreground : p.textMuted)
                Spacer(minLength: 0)
                if sync.account == nil {
                    Text("Turn on sync")
                        .font(FN.font(12, .medium))
                        .foregroundStyle(p.foreground)
                        .underline(hovering)
                }
            }
            .font(FN.small)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .padding(.top, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(sync.account == nil ? "Saved on this Mac. Turn on sync" : label)
    }
}
