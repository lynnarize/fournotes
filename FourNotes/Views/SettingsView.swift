import AppKit
import SwiftUI
import UserNotifications

// Settings, after Arc, as on the web (src/components/SettingsModal.tsx): a big dialog
// with the sections listed on the left (a field to find a setting above them, the
// version below) and the settings on the right as grouped rows. Every section is on
// one page, so the list jumps to a section and follows the scrolling. Budgets and
// categories live in Finance settings.

private let KOFI_URL = "https://ko-fi.com/lynnarize"

private let PRIVACY_POINTS: [(icon: String, title: String, text: String)] = [
    ("shield", "Saved on this Mac",
     "Everything you add is stored in a file on this Mac. There's no Four Notes account or server. If you turn on Sync, a copy is kept in a private app folder in your own Google Drive."),
    ("sparkle", "Shared with AI only when you ask",
     "Apple Intelligence and models in LM Studio or Ollama answer on this Mac. A cloud model you add gets only what a request needs, straight from this Mac. The results are saved here."),
    ("cloud", "Little else goes online",
     "Exchange rates are looked up by currency code, GitHub is asked once a day for a newer release (you can turn that off), and Sync, when you turn it on, talks only to Google Drive. That's all."),
    ("key", "Your API keys stay private",
     "Keys are kept in this Mac's Keychain only. They are never included in backups."),
]

struct SettingsView: View {
    @ObservedObject private var dock = EdgeDock.shared
    @ObservedObject private var stickies = EdgeStickies.shared
    @ObservedObject private var updates = UpdateCheck.shared
    @ObservedObject private var sync = AppModel.shared.sync
    @ObservedObject private var speech = SpeechModels.shared
    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.closeModal) private var closeModal
    @Environment(\.modalMaxHeight) private var windowLimit
    @Environment(\.modalMaxWidth) private var windowWidth
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @EnvironmentObject private var engine: AIEngine

    @AppStorage("fournotes.theme") private var themeRaw = ThemeChoice.system.rawValue
    @AppStorage(BriefStyle.storageKey) private var briefStyleRaw = BriefStyle.paragraph.rawValue

    /// The section being read; the list lights it up.
    @State private var current = "appearance"
    @State private var query = ""
    /// While a click in the list scrolls the page, the list keeps the clicked section lit.
    @State private var holdSpy = Date.distantPast
    /// Where each section's top is, in the scrolling page.
    @State private var tops: [String: CGFloat] = [:]
    @State private var atEnd = false
    @State private var confirmWipe = false
    @State private var confirmDeleteDrive = false
    /// Which of "On this Mac" / "In the cloud" / "Speech models" is unfolded.
    @State private var openGroup: String?
    /// Bumped by "Forget all keys" so the provider editors reload.
    @State private var keysGeneration = 0
    /// The Privacy Policy or Terms, open over Settings.
    @State private var legalDocument: LegalDocument?
    @State private var notifications: UNAuthorizationStatus?

    /// `query` opens it already filtered, as if typed in "Find a setting".
    init(query: String = "") {
        _query = State(initialValue: query)
    }

    private var settings: AppSettings { store.settings }

    private struct Section: Identifiable {
        let id: String
        let icon: String
        let title: String
        var description: String?
        let keywords: String
    }

    /// In the order they appear. The ids are the deep-link names (openSettings(section: "api"), …).
    private var sections: [Section] {
        var out = [
            Section(id: "appearance", icon: "palette", title: "Appearance",
                    description: "Changes apply straight away, on this Mac.",
                    keywords: "theme look light dark paper system accent colour color"),
            Section(id: "today", icon: "today", title: "Today",
                    keywords: "daily brief greeting paragraph point by point"),
            Section(id: "api", icon: "sparkle", title: "AI and keys",
                    keywords: "assistant api key keys openrouter opencode claude anthropic model free paid apple intelligence lm studio ollama local cloud speech whisper transcription"),
            Section(id: "general", icon: "settings", title: "General",
                    keywords: "name currency money voice replies speak notifications reminders setup first run"),
            Section(id: "dock", icon: "collapseLeft", title: "Edge Dock",
                    keywords: "dock edge handle mini apps sticky notes stickies screen"),
        ]
        if sync.isAvailable {
            out.append(Section(id: "sync", icon: "cloud", title: "Backup and sync",
                               description: "Everything is saved on this Mac. Sync keeps a copy in your own Google Drive.",
                               keywords: "google drive account sign in out connect disconnect"))
        }
        out += [
            Section(id: "privacy", icon: "shield", title: "Data and privacy",
                    keywords: "data privacy export import backup file sample delete erase local terms policy keys"),
            Section(id: "about", icon: "info", title: "About",
                    keywords: "version build commit update release notes coffee support ko-fi"),
        ]
        return out
    }

    private func matches(_ section: Section, _ q: String) -> Bool {
        let hay = "\(section.title) \(section.keywords)".lowercased()
        return q.split(separator: " ").allSatisfy { hay.contains($0) }
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let visible = q.isEmpty ? sections : sections.filter { matches($0, q) }
        ScrollViewReader { proxy in
            HStack(spacing: 0) {
                sidebar(visible, proxy: proxy)
                Rectangle().fill(p.border).frame(width: 1)
                page(visible, query: q)
            }
            .task {
                // Opened at a section (a deep link): scroll to it.
                guard current != visible.first?.id else { return }
                holdSpy = Date().addingTimeInterval(0.8)
                proxy.scrollTo(current, anchor: .top)
            }
        }
        .frame(width: min(1120, windowWidth ?? 1120))
        .frame(height: min(800, windowLimit ?? 800))
        .preference(key: ModalShapeKey.self, value: .surface)
        .fnSheet(item: $legalDocument) { LegalSheet(document: $0) }
        .fnSheet(isPresented: $confirmWipe) { wipeConfirmation }
        .fnSheet(isPresented: $confirmDeleteDrive) { deleteDriveConfirmation }
        .onAppear {
            updates.markSeen()
            if let requested = nav.settingsSection {
                current = requested
                nav.settingsSection = nil
            }
        }
        .task { notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    }

    // MARK: - The list

    private func sidebar(_ visible: [Section], proxy: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Settings")
                .font(FN.display(28))
                .tracking(FN.displayTracking(28))
                .foregroundStyle(p.foreground)
                .padding(.horizontal, 12)
                .accessibilityAddTraits(.isHeader)
            FindField(text: $query)
            VStack(spacing: 2) {
                ForEach(visible) { section in
                    SettingsNavRow(icon: section.icon, title: section.title, selected: section.id == current,
                                   trailing: section.id == "sync" ? (sync.account != nil ? "On" : "Off") : nil,
                                   badge: section.id == "about" && updates.available != nil) {
                        jump(section.id, proxy: proxy)
                    }
                }
            }
            Spacer(minLength: 0)
            Text("Four Notes \(AppVersion.marketing)")
                .font(FN.small)
                .monospacedDigit()
                .foregroundStyle(p.textMuted)
                .padding(.horizontal, 12)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 24)
        .frame(width: 260, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(p.sidebar)
    }

    private func jump(_ id: String, proxy: ScrollViewProxy) {
        current = id
        holdSpy = Date().addingTimeInterval(0.8)
        withAnimation(Motion.reduce ? nil : Motion.standard) { proxy.scrollTo(id, anchor: .top) }
    }

    /// Lights up the section being read: the last one whose top has passed near the
    /// top of the page, or the last one once the page is at its end.
    private func spy(_ visible: [Section]) {
        guard Date() >= holdSpy, let first = visible.first else { return }
        var reading = first.id
        for section in visible where (tops[section.id] ?? .infinity) <= 120 { reading = section.id }
        if atEnd, let last = visible.last { reading = last.id }
        if reading != current { current = reading }
    }

    // MARK: - The page

    private func page(_ visible: [Section], query: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 40) {
                if visible.isEmpty {
                    Text("No settings match “\(self.query.trimmingCharacters(in: .whitespaces))”.")
                        .font(FN.body)
                        .foregroundStyle(p.textSecondary)
                }
                ForEach(visible) { section in
                    SettingsSection(title: section.title, description: section.description) {
                        content(for: section.id)
                    }
                    .id(section.id)
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("settings-page")).minY } action: { top in
                        tops[section.id] = top
                        spy(visible)
                    }
                }
            }
            .frame(maxWidth: 700, alignment: .leading)
            .padding(.leading, 48)
            .padding(.trailing, 72)
            .padding(.top, 32)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .coordinateSpace(.named("settings-page"))
        .scrollBounceBehavior(.basedOnSize)
        .onScrollGeometryChange(for: Bool.self) { geo in
            geo.contentOffset.y + geo.containerSize.height >= geo.contentSize.height - 4
        } action: { _, end in
            atEnd = end
            spy(visible)
        }
        .overlay(alignment: .topTrailing) {
            CloseButton { if let closeModal { closeModal() } else { dismiss() } }
                .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(p.surface)
    }

    @ViewBuilder
    private func content(for id: String) -> some View {
        switch id {
        case "today": todayBrief
        case "api": apiKeys
        case "general": general
        case "dock": edgeDock
        case "sync": syncSection
        case "privacy": privacy
        case "about": about
        default: appearance
        }
    }

    // MARK: - Appearance

    private var appearance: some View {
        let theme = ThemeChoice(rawValue: themeRaw) ?? .system
        let hint: String = switch theme {
        case .system: "Follows your Mac, currently \(scheme == .dark ? "dark" : "light")."
        case .paper: "Warm paper and ink-brown text, whatever your Mac uses."
        case .light, .dark: "Always \(theme.label.lowercased()), whatever your Mac uses."
        }
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Theme").font(FN.bodyMedium).foregroundStyle(p.foreground)
                    .padding(.bottom, 10)
                ThemeCards()
                Text("\(hint) Switch quickly with ⌘K, then “dark mode”.")
                    .font(FN.font(13))
                    .foregroundStyle(p.textMuted)
                    .padding(.top, 10)
            }
            SettingsGroup {
                SettingsRow("Accent", description: "Used for what's selected or active") {
                    AccentSwatches()
                }
            }
        }
    }

    // MARK: - Today

    private var todayBrief: some View {
        let style = BriefStyle(rawValue: briefStyleRaw) ?? .paragraph
        return SettingsGroup {
            SettingsRow("Daily brief", description: "How the greeting sums up your day. \(style.detail)") {
                SegmentedTabs(items: BriefStyle.allCases.map { ($0.rawValue, $0.label) },
                              selection: $briefStyleRaw)
            }
        }
    }

    // MARK: - API keys and providers

    /// What answers right now and which kind is asked first stay in view; the
    /// three sets of models fold away behind a row that says what each is set to.
    private var apiKeys: some View {
        let r = engine.readiness
        return VStack(alignment: .leading, spacing: 16) {
            SettingsGroup {
                SettingsRow(r.route.label, description: "Photos and recordings are always read on this Mac.", leading: {
                    Circle().fill(r.route == .unavailable ? p.warning : p.success).frame(width: 8, height: 8)
                })
                SettingsBlock(spacing: 6) {
                    routeLine("sparkle", "Chat", r.chat)
                    routeLine("scan", "Scanning", r.scanning)
                    routeLine("mic", "Voice notes", r.voice)
                    routeLine("chart", "Brief & review", r.summaries)
                }
                SettingsRow("Ask first", description: engine.priority == .localFirst
                            ? "Stays on this Mac. The cloud is used only when you click “Ask …” under a reply."
                            : "The cloud answers; this Mac steps in when it can't be reached.") {
                    SegmentedTabs(items: AIEngine.Priority.allCases.map { ($0.rawValue, $0.label) },
                                  selection: Binding(get: { engine.priority.rawValue },
                                                     set: { engine.priority = AIEngine.Priority(rawValue: $0) ?? .localFirst }))
                }
            }

            modelGroup("local", icon: "monitor", title: "On this Mac", summary: engine.localSummary,
                       description: "Private and free. A model server, when set up, is asked before Apple Intelligence.") {
                ProviderSlotEditor(slot: .local).id(keysGeneration)
            }
            modelGroup("cloud", icon: "cloud", title: "In the cloud", summary: engine.cloudSummary,
                       description: "Your own keys. They stay in your Keychain and go only to the provider, with each request.") {
                CloudProviderTabs { anthropicKey }.id(keysGeneration)
            }
            modelGroup("speech", icon: "mic", title: "Speech models", summary: speech.summary,
                       description: "Transcribe recordings on this Mac with Whisper, and tell who said what.") {
                SpeechModelsSettings()
            }

            SettingsGroup {
                SettingsRow("Keys stay on this Mac",
                            description: "In the Keychain, sent only to the provider with each request. Never synced or backed up; usage is billed to your provider account.") {
                    KitButton(kind: .danger, title: "Forget all keys", small: true) {
                        Keychain.clearAll()
                        keysGeneration += 1
                        engine.refresh()
                        toasts.push("Keys and model settings removed from the Keychain.")
                    }
                }
            }
        }
    }

    /// A folded group of settings: a row that says what it's set to, and the
    /// settings under it when opened.
    private func modelGroup<Content: View>(_ id: String, icon: String, title: String, summary: String,
                                           description: String, @ViewBuilder _ content: () -> Content) -> some View {
        let isOpen = openGroup == id
        let content = content()
        return SettingsGroup {
            Button { withAnimation(Motion.standard) { openGroup = isOpen ? nil : id } } label: {
                SettingsRow(title, description: description) {
                    Text(summary).font(FN.font(13)).foregroundStyle(p.textMuted).lineLimit(1)
                    Icon("chevronDown", size: 16)
                        .foregroundStyle(p.textMuted)
                        .rotationEffect(.degrees(isOpen ? 0 : -90))
                } leading: {
                    SettingsTile(icon: icon)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            .accessibilityLabel(title)
            .accessibilityValue(summary)
            .accessibilityHint(isOpen ? "Hide these settings" : "Show these settings")

            if isOpen {
                SettingsBlock { content }
                    .transition(.opacity.combined(with: .offset(y: -6)))
            }
        }
    }

    private func routeLine(_ icon: String, _ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Icon(icon, size: 14).foregroundStyle(p.textMuted).padding(.top, 1)
            Text(label).foregroundStyle(p.textSecondary).frame(width: 100, alignment: .leading)
            Text(value).foregroundStyle(p.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(FN.font(13))
    }

    private var anthropicKey: some View {
        VStack(alignment: .leading, spacing: 10) {
            CloudHeader(badge: "Paid", tone: .accent, title: "Anthropic key, best quality",
                        link: ("Get a key", "https://console.anthropic.com/settings/keys"))
            KeyField(item: .anthropicKey, showsLabel: false) { engine.refresh() }
            HStack(alignment: .top, spacing: 12) {
                labelled("Main model") {
                    SelectMenu(options: AnthropicClient.userModels.map { ($0.id, $0.label) },
                               selection: keychainBinding(.anthropicModel, default: AnthropicClient.defaultModel))
                        .frame(maxWidth: .infinity)
                }
                labelled("Quick jobs model") {
                    SelectMenu(options: AnthropicClient.userModels.map { ($0.id, $0.label) },
                               selection: keychainBinding(.anthropicFastModel, default: AnthropicClient.defaultFastModel))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.top, 2)
            SettingsHint("Needed for “Ideas from the web”.")
        }
    }

    private func keychainBinding(_ item: Keychain.Item, default fallback: String) -> Binding<String> {
        Binding(
            get: { Keychain.read(item).flatMap { $0.isEmpty ? nil : $0 } ?? fallback },
            set: { Keychain.write(item, $0) })
    }

    // MARK: - General

    private var general: some View {
        SettingsGroup {
            SettingsRow("Your name", description: "Used in the daily brief") {
                CommittedField(placeholder: "", value: settings.name ?? "", boxed: true) { value in
                    let clean = value.trimmingCharacters(in: .whitespaces)
                    store.updateSettings { $0.name = clean.isEmpty ? nil : clean }
                }
                .frame(width: 224)
            }
            SettingsRow("Base currency", description: "Totals and budgets are counted in it") {
                SelectMenu(options: currencyOptions.map { ($0, $0) },
                           selection: Binding(get: { settings.currency }, set: { changeCurrency($0) }))
                    .fixedSize()
            }
            SettingsRow("Speak replies aloud", description: "In voice mode, the assistant reads its answers out") {
                Toggle("Speak replies aloud", isOn: Binding(
                    get: { settings.voiceReplies },
                    set: { value in store.updateSettings { $0.voiceReplies = value } }))
                    .toggleStyle(.fnSwitch)
            }
            SettingsRow("Notifications", description: notificationsHint) {
                switch notifications {
                case .notDetermined?:
                    SecondaryButton(title: "Turn on", small: true) {
                        Task {
                            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                            notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
                        }
                    }
                case .denied?:
                    StatusPill(text: "Blocked", tone: .muted, dot: false)
                case nil:
                    EmptyView()
                default:
                    StatusPill(text: "On", tone: .good)
                }
            }
            SettingsRow("First-time setup", description: "Walk through the setup again. Nothing you have is changed") {
                SecondaryButton(title: "Run setup again", small: true) {
                    // Dismiss and present in one turn and the second sheet never
                    // appears, so the wizard is handed to the next runloop turn.
                    nav.present(.onboarding)
                }
            }
        }
    }

    private var notificationsHint: String {
        switch notifications {
        case .denied?: return "Blocked in System Settings for Four Notes"
        case .notDetermined?: return "Turn on to be reminded when tasks are due"
        default: return "Reminders arrive when tasks are due"
        }
    }

    private var currencyOptions: [String] {
        var seen = Set<String>()
        return ([settings.currency] + CURRENCIES).filter { seen.insert($0).inserted }
    }

    private func changeCurrency(_ currency: String) {
        guard currency != settings.currency else { return }
        store.updateSettings { $0.currency = currency }
        // Stored rates were relative to the old base currency; refetch them.
        for t in store.all.transactions where t.fxRate != nil {
            store.updateTransaction(t.id) { $0.fxRate = nil }
        }
        toasts.push("Base currency is now \(currency). Budgets stay as numbers; adjust them if needed.")
    }

    // MARK: - Edge Dock

    private var edgeDock: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsGroup {
                SettingsRow("Show the edge dock",
                            description: "A handle on the edge of the screen, over any app, that opens a quick note, today's tasks, dictation and more. Click it, or press ⇧⌘. from Four Notes. Closing the window leaves it running.") {
                    Toggle("Show the edge dock", isOn: Binding(
                        get: { dock.isEnabled },
                        set: { value in if value != dock.isEnabled { dock.setEnabled(value) } }))
                        .toggleStyle(.fnSwitch)
                }
                Group {
                    SettingsRow("Edge", description: "Which side of the screen the handle sits on") {
                        SegmentedTabs(items: [("right", "Right"), ("left", "Left")],
                                      selection: Binding(get: { dock.edge == .right ? "right" : "left" },
                                                         set: { dock.setEdge($0 == "right" ? .right : .left) }))
                    }
                    if dock.screens.count > 1 {
                        SettingsRow("Screen") {
                            SelectMenu(options: dock.screens.map { ($0.id, $0.name) },
                                       selection: Binding(get: { dock.screenId }, set: { dock.moveToScreen($0) }))
                                .fixedSize()
                        }
                    }
                    SettingsBlock(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Mini apps").font(FN.body).foregroundStyle(p.foreground)
                            SettingsHint("What the dock shows. Drag a card by its title to move it, in either column.")
                        }
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3),
                                  alignment: .leading, spacing: 8) {
                            ForEach(MiniApp.allCases) { app in
                                Toggle(app.title, isOn: Binding(
                                    get: { !dock.hidden.contains(app) },
                                    set: { shown in dock.setHidden(app, !shown) }))
                                    .toggleStyle(.fnCheckbox)
                                    .font(FN.body)
                                    .foregroundStyle(p.foreground)
                            }
                        }
                    }
                    SettingsRow("Arrangement", description: "Put the cards back where they started") {
                        SecondaryButton(title: "Reset layout", small: true) {
                            withAnimation(Motion.standard) { dock.resetLayout() }
                        }
                        .disabled(dock.layout == MiniApp.defaultLayout)
                    }
                    SettingsRow("Open the dock now", description: "Or press ⇧⌘. from Four Notes") {
                        SecondaryButton(title: "Open", icon: "arrowUpRight", small: true) {
                            if let closeModal { closeModal() } else { dismiss() }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { dock.open() }
                        }
                    }
                }
                .disabled(!dock.isEnabled)
                .opacity(dock.isEnabled ? 1 : 0.45)
            }

            // Stickies stay on the edge whether the dock is on or not.
            SettingsGroup {
                SettingsRow("Sticky notes",
                            description: stickies.placements.isEmpty
                            ? "Stick a note to the edge from its menu, the dock's quick note, or ⌃⌘N. Point at the dock's handle and it splits off as a bubble above or below it."
                            : "\(stickies.placements.count) stuck. Point at the dock's handle and each splits off as a bubble above or below it; point at one for its title, click to open.") {
                    SecondaryButton(title: "Take all off", small: true) { stickies.unstickAll() }
                        .disabled(stickies.placements.isEmpty)
                }
            }
        }
    }

    // MARK: - Sync

    private var syncSection: some View {
        SettingsGroup {
            SettingsBlock {
                if let account = sync.account {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            GoogleG()
                            Text(account.email ?? "Google Drive")
                                .font(FN.bodyMedium).foregroundStyle(p.foreground)
                                .lineLimit(1).truncationMode(.middle)
                            StatusPill(text: syncLabel, tone: syncTone)
                                .monospacedDigit()
                        }
                        SettingsHint("Syncing to a private app folder in your Google Drive, in step with the web app. Changes sync automatically a few seconds after you edit, and whenever you come back to the app. Scans, sample data and API keys stay on this Mac.",
                                     tone: p.textSecondary)
                        if sync.status == .error, let message = sync.message {
                            SettingsHint(message, tone: p.danger)
                        }
                        HStack(spacing: 8) {
                            SecondaryButton(title: sync.status == .syncing ? "Syncing…" : "Sync now", icon: "repeat") {
                                sync.syncNow()
                            }
                            .disabled(sync.status == .syncing)
                            SecondaryButton(title: "Disconnect") {
                                Task { await sync.disconnect(deleteCopy: false) }
                            }
                            KitButton(kind: .danger, title: "Delete Drive copy") { confirmDeleteDrive = true }
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Sync with your Google account").font(FN.bodyMedium).foregroundStyle(p.foreground)
                            SettingsHint("Keep this Mac and the web app in step. Everything is saved in a private app folder in your own Google Drive that only Four Notes can open. What's already on this Mac is uploaded when you connect. Scans, sample data and API keys stay on this Mac.",
                                         tone: p.textSecondary)
                        }
                        GoogleButton(label: sync.connecting ? "Waiting for Google…" : "Continue with Google",
                                     disabled: sync.connecting) {
                            Task { await sync.connect() }
                        }
                        HStack(spacing: 0) {
                            Text("By connecting you agree to the ")
                            legalLink(.terms, "Terms")
                            Text(" and ")
                            legalLink(.privacy, "Privacy Policy")
                            Text(".")
                        }
                        .font(FN.small)
                        .foregroundStyle(p.textMuted)
                        if let message = sync.message {
                            SettingsHint(message, tone: p.danger)
                        }
                    }
                }
            }
        }
    }

    private var syncLabel: String {
        let time = sync.lastSynced.map { ", " + $0.formatted(date: .omitted, time: .shortened) } ?? ""
        switch sync.status {
        case .syncing: return "Syncing…"
        case .offline: return "Offline"
        case .error: return "Sync error"
        case .synced: return "Synced" + time
        case .idle: return sync.lastSynced == nil ? "Not synced yet" : "Synced" + time
        }
    }

    private var syncTone: StatusPill.Tone {
        switch sync.status {
        case .synced: return .good
        case .error: return .bad
        case .offline: return .warn
        case .idle: return sync.lastSynced == nil ? .muted : .good
        case .syncing: return .muted
        }
    }

    private func legalLink(_ document: LegalDocument, _ title: String) -> some View {
        Button(title) { legalDocument = document }
            .buttonStyle(.fn)
            .underline()
    }

    private var deleteDriveConfirmation: some View {
        TypeToConfirm(title: "Delete Drive copy?", confirmLabel: "Delete Drive copy", onConfirm: {
            Task { await sync.disconnect(deleteCopy: true) }
        }) {
            Text("This permanently deletes the copy of your notes, tasks and spending stored in \(Text(sync.account?.email ?? "your").font(FN.bodyMedium))'s Google Drive, and disconnects Google on this Mac.")
            Text("Data on this Mac is kept. Other devices keep their data too, but will stop syncing until they connect again.")
                .foregroundStyle(p.textSecondary)
        }
    }

    // MARK: - Data and privacy

    private var counts: (notes: Int, tasks: Int, transactions: Int) {
        (store.all.notes.filter { $0.deletedAt == nil }.count,
         store.all.todos.filter { $0.deletedAt == nil }.count,
         store.all.transactions.filter { $0.deletedAt == nil }.count)
    }

    private func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

    private var privacy: some View {
        let c = counts
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 0) {
                statTile("Notes", c.notes)
                Rectangle().fill(p.borderSubtle).frame(width: 1)
                statTile("Tasks", c.tasks)
                Rectangle().fill(p.borderSubtle).frame(width: 1)
                statTile("Transactions", c.transactions)
            }
            .fixedSize(horizontal: false, vertical: true)
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(p.border, lineWidth: 1))

            SettingsGroup {
                ForEach(PRIVACY_POINTS, id: \.title) { point in
                    SettingsRow(point.title, description: point.text, leading: { SettingsTile(icon: point.icon) })
                }
                SettingsBlock {
                    HStack(spacing: 0) {
                        Text("Full details in the ")
                        legalLink(.privacy, "Privacy Policy").foregroundStyle(p.foreground)
                        Text(" and the ")
                        legalLink(.terms, "Terms of Service").foregroundStyle(p.foreground)
                        Text(". Questions? ")
                        Button(LegalDocument.contact) {
                            if let url = URL(string: "mailto:\(LegalDocument.contact)") { NSWorkspace.shared.open(url) }
                        }
                        .buttonStyle(.fn)
                        .foregroundStyle(p.foreground)
                        .underline()
                    }
                    .font(FN.font(13))
                    .foregroundStyle(p.textSecondary)
                }
            }

            SettingsGroup {
                SettingsRow("Sample data", description: "A few example notes, tasks and transactions to try things out. They stay on this Mac and can be removed in one click.") {
                    if store.hasSamples {
                        SecondaryButton(title: "Remove sample data", small: true) { store.clearSamples() }
                    } else {
                        SecondaryButton(title: "Explore with sample data", small: true) { store.loadSamples() }
                    }
                }
                SettingsRow("Backup file", description: "Save everything to a file, or restore from one. When importing, the newer version of each item is kept. The file is the same format as the web app's export.") {
                    SecondaryButton(title: "Export", icon: "download", small: true, action: exportBackup)
                    SecondaryButton(title: "Import", small: true, action: importBackup)
                }
                SettingsRow("Data file", description: "Everything you add is kept in one file on this Mac.") {
                    SecondaryButton(title: "Show in Finder", small: true) {
                        NSWorkspace.shared.activateFileViewerSelecting([Persistence.shared.location])
                    }
                }
                SettingsRow("Local data", description: "Erase all notes, tasks, spending, settings and saved API keys from this Mac. A Google Drive copy, if you have one, isn't touched. This can't be undone.") {
                    KitButton(kind: .danger, title: "Delete all local data", small: true) { confirmWipe = true }
                }
            }
        }
    }

    private var wipeConfirmation: some View {
        let c = counts
        return TypeToConfirm(title: "Delete all local data?", confirmLabel: "Delete everything", onConfirm: {
            store.eraseEverything()
            Keychain.clearAll()
            toasts.push("All local data deleted.")
        }) {
            Text("This permanently erases from this Mac: \(plural(c.notes, "note")), \(plural(c.tasks, "task")), \(plural(c.transactions, "transaction")), your settings and budgets, and any saved API keys.")
            Text("\(sync.account != nil ? "The copy in your Google Drive is not touched. " : "")It can't be undone. Export a backup first if you might need it.")
                .foregroundStyle(p.textSecondary)
        }
    }

    private func statTile(_ label: String, _ n: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(n)")
                .font(FN.display(28))
                .tracking(FN.displayTracking(28))
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(p.foreground)
            Text(label).font(FN.font(13)).foregroundStyle(p.textMuted).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .motion(n, Motion.data)
    }

    private func labelled<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(FN.font(13)).foregroundStyle(p.textSecondary)
            content()
        }
    }

    private func exportBackup() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "four-notes-backup-\(DateKit.localDate()).json"
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            store.flush()
            // Inline the images so the backup is self-contained and the web
            // app can read it.
            try Persistence.shared.encode(Attachments.inliningImages(store.all)).write(to: url)
            toasts.push("Saved \(url.lastPathComponent)")
        } catch {
            toasts.push("Could not export: \(error.localizedDescription)", tone: .error)
        }
    }

    private func importBackup() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let data = try Data(contentsOf: url)
            var incoming = try Persistence.shared.decode(data)
            Attachments.extractInlineImages(&incoming)
            store.resumeSaving()
            store.mergeRemote(\.notes, incoming.notes)
            store.mergeRemote(\.todos, incoming.todos)
            store.mergeRemote(\.transactions, incoming.transactions)
            store.mergeRemote(\.stickies, incoming.stickies, reversed: true)
            store.mergeSettings(incoming.settings)
            Attachments.removeOrphans(keeping: store.all)
            toasts.push("Backup imported. The newer version of each item was kept.")
        } catch {
            toasts.push("That file isn't a Four Notes backup.", tone: .error)
        }
    }

    // MARK: - About

    private var about: some View {
        SettingsGroup {
            SettingsRow("Version", description: "Four Notes asks GitHub for a newer release; nothing else is sent.") {
                Text(AppVersion.short)
                    .font(FN.body).monospacedDigit()
                    .foregroundStyle(p.textSecondary)
                    .textSelection(.enabled)
            }
            if let commit = AppVersion.commit {
                SettingsRow("Commit") {
                    Text(commit)
                        .font(FN.body).monospacedDigit()
                        .foregroundStyle(p.textSecondary)
                        .textSelection(.enabled)
                }
            }
            SettingsRow("Updates", description: updateLine.text) {
                if let available = updates.available {
                    PrimaryButton(title: "Install \(available.version)…", small: true) { nav.present(.update) }
                } else {
                    SecondaryButton(title: updates.state == .checking ? "Checking…" : "Check for updates", small: true) {
                        updates.check()
                    }
                    .disabled(updates.state == .checking)
                }
                KitButton(kind: .plain, title: "Release notes", small: true) {
                    NSWorkspace.shared.open(AppVersion.releasesPage)
                }
            }
            SettingsRow("Check automatically", description: "Once a day") {
                Toggle("Check for updates automatically", isOn: $updates.automatic)
                    .toggleStyle(.fnSwitch)
            }
            SettingsRow("Enjoying Four Notes?", description: "Four Notes is free. If it helps you, a coffee keeps it going.") {
                SecondaryButton(title: "Buy me a coffee", icon: "coffee") {
                    if let url = URL(string: KOFI_URL) { NSWorkspace.shared.open(url) }
                }
            } leading: {
                SettingsTile(icon: "coffee")
            }
        }
    }

    /// What the last check found, said under "Updates".
    private var updateLine: (text: String, tone: Color?) {
        switch updates.state {
        case .idle, .checking:
            if let available = updates.available { return ("Version \(available.version) is available.", nil) }
            return ("You're on version \(AppVersion.marketing), build \(AppVersion.build).", nil)
        case .upToDate:
            return ("You're on the latest version.", nil)
        case .available(let version, _):
            return ("Version \(version) is available.", nil)
        case .failed(let message):
            return (message, p.danger)
        }
    }
}

// MARK: - Pieces

/// A provider's header in the cloud tabs: a badge, what the key is, and where to get one.
struct CloudHeader: View {
    enum Tone { case accent, success }
    @Environment(\.palette) private var p
    let badge: String
    var tone: Tone = .accent
    let title: String
    let link: (String, String)

    var body: some View {
        HStack(spacing: 8) {
            StatusPill(text: badge, tone: tone == .success ? .good : .accent, dot: false)
            Text(title).font(FN.font(13)).foregroundStyle(p.textSecondary)
            Spacer(minLength: 8)
            ExternalLink(title: link.0, address: link.1)
        }
    }
}

/// An underlined link that opens a web page, with an arrow after it.
struct ExternalLink: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let title: String
    let address: String

    var body: some View {
        Button { if let url = URL(string: address) { NSWorkspace.shared.open(url) } } label: {
            HStack(spacing: 4) {
                Text(title)
                    .underline(color: hovering ? p.foreground : p.borderStrong)
                Icon("arrowUpRight", size: 14)
            }
            .font(FN.font(13))
            .foregroundStyle(p.foreground)
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
    }
}

/// "Find a setting": the kit's field with a search glyph.
private struct FindField: View {
    @Environment(\.palette) private var p
    @Binding var text: String
    @FocusState private var focused: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Icon("search", size: 16).foregroundStyle(p.textMuted)
            TextField("Find a setting", text: $text)
                .textFieldStyle(.plain)
                .font(FN.body)
                .foregroundStyle(p.foreground)
                .focused($focused)
        }
        .padding(.leading, 12)
        .padding(.trailing, 12)
        .frame(height: 36)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
            .strokeBorder(focused || hovering ? p.borderStrong : p.border, lineWidth: 1))
        .onHover { hovering = $0 }
        .motion(focused || hovering, Motion.quick)
        .accessibilityLabel("Find a setting")
    }
}

/// The round close button at the dialog's corner.
private struct CloseButton: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon("x", size: 18)
                .foregroundStyle(hovering ? p.foreground : p.textSecondary)
                .frame(width: 40, height: 40)
                .background(p.surfaceMuted, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .help("Close settings")
        .accessibilityLabel("Close settings")
    }
}

/// One Keychain-backed key field, masked until it is being edited.
struct KeyField: View {
    @Environment(\.palette) private var p
    let item: Keychain.Item
    /// Says what the key is above the field; off where a header already does.
    var showsLabel = true
    var onChange: () -> Void = {}
    @State private var value = ""
    @State private var editing = false
    @State private var stored = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsLabel {
                Text(item.label).font(FN.font(13)).foregroundStyle(p.textSecondary)
            }
            HStack(spacing: 8) {
                Group {
                    if editing {
                        SecureField("Paste your key", text: $value)
                            .textFieldStyle(.plain)
                            .focused($focused)
                            .onSubmit(commit)
                    } else {
                        Text(stored.isEmpty ? "Not set" : Keychain.mask(stored))
                            .foregroundStyle(stored.isEmpty ? p.textMuted : p.foreground)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                // The kit's `.field`, with the key in monospace.
                .font(.system(size: 12, design: .monospaced))
                .padding(.horizontal, 14)
                .frame(height: 36)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
                    .strokeBorder(focused ? p.borderStrong : p.border, lineWidth: 1))

                if editing {
                    KitButton(kind: .plain, title: "Cancel", small: true) { editing = false; value = "" }
                    SecondaryButton(title: "Save", small: true, action: commit)
                } else {
                    KitButton(kind: .plain, title: stored.isEmpty ? "Add" : "Replace", small: true) {
                        editing = true
                        value = ""
                        focused = true
                    }
                    if !stored.isEmpty {
                        KitButton(kind: .danger, title: "Remove", small: true) {
                            Keychain.write(item, nil)
                            refresh()
                            onChange()
                        }
                    }
                }
            }
        }
        .onAppear(perform: refresh)
    }

    private func refresh() { stored = Keychain.read(item) ?? "" }

    private func commit() {
        Keychain.write(item, value)
        value = ""
        editing = false
        refresh()
        onChange()
    }
}

/// A section in the settings list: the kit's nav row.
private struct SettingsNavRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let icon: String
    let title: String
    let selected: Bool
    var trailing: String?
    var badge = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Icon(icon, size: 16)
                    .foregroundStyle(selected ? p.accent : (hovering ? p.foreground : p.textSecondary))
                Text(title)
                    .font(FN.font(14, selected ? .medium : .regular))
                    .foregroundStyle(selected || hovering ? p.foreground : p.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if badge { Circle().fill(p.danger).frame(width: 7, height: 7) }
                if let trailing {
                    Text(trailing).font(FN.small).foregroundStyle(p.textMuted)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(selected ? p.accentSubtle : (hovering ? p.hover : .clear),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .motion(selected, Motion.quick)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
