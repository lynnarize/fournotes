import AppKit
import SwiftUI
import UserNotifications

// First-run setup, over the whole window, as on the web (src/components/Onboarding.tsx):
// a welcome that shows what the app does, then asks only what it needs: how the day
// reads, the edge dock, how it looks, the assistant, a backup, the currency. It ends on
// a small celebration. Skippable at every step. Each step blurs into the next.

struct OnboardingView: View {
    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var toasts: ToastCenter
    @EnvironmentObject private var engine: AIEngine
    @EnvironmentObject private var nav: Navigation
    @ObservedObject private var dock = EdgeDock.shared
    @ObservedObject private var sync = AppModel.shared.sync

    @AppStorage("fournotes.theme") private var themeRaw = ThemeChoice.system.rawValue

    @State private var step = 0
    /// Which way the last move went, so the steps slide the right way.
    @State private var forward = true
    @State private var keyDraft = ""
    @State private var remindersOn = false
    @State private var remindersBlocked = false

    /// `step` opens it part of the way through, to look at a page.
    init(step: Int = 0) {
        _step = State(initialValue: step)
    }

    /// The steps, in order. The celebration comes after the last.
    private enum Page: CaseIterable {
        case welcome, oneView, brief, nothingSlips, edgeDock, look, assistant, backup, money
    }

    /// The numbered stepper groups the steps into the stages people recognise.
    private static let stages: [(label: String, pages: [Page])] = [
        ("Welcome", [.welcome, .oneView, .brief, .nothingSlips, .edgeDock]),
        ("Look", [.look]),
        ("Assistant", [.assistant]),
        ("Backup", [.backup]),
        ("Money", [.money]),
    ]

    /// Backup only where this build can sync.
    private var pages: [Page] { Page.allCases.filter { $0 != .backup || sync.isAvailable } }
    private var page: Page? { pages.indices.contains(step) ? pages[step] : nil }
    private var celebrating: Bool { step == pages.count }
    private var stages: [(label: String, pages: [Page])] { Self.stages.filter { $0.pages.contains(where: pages.contains) } }
    private var stage: Int { page.flatMap { page in stages.firstIndex { $0.pages.contains(page) } } ?? stages.count }
    private var theme: ThemeChoice { ThemeChoice(rawValue: themeRaw) ?? .system }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                content
                    .id(step)
                    .transition(.asymmetric(
                        insertion: .modifier(active: BlurStep(amount: 1, shift: forward ? 18 : -18),
                                             identity: BlurStep(amount: 0, shift: 0)),
                        removal: .modifier(active: BlurStep(amount: 1, shift: forward ? -18 : 18),
                                           identity: BlurStep(amount: 0, shift: 0))))
                    .frame(maxWidth: 1280)
                    .padding(.horizontal, 40)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity)
                    .containerRelativeFrame(.vertical, alignment: .center) { height, _ in height }
            }
            .scrollBounceBehavior(.basedOnSize)
            if page != .welcome { footer }
        }
        .background(p.background)
        .environment(\.onboarding, OnboardingStyle(scheme: scheme, theme: theme))
        .animation(Motion.reduce ? Motion.instant : .spring(response: 0.55, dampingFraction: 0.9), value: step)
        .task { await refreshReminders() }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: 12) {
            Logo(size: 34)
            Text("Four Notes").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !celebrating {
                KitButton(kind: .plain, title: page == .assistant ? "Not now" : "Skip setup") {
                    page == .assistant ? go(1) : finish(message: "You can set this up any time in Settings.")
                }
                .help(page == .assistant ? "Set up the assistant later in Settings" : "")
            }
        }
        .padding(.horizontal, 40)
        .padding(.top, 20)
        .padding(.bottom, 8)
    }

    private var footer: some View {
        HStack(spacing: 12) {
            HStack {
                if celebrating {
                    remindersButton
                } else {
                    KitButton(kind: .plain, title: "Back", icon: "chevronLeft") { go(-1) }
                        // ⌘[ as in a browser: ⌘← belongs to text fields (line start).
                        .keyboardShortcut("[", modifiers: .command)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)
            if !celebrating { Stepper(stages: stages.map(\.label), current: stage) }
            HStack {
                Spacer(minLength: 0)
                // `.btn-primary .btn-lg`, with the Return key's mark.
                Button(action: primary) {
                    HStack(spacing: 8) {
                        Text(primaryTitle)
                        Text("↵").font(FN.small).opacity(0.6)
                    }
                    .font(FN.font(15, .medium))
                    .foregroundStyle(p.accentForeground)
                    .padding(.horizontal, 20)
                    .frame(height: 44)
                    .background(p.accent, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.fn)
                .keyboardShortcut(.defaultAction)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 40)
        .padding(.top, 16)
        .padding(.bottom, 16)
        .overlay(alignment: .top) { Rectangle().fill(p.borderSubtle).frame(height: 1) }
    }

    private var primaryTitle: String {
        switch page {
        case .welcome: return "Get started"
        case .look: return "Looks good"
        case .assistant: return keyDraft.trimmingCharacters(in: .whitespaces).isEmpty ? "Continue" : "Save and continue"
        case .money: return "I'm ready"
        case nil: return "Open Four Notes"
        default: return "Continue"
        }
    }

    private func primary() {
        if page == .assistant, !keyDraft.trimmingCharacters(in: .whitespaces).isEmpty {
            Keychain.write(.anthropicKey, keyDraft.trimmingCharacters(in: .whitespaces))
            engine.refresh()
            toasts.push("🔑 Key saved. The assistant is ready.")
        }
        if celebrating { finish() } else { go(1) }
    }

    private func go(_ delta: Int) {
        forward = delta > 0
        step = min(pages.count, max(0, step + delta))
    }

    private func finish(message: String? = nil) {
        // Persist completion even when setup was skipped without changing any
        // setting; otherwise the empty install is treated as a new install on
        // every launch and the wizard reopens.
        store.flush()
        store.needsOnboarding = false
        withAnimation(Motion.screen) { nav.sheet = nil }
        if let message { toasts.push(message) }
    }

    /// "Explore with sample data": fill the app with examples and look around now.
    private func explore() {
        if !store.hasSamples { store.loadSamples() }
        finish(message: "Sample data loaded. Remove it any time from the banner at the top or in Settings.")
    }

    // MARK: - Steps

    @ViewBuilder
    private var content: some View {
        switch page {
        case .welcome: welcome
        case .oneView:
            Centered(title: "Your day, on one calm page",
                     lead: "What's due, what you spent and what you jotted down, sorted by what needs you now.") {
                TodayMock()
            }
        case .brief:
            Centered(title: "How should your day read?",
                     lead: "A few sentences with the details a click away, or everything point by point. Change it any time in Settings.") {
                BriefTiles()
            }
        case .nothingSlips:
            SideBySide(pictureFirst: true) {
                Title("Nothing slips\nthrough")
                Lead("Say “remind me to pay rent Friday” and Four Notes reminds you on Friday. A receipt photo becomes spending; a voice memo becomes a note with its to-dos.")
            } picture: {
                RemindMock()
            }
        case .edgeDock: edgeDockPage
        case .look:
            Centered(title: "Make it yours",
                     lead: "Follow your Mac, or pick a look and keep it. Change it any time in Settings.") {
                VStack(spacing: 24) {
                    ThemeCards()
                        .frame(maxWidth: 640)
                    VStack(spacing: 8) {
                        Text("Accent, for what's selected or active").font(FN.font(13)).foregroundStyle(p.textSecondary)
                        AccentSwatches()
                    }
                }
            }
        case .assistant: assistant
        case .backup: backup
        case .money: money
        case nil: celebration
        }
    }

    private var welcome: some View {
        HStack(alignment: .center, spacing: 48) {
            VStack(alignment: .leading, spacing: 28) {
                DisplayLines("Four notebooks.\nOne calm place.", size: 64)
                Text("Notes, to-dos, spending and an assistant that files things for you, together in one fast app.")
                    .font(FN.font(18))
                    .lineSpacing(7)
                    .foregroundStyle(p.textSecondary)
                    .frame(maxWidth: 460, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    Button(action: primary) {
                        HStack(spacing: 8) {
                            Text("Get started")
                            Icon("arrowRight", size: 18)
                        }
                        .font(FN.font(16, .medium))
                        .foregroundStyle(p.accentForeground)
                        .padding(.horizontal, 24)
                        .frame(height: 50)
                        .background(p.accent, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.fn)
                    .keyboardShortcut(.defaultAction)
                    Button(action: explore) {
                        Text("Explore with sample data")
                            .font(FN.font(16))
                            .foregroundStyle(p.foreground)
                            .padding(.horizontal, 22)
                            .frame(height: 50)
                            .background(p.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(p.borderStrong, lineWidth: 1))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.fn)
                }
                Text("About a minute. Every step can be skipped and changed later in Settings.")
                    .font(FN.font(13))
                    .foregroundStyle(p.textMuted)
                Stepper(stages: stages.map(\.label), current: 0)
                    .padding(.top, 12)
            }
            .frame(minWidth: 420, maxWidth: .infinity, alignment: .leading)
            WelcomePicture()
                .frame(minWidth: 480, maxWidth: .infinity)
        }
    }

    private var edgeDockPage: some View {
        SideBySide {
            Title("Always at the\nedge of your screen")
            Lead("A small handle waits on the side of whatever you're working in. Click it for a quick note, today's tasks, dictation, a spend or a question, then get back to what you were doing.")
            HStack(spacing: 6) {
                KeyCap("⇧"); KeyCap("⌘"); KeyCap(".")
                Text("opens it from Four Notes").font(FN.font(13)).foregroundStyle(p.textSecondary)
            }
            HStack(spacing: 12) {
                Text("Show the edge dock").font(FN.body).foregroundStyle(p.foreground)
                Toggle("Show the edge dock", isOn: Binding(get: { dock.isEnabled },
                                                           set: { if $0 != dock.isEnabled { dock.setEnabled($0) } }))
                    .toggleStyle(.fnSwitch)
            }
        } picture: {
            EdgeDockDemo(style: DockStyle.style(for: theme, scheme: scheme))
                .frame(width: 440, height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(p.border, lineWidth: 1))
        }
    }

    private var assistant: some View {
        Centered(title: "Meet your assistant",
                 lead: OnDevice.languageModelAvailable
                    ? "It already works on this Mac with Apple Intelligence, offline and free. A key makes it sharper."
                    : "Scanning and voice notes already work on this Mac. Chat needs a model: add a key, or set one up later.") {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    if OnDevice.languageModelAvailable {
                        HStack(spacing: 6) {
                            Icon("check", size: 14)
                            Text("Apple Intelligence is ready on this Mac")
                        }
                        .font(FN.font(13, .medium))
                        .foregroundStyle(p.success)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(p.successSubtle, in: Capsule())
                    }
                    // `.field .field-lg`
                    SecureField("", text: $keyDraft, prompt: Text("Anthropic key (optional), sk-ant-…").foregroundStyle(p.textMuted))
                        .textFieldStyle(.plain)
                        .font(FN.body)
                        .foregroundStyle(p.foreground)
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                        .background(p.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))
                        .onSubmit(primary)
                    Text("Prefer OpenRouter, OpenAI or a model on this Mac? Add it in \(Text("Settings, AI and keys").font(FN.font(13, .medium)).foregroundStyle(p.foreground)).")
                        .font(FN.font(13))
                        .foregroundStyle(p.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    ExternalLink(title: "Get an Anthropic key", address: "https://console.anthropic.com/settings/keys")
                        .frame(minHeight: 44)
                }
                .frame(maxWidth: 380)
                HStack(spacing: 24) {
                    Trust(icon: "key", text: "Keys stay in your Keychain")
                    Trust(icon: "monitor", text: "On this Mac when it can be")
                    Trust(icon: "trash", text: "Delete any time")
                }
            }
        }
    }

    private var backup: some View {
        Centered(title: "Keep a copy safe",
                 lead: "Everything is saved on this Mac. Back it up to your own Google Drive and it stays in step with the web app.") {
            VStack(alignment: .leading, spacing: 12) {
                if let account = sync.account {
                    HStack(spacing: 10) {
                        GoogleG()
                        Text(account.email ?? "Google Drive").font(FN.bodyMedium).foregroundStyle(p.foreground).lineLimit(1)
                        StatusPill(text: sync.status == .syncing ? "Syncing…" : sync.status == .error ? "Sync error" : "Synced",
                                   tone: sync.status == .error ? .bad : sync.status == .syncing ? .muted : .good)
                    }
                    Text("Syncing to a private app folder in your Google Drive. Changes sync automatically a few seconds after you edit.")
                        .font(FN.font(13)).lineSpacing(5).foregroundStyle(p.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sync with your Google account").font(FN.bodyMedium).foregroundStyle(p.foreground)
                        Text("Keep notes, tasks and spending in step with the web app. Everything is saved in a private app folder in your own Google Drive that only Four Notes can open.")
                            .font(FN.font(13)).lineSpacing(5).foregroundStyle(p.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    GoogleButton(label: sync.connecting ? "Waiting for Google…" : "Continue with Google",
                                 disabled: sync.connecting) {
                        Task { await sync.connect() }
                    }
                    if let message = sync.message {
                        Text(message).font(FN.font(13)).foregroundStyle(p.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 480, alignment: .leading)
            .background(p.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(p.border, lineWidth: 1))
        }
    }

    private var money: some View {
        SideBySide {
            Title("Bring your\nmoney in")
            Lead("Pick the currency you count in. Budgets and categories can wait.")
            HStack(spacing: 12) {
                Text("Currency").font(FN.body).foregroundStyle(p.textSecondary)
                SelectMenu(options: CURRENCIES.map { ($0, $0) },
                           selection: Binding(
                    get: { store.settings.currency },
                    set: { c in store.updateSettings { $0.currency = c } }))
                    .fixedSize()
            }
            if store.hasSamples {
                Text("Sample data is loaded. Remove it any time in Settings.")
                    .font(FN.font(13)).foregroundStyle(p.textMuted)
            } else {
                Button {
                    store.loadSamples()
                    toasts.push("Sample data loaded. Remove it any time in Settings, Data and privacy.")
                } label: {
                    Text("Load a few samples to look around first")
                        .font(FN.font(13))
                        .foregroundStyle(p.foreground)
                        .underline(color: p.borderStrong)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.fn)
            }
        } picture: {
            FeatureOrbit()
        }
    }

    private var celebration: some View {
        VStack(spacing: 36) {
            CelebrationRow()
            Text("Your notebook is ready. The edge dock waits on the side of your screen; ⇧⌘. opens it.")
                .font(FN.body)
                .foregroundStyle(p.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Reminders

    private var remindersButton: some View {
        SecondaryButton(title: remindersOn ? "Reminders on" : remindersBlocked ? "Reminders blocked in System Settings" : "Turn on reminders",
                        icon: remindersOn ? "check" : "bell") {
            Task { await turnOnReminders() }
        }
        .disabled(remindersOn)
        .animation(Motion.standard, value: remindersOn)
    }

    private func refreshReminders() async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        remindersOn = status == .authorized || status == .provisional
        remindersBlocked = status == .denied
    }

    private func turnOnReminders() async {
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        if status == .denied {
            // Asked before and refused: only System Settings can change it now.
            if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
                NSWorkspace.shared.open(url)
            }
            return
        }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        await refreshReminders()
    }
}

// MARK: - Layout pieces

/// The stages, numbered: done ones ticked on the accent wash, the current one in the accent.
private struct Stepper: View {
    @Environment(\.palette) private var p
    let stages: [String]
    let current: Int

    var body: some View {
        HStack(spacing: 20) {
            ForEach(Array(stages.enumerated()), id: \.offset) { i, label in
                let done = i < current
                let now = i == current
                HStack(spacing: 8) {
                    ZStack {
                        if now {
                            Circle().fill(p.accent)
                        } else if done {
                            Circle().fill(p.accentSubtle)
                        } else {
                            Circle().strokeBorder(p.borderStrong, lineWidth: 1)
                        }
                        if done {
                            Icon("check", size: 12).foregroundStyle(p.foreground)
                        } else {
                            Text("\(i + 1)").font(FN.small).monospacedDigit()
                                .foregroundStyle(now ? p.accentForeground : p.textMuted)
                        }
                    }
                    .frame(width: 22, height: 22)
                    Text(label)
                        .font(FN.font(13, now ? .medium : .regular))
                        .foregroundStyle(now ? p.foreground : p.textMuted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(now ? "Current step" : done ? "Done" : "")
            }
        }
        .fixedSize()
        .animation(Motion.standard, value: current)
    }
}

private struct Title: View {
    @Environment(\.palette) private var p
    let text: String
    var centered = false
    init(_ text: String, centered: Bool = false) {
        self.text = text
        self.centered = centered
    }

    var body: some View {
        DisplayLines(text, size: 44, centered: centered)
    }
}

/// Display type on the web's tight line (1.1): each line its own row, as a line height
/// under the font's own can't be set.
private struct DisplayLines: View {
    @Environment(\.palette) private var p
    let lines: [String]
    let size: CGFloat
    var centered = false

    init(_ text: String, size: CGFloat, centered: Bool = false) {
        lines = text.components(separatedBy: "\n")
        self.size = size
        self.centered = centered
    }

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(FN.display(size))
                    .tracking(FN.displayTracking(size))
                    .foregroundStyle(p.foreground)
                    .multilineTextAlignment(centered ? .center : .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(1)
                    .frame(height: (size * 1.1).rounded())
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct Lead: View {
    @Environment(\.palette) private var p
    let text: String
    var width: CGFloat = 420
    var centered = false
    init(_ text: String, width: CGFloat = 420, centered: Bool = false) {
        self.text = text
        self.width = width
        self.centered = centered
    }

    var body: some View {
        Text(text)
            .font(FN.font(18))
            .lineSpacing(7)
            .foregroundStyle(p.textSecondary)
            .multilineTextAlignment(centered ? .center : .leading)
            .frame(maxWidth: width, alignment: centered ? .center : .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Words on one side, a picture on the other.
private struct SideBySide<Words: View, Picture: View>: View {
    var pictureFirst = false
    @ViewBuilder var words: () -> Words
    @ViewBuilder var picture: () -> Picture

    var body: some View {
        HStack(alignment: .center, spacing: 48) {
            if pictureFirst { pictureView }
            VStack(alignment: .leading, spacing: 20) { words() }
                .frame(maxWidth: .infinity, alignment: .leading)
            if !pictureFirst { pictureView }
        }
        .frame(maxWidth: 1000)
    }

    private var pictureView: some View {
        picture().frame(maxWidth: .infinity)
    }
}

private struct Centered<Content: View>: View {
    let title: String
    let lead: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Title(title, centered: true)
            Lead(lead, width: 560, centered: true)
                .padding(.top, 16)
            content()
                .frame(maxWidth: .infinity)
                .padding(.top, 32)
        }
        .frame(maxWidth: 1000)
    }
}

/// Steps arrive out of a soft blur and leave into one.
private struct BlurStep: ViewModifier {
    let amount: Double
    let shift: CGFloat

    func body(content: Content) -> some View {
        content
            .blur(radius: 14 * amount)
            .opacity(1 - amount)
            .offset(x: shift * amount)
    }
}

/// Comes in once, a beat after the one before it.
private struct Arrive: ViewModifier {
    let delay: Double
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .blur(radius: shown ? 0 : 6)
            .offset(y: shown ? 0 : 10)
            .onAppear {
                guard !shown else { return }
                if reduceMotion { shown = true; return }
                withAnimation(.spring(response: 0.6, dampingFraction: 0.85).delay(delay)) { shown = true }
            }
    }
}

extension View {
    fileprivate func arrive(_ delay: Double) -> some View { modifier(Arrive(delay: delay)) }
}

/// A card resting on its border, the building block of every picture.
private struct PictureCard<Content: View>: View {
    @Environment(\.palette) private var p
    var radius: CGFloat = 22
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .background(p.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }
}

/// The app's mark on a rounded tile.
private struct MarkTile: View {
    @Environment(\.palette) private var p
    var size: CGFloat = 56

    var body: some View {
        Logo(size: (size * 0.62).rounded())
            .frame(width: size, height: size)
            .background(p.surface, in: RoundedRectangle(cornerRadius: (size * 0.3).rounded(), style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: (size * 0.3).rounded(), style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }
}

/// An item's kind, as a quiet tile.
private struct Glyph: View {
    @Environment(\.palette) private var p
    let icon: String
    var size: CGFloat = 40
    var accent = false

    var body: some View {
        Icon(icon, size: (size * 0.5).rounded())
            .foregroundStyle(accent ? p.accent : p.textSecondary)
            .frame(width: size, height: size)
            .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: (size * 0.35).rounded(), style: .continuous))
            .accessibilityHidden(true)
    }
}

private struct Trust: View {
    @Environment(\.palette) private var p
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Icon(icon, size: 14).foregroundStyle(p.textMuted)
            Text(text).font(FN.font(13)).foregroundStyle(p.textSecondary)
        }
    }
}

// MARK: - Pictures

/// One message in, and the things the assistant filed from it, on a very soft wash.
private struct WelcomePicture: View {
    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @AppStorage("fournotes.theme") private var themeRaw = ThemeChoice.system.rawValue

    private var wash: [Color] {
        if scheme == .dark { return [.hex(0x211D27), .hex(0x271F17)] }
        if themeRaw == ThemeChoice.paper.rawValue { return [.hex(0xFDEDE0), .hex(0xF6F4E5)] }
        return [.hex(0xF6F2FF), .hex(0xFFF5E8)]
    }

    var body: some View {
        let rows: [(icon: String, title: String, detail: String, trailing: String, faded: Bool)] = [
            ("finance", "Kopi Kenangan", "Finance, food and drink", Money.format(25_000, "IDR"), false),
            ("todo", "Pay the electricity bill", "To-Do, reminder set", "Tomorrow, 9:00", false),
            ("note", "Singapore trip", "Notes, flights on the 12th, hotel near Bugis", "Yesterday", true),
        ]
        VStack(alignment: .leading, spacing: 14) {
            Text("Kopi Kenangan 25k, and pay the electricity bill tomorrow at 9")
                .font(FN.font(15))
                .lineSpacing(3)
                .foregroundStyle(p.accentForeground)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(p.accent, in: UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22,
                                                                 bottomTrailingRadius: 6, topTrailingRadius: 22,
                                                                 style: .continuous))
                .frame(maxWidth: 380, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
                .arrive(0.1)
            HStack(spacing: 8) {
                Icon("sparkle", size: 16).foregroundStyle(p.accent)
                Text("Filed 2 things")
            }
            .font(FN.font(13))
            .foregroundStyle(p.textSecondary)
            .padding(.horizontal, 4)
            .padding(.top, 4)
            .arrive(0.35)
            ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                PictureCard {
                    HStack(spacing: 14) {
                        Glyph(icon: row.icon)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title).font(FN.bodyMedium).foregroundStyle(p.foreground)
                            Text(row.detail).font(FN.font(13)).foregroundStyle(p.textMuted).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(row.trailing)
                            .font(i == 0 ? FN.bodyMedium : FN.font(13))
                            .monospacedDigit()
                            .foregroundStyle(i == 0 ? p.foreground : i == 1 ? p.textSecondary : p.textMuted)
                    }
                    .padding(16)
                }
                .opacity(row.faded ? 0.72 : 1)
                .arrive(0.45 + Double(i) * 0.12)
            }
        }
        .padding(40)
        .background(LinearGradient(colors: wash, startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: FN.radiusSurface, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("How the assistant files things")
    }
}

/// A small Today page: the sidebar, what's due, and the assistant's note.
private struct TodayMock: View {
    @Environment(\.palette) private var p

    private func line(_ icon: String, _ title: String, _ detail: String, _ tag: String, accent: Bool = false) -> some View {
        HStack(spacing: 8) {
            Glyph(icon: icon, size: 22)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(FN.font(11, .medium)).foregroundStyle(p.foreground)
                Text(detail).font(FN.font(10)).foregroundStyle(p.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(tag).font(FN.font(10, accent ? .medium : .regular)).monospacedDigit()
                .foregroundStyle(accent ? p.accent : p.textMuted)
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            PictureCard {
                HStack(spacing: 0) {
                    VStack(spacing: 14) {
                        Logo(size: 16)
                        ForEach(["today", "note", "todo", "finance"], id: \.self) { icon in
                            Icon(icon, size: 13).foregroundStyle(icon == "today" ? p.accent : p.textMuted)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 12)
                    .frame(width: 42)
                    .frame(maxHeight: .infinity)
                    .background(p.sidebar)
                    .overlay(alignment: .trailing) { Rectangle().fill(p.border).frame(width: 1) }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Today").font(FN.font(13, .medium)).foregroundStyle(p.foreground)
                            Spacer()
                            Icon("search", size: 11).foregroundStyle(p.textMuted)
                        }
                        Text("Due today \(Text("2").font(FN.font(10.5)).foregroundStyle(p.textMuted))")
                            .font(FN.font(10.5, .medium)).foregroundStyle(p.foreground)
                            .padding(.top, 2)
                        line("todo", "Pay the electricity bill", "9:00, Bills", "Due", accent: true)
                        line("todo", "Send the Q3 deck to Maya", "Before 5 PM", "2h")
                        Text("Spent yesterday").font(FN.font(10.5, .medium)).foregroundStyle(p.foreground)
                            .padding(.top, 2)
                        line("coffee", "Kopi Kenangan", "Food and drink", Money.format(25_000, "IDR"))
                        line("cart", "Indomaret", "Groceries", Money.format(128_500, "IDR"))
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                }
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
            .frame(width: 440, height: 250)
            .arrive(0.05)

            PictureCard {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        MarkTile(size: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("Assistant").font(FN.font(12.5, .medium)).foregroundStyle(p.foreground)
                            Text("One message, three things").font(FN.font(10.5)).foregroundStyle(p.textMuted)
                        }
                    }
                    ForEach(["A task for Friday", "Rp 45,000 at Warteg", "A note: “gift ideas”"], id: \.self) { item in
                        HStack(spacing: 6) {
                            Icon("check", size: 10).foregroundStyle(p.success)
                            Text(item).font(FN.font(11.5)).foregroundStyle(p.foreground)
                        }
                    }
                }
                .padding(12)
                .frame(width: 200, alignment: .leading)
            }
            .offset(x: 540 - 200, y: 270 - 128)
            .arrive(0.3)
        }
        .frame(width: 540, height: 270, alignment: .topLeading)
    }
}

/// "Remind me…" and the task it becomes, typed out as it happens.
private struct RemindMock: View {
    @Environment(\.palette) private var p
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let message = "Remind me to pay rent on Friday"
    @State private var typed = 0
    @State private var filed = false

    var body: some View {
        PictureCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    MarkTile(size: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Four Notes").font(FN.font(13, .medium)).foregroundStyle(p.foreground)
                        Text("Assistant").font(FN.font(11)).foregroundStyle(p.textMuted)
                    }
                }
                Rectangle().fill(p.borderSubtle).frame(height: 1)
                Text(String(message.prefix(typed)) + (typed < message.count ? "▍" : ""))
                    .font(FN.font(13))
                    .foregroundStyle(p.accentForeground)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(p.accent, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18,
                                                                     bottomTrailingRadius: 6, topTrailingRadius: 18,
                                                                     style: .continuous))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.leading, 40)
                if filed {
                    HStack(spacing: 10) {
                        Glyph(icon: "bell", size: 30, accent: true)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("Pay rent").font(FN.font(13, .medium)).foregroundStyle(p.foreground)
                            Text("Friday, 9:00. I'll remind you").font(FN.font(11.5)).foregroundStyle(p.textMuted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Icon("check", size: 13).foregroundStyle(p.success)
                    }
                    .padding(10)
                    .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .transition(.opacity.combined(with: .offset(y: 8)))
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(width: 360, height: 230, alignment: .topLeading)
        }
        .arrive(0.05)
        .task {
            if reduceMotion { typed = message.count; filed = true; return }
            try? await Task.sleep(for: .milliseconds(450))
            while typed < message.count, !Task.isCancelled {
                typed += 1
                try? await Task.sleep(for: .milliseconds(34))
            }
            try? await Task.sleep(for: .milliseconds(350))
            withAnimation(Motion.standard) { filed = true }
        }
    }
}

/// Each way the brief can read, shown as a small live Today; a link or row lights up in turn.
private struct BriefTiles: View {
    @Environment(\.palette) private var p
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(BriefStyle.storageKey) private var briefStyleRaw = BriefStyle.paragraph.rawValue
    @State private var beat = 0

    var body: some View {
        HStack(alignment: .top, spacing: 40) {
            tile(.paragraph).arrive(0.08)
            tile(.points).arrive(0.18)
        }
        .task {
            guard !reduceMotion else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(1100))
                withAnimation(Motion.standard) { beat += 1 }
            }
        }
    }

    private func tile(_ style: BriefStyle) -> some View {
        let selected = briefStyleRaw == style.rawValue
        return Button { withAnimation(Motion.standard) { briefStyleRaw = style.rawValue } } label: {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Good morning.").font(FN.font(17, .medium)).foregroundStyle(p.foreground)
                    if style == .paragraph { paragraph.padding(.top, 8) } else { points.padding(.top, 10) }
                    Spacer(minLength: 0)
                }
                .padding(16)
                .frame(width: 280, height: 164, alignment: .topLeading)
                .background(p.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(selected ? p.accent : p.border, lineWidth: 1))
                .background(RoundedRectangle(cornerRadius: 25, style: .continuous)
                    .fill(selected ? p.accentSubtle : .clear).padding(-3))
                HStack(spacing: 6) {
                    Icon(style.icon, size: 15)
                    Text(style.label)
                    if style == .paragraph {
                        Text("Compact")
                            .font(FN.font(11, .medium))
                            .foregroundStyle(p.accent)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(p.accentSubtle, in: Capsule())
                    }
                    Spacer(minLength: 0)
                    Circle()
                        .strokeBorder(selected ? p.accent : p.borderStrong, lineWidth: 1.5)
                        .overlay { if selected { Circle().fill(p.accent).frame(width: 8, height: 8) } }
                        .frame(width: 18, height: 18)
                }
                .font(FN.font(14, selected ? .medium : .regular))
                .foregroundStyle(selected ? p.foreground : p.textSecondary)
                .padding(.top, 12)
                Text(style.detail)
                    .font(FN.font(13))
                    .foregroundStyle(p.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            .frame(width: 280, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var paragraph: some View {
        let parts: [(String, Bool)] = [("You have ", false), ("3 things due", true), (" today, starting with ", false),
                                       ("Call Budi", true), (" at 2:30 PM. Yesterday you spent ", false),
                                       ("Rp 120rb", true), (", mostly on food.", false)]
        var out = AttributedString()
        var link = 0
        for (text, isLink) in parts {
            var run = AttributedString(text)
            if isLink {
                let lit = link == beat % 3
                run.foregroundColor = lit ? p.accent : p.foreground
                run.underlineStyle = Text.LineStyle(pattern: .solid, color: lit ? p.accent : p.borderStrong)
                link += 1
            }
            out += run
        }
        return Text(out)
            .font(FN.font(12.5))
            .lineSpacing(6.5)
            .foregroundStyle(p.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var points: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array([("✳︎", 150.0), ("○", 120.0), ("○", 170.0), ("⚠︎", 110.0)].enumerated()), id: \.offset) { i, row in
                let lit = beat % 4 == i
                HStack(spacing: 9) {
                    Text(row.0).font(FN.font(10)).foregroundStyle(lit ? p.accent : p.textMuted).frame(width: 12)
                    Capsule().fill(lit ? p.accent : p.controlTrack).frame(width: row.1, height: 5)
                }
                .offset(x: lit ? 3 : 0)
            }
        }
    }
}

/// Everything the app does, around its mark.
private struct FeatureOrbit: View {
    @Environment(\.palette) private var p
    private let items = [("note", "Notes"), ("todo", "To-Do"), ("finance", "Finance"), ("scan", "Scan"), ("mic", "Voice"), ("search", "Search")]
    private let r: CGFloat = 124

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(p.borderStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .frame(width: r * 2, height: r * 2)
            MarkTile(size: 70).arrive(0.05)
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                let a = -Double.pi / 2 + Double(i) * 2 * .pi / Double(items.count)
                VStack(spacing: 5) {
                    Icon(item.0, size: 17)
                        .foregroundStyle(p.textSecondary)
                        .frame(width: 42, height: 42)
                        .background(p.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                    Text(item.1).font(FN.font(11)).foregroundStyle(p.textMuted)
                }
                .offset(x: cos(a) * r, y: sin(a) * r + 8)
                .arrive(0.12 + Double(i) * 0.07)
            }
        }
        .frame(width: 320, height: 320)
    }
}

/// The last page: what you just set up, in a row, with the mark raised.
private struct CelebrationRow: View {
    @Environment(\.palette) private var p
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var raised = false

    private func tile(_ icon: String) -> some View {
        Icon(icon, size: 20)
            .foregroundStyle(p.textSecondary)
            .frame(width: 50, height: 50)
            .background(p.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    var body: some View {
        VStack(spacing: 14) {
            Text("I've just set up my Four Notes 🎉")
                .font(FN.display(32))
                .tracking(FN.displayTracking(32))
                .foregroundStyle(p.foreground)
                .padding(.horizontal, 22)
                .frame(minHeight: 50)
                .background(p.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))
                .arrive(0.35)
            HStack(spacing: 12) {
                ForEach(["note", "todo", "today"], id: \.self) { tile($0) }
                MarkTile(size: 74)
                    .scaleEffect(raised ? 1 : 0.73)
                    .offset(y: raised ? -14 : 0)
                ForEach(["finance", "mic", "scan"], id: \.self) { tile($0) }
            }
            .padding(.horizontal, 14)
            .frame(height: 76)
            .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
            .arrive(0.05)
        }
        .onAppear {
            if reduceMotion { raised = true; return }
            withAnimation(.spring(response: 0.7, dampingFraction: 0.6).delay(0.25)) { raised = true }
        }
    }
}

// MARK: - The edge dock's demo

/// Colours for the edge dock's demo, which draws a small screen of its own.

/// Colours for the setup: warm light over white, or the same light at night.
struct OnboardingStyle {
    let base, ink, muted, faint, card, cardEdge, field, fieldEdge: Color
    let peach, sky, accent, ok: Color
    let buttonFill, buttonText: Color
    let dark: Bool

    init(scheme: ColorScheme, theme: ThemeChoice) {
        dark = scheme == .dark
        if dark {
            base = .hex(0x141416); ink = .hex(0xEDEBE7); muted = .hex(0xA8A49C); faint = .hex(0x7D7A74)
            card = .hex(0x232326); cardEdge = .white.opacity(0.08)
            field = .hex(0x1C1C1F); fieldEdge = .white.opacity(0.1)
            peach = .hex(0x5A2E26); sky = .hex(0x1F3550)
            accent = .hex(0xE08A62); ok = .hex(0x5DBB8A)
            buttonFill = .hex(0xF2F0EC); buttonText = .hex(0x141416)
        } else {
            let paper = theme == .paper
            base = paper ? .hex(0xFBF6E8) : .hex(0xFCFBFA)
            ink = .hex(0x1F1D1A); muted = .hex(0x6B675F); faint = .hex(0x8E8A82)
            card = paper ? .hex(0xFFFCF3) : .white; cardEdge = .black.opacity(0.06)
            field = paper ? .hex(0xF4EDD9) : .hex(0xF3F2F0); fieldEdge = .black.opacity(0.05)
            peach = .hex(0xF6C7B6); sky = .hex(0xC9DDF3)
            accent = .hex(0xC0643C); ok = .hex(0x2F8A5B)
            buttonFill = .hex(0x1B1B1D); buttonText = .white
        }
    }
}

private struct OnboardingStyleKey: EnvironmentKey {
    static let defaultValue = OnboardingStyle(scheme: .light, theme: .light)
}

extension EnvironmentValues {
    fileprivate var onboarding: OnboardingStyle {
        get { self[OnboardingStyleKey.self] }
        set { self[OnboardingStyleKey.self] = newValue }
    }
}

/// A small screen with an app on it and the dock's handle on its edge. The
/// pointer goes to the handle, it grows into the drawer — the same shape
/// the real one uses — a note gets typed, a task ticked, dictation listens,
/// and it tucks itself away again. On a loop, unless motion is reduced.
private struct EdgeDockDemo: View {
    @Environment(\.onboarding) private var s
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let style: DockStyle

    @State private var size: CGSize = .zero
    @State private var open = false
    @State private var peek = false
    @State private var cursor = CGPoint(x: 150, y: 220)
    @State private var pressed = false
    @State private var typed = 0
    @State private var ticked = false
    @State private var listening = false

    private let note = "Call Budi about the trip"
    private let drawerSize = CGSize(width: 206, height: 238)

    var body: some View {
        ZStack(alignment: .topLeading) {
            // The screen, with someone's work on it.
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(s.field)
            appWindow
                .frame(width: 236, height: 196)
                .position(x: 150, y: size.height / 2 + 8)

            let shape = EdgeTabShape(geometry)
            shape.fill(style.materialSolid)
                .shadow(color: .black.opacity(open ? 0.3 : 0.18), radius: open ? 16 : 4, y: open ? 6 : 1)
            shape.stroke(style.hair, lineWidth: 1)

            ZStack(alignment: .topLeading) {
                handleFace
                    .frame(width: 17, height: 58)
                    .position(x: size.width - 8.5, y: size.height / 2)
                    .opacity(open ? 0 : 1)
                drawer
                    .frame(width: drawerSize.width, height: drawerSize.height)
                    .position(x: size.width - drawerSize.width / 2, y: size.height / 2)
                    .opacity(open ? 1 : 0)
            }
            .clipShape(shape)

            Image(systemName: "cursorarrow")
                .font(.system(size: 19))
                .foregroundStyle(s.dark ? .white : .black)
                .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
                .scaleEffect(pressed ? 0.82 : 1)
                .position(cursor)
                .opacity(reduceMotion ? 0 : 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(s.cardEdge, lineWidth: 1))
        .shadow(color: .black.opacity(s.dark ? 0.35 : 0.08), radius: 16, y: 6)
        .onGeometryChange(for: CGSize.self, of: { $0.size }) { size = $0 }
        .environment(\.dock, style)
        .task(id: size == .zero) {
            guard size != .zero else { return }
            await play()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("An animation of the edge dock opening from the side of the screen")
    }

    /// The shape as the real dock draws it: a slim handle, or the drawer.
    private var geometry: DockGeometry {
        DockGeometry(frame: .zero, centerFromTop: size.height / 2,
                     bodyWidth: open ? drawerSize.width : (peek ? 24 : 17),
                     bodyHeight: open ? drawerSize.height : 58,
                     corner: open ? 18 : 7, fillet: open ? 16 : 8)
    }

    private var appWindow: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                ForEach([Color.hex(0xFF5F57), .hex(0xFEBC2E), .hex(0x28C840)], id: \.self) { c in
                    Circle().fill(c).frame(width: 6, height: 6)
                }
            }
            .padding(8)
            VStack(alignment: .leading, spacing: 7) {
                Capsule().fill(s.ink.opacity(0.55)).frame(width: 90, height: 6)
                ForEach([150, 170, 128, 160, 100], id: \.self) { w in
                    Capsule().fill(s.faint.opacity(0.35)).frame(width: CGFloat(w), height: 4)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 6)
            Spacer()
        }
        .background(s.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(s.cardEdge, lineWidth: 1))
        .shadow(color: .black.opacity(s.dark ? 0.3 : 0.06), radius: 8, y: 3)
    }

    private var handleFace: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle().stroke(style.track, lineWidth: 1.8)
                Circle().trim(from: 0, to: 0.6).stroke(style.accent, style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("2").font(.system(size: 6.5, weight: .medium)).foregroundStyle(style.text)
            }
            .frame(width: 12, height: 12)
        }
    }

    private var drawer: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Wednesday").font(FN.font(11, .medium)).foregroundStyle(style.text)
                .padding(.leading, 2)

            miniCard("Quick note") {
                HStack(spacing: 0) {
                    Text(String(note.prefix(typed)))
                    Rectangle().fill(style.accent).frame(width: 1, height: 10)
                        .opacity(open && typed < note.count ? 1 : 0)
                    Spacer(minLength: 0)
                }
                .font(.system(size: 9.5))
                .foregroundStyle(style.text)
                .padding(.horizontal, 6)
                .frame(height: 20)
                .background(style.fill, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(style.hair, lineWidth: 0.5))
            }

            miniCard("Today") {
                HStack(spacing: 6) {
                    Circle()
                        .fill(ticked ? style.accent : .clear)
                        .overlay(Circle().strokeBorder(ticked ? .clear : style.hairStrong, lineWidth: 1))
                        .overlay(Image(systemName: "checkmark").font(.system(size: 5.5, weight: .bold))
                            .foregroundStyle(style.onAccent).opacity(ticked ? 1 : 0))
                        .frame(width: 10, height: 10)
                    Text("Pay the electricity bill")
                        .font(.system(size: 9.5))
                        .strikethrough(ticked, color: style.muted)
                        .foregroundStyle(ticked ? style.muted : style.text)
                }
            }

            miniCard("Transcribe") {
                HStack(spacing: 7) {
                    Circle().fill(listening ? style.danger : style.card)
                        .overlay(Circle().strokeBorder(listening ? .clear : style.hair, lineWidth: 0.5))
                        .frame(width: 16, height: 16)
                        .overlay(RoundedRectangle(cornerRadius: listening ? 1.5 : 3, style: .continuous)
                            .fill(listening ? .white : style.danger)
                            .frame(width: listening ? 5 : 6, height: listening ? 5 : 6))
                    LevelBars(active: listening, tint: style.danger, idle: style.hairStrong)
                        .frame(height: 16)
                }
            }
        }
        .padding(10)
    }

    private func miniCard<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(FN.font(9.5, .medium)).foregroundStyle(style.text)
            content()
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(style.card, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(style.hair, lineWidth: 1))
    }

    // MARK: The loop

    private func play() async {
        if reduceMotion {
            open = true; typed = note.count; ticked = true
            return
        }
        let rest = CGPoint(x: 150, y: size.height / 2 + 60)
        let handle = CGPoint(x: size.width - 10, y: size.height / 2 + 4)
        let noteSpot = CGPoint(x: size.width - 130, y: size.height / 2 - 52)
        let taskSpot = CGPoint(x: size.width - 188, y: size.height / 2 + 12)
        let micSpot = CGPoint(x: size.width - 182, y: size.height / 2 + 76)

        while !Task.isCancelled {
            open = false; peek = false; typed = 0; ticked = false; listening = false
            cursor = rest
            guard await pause(0.9) else { return }

            withAnimation(.easeInOut(duration: 1.0)) { cursor = handle }
            guard await pause(0.85) else { return }
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { peek = true }
            guard await pause(0.45) else { return }
            await click()
            withAnimation(.spring(response: 0.5, dampingFraction: 0.84)) { open = true }
            guard await pause(0.55) else { return }

            withAnimation(.easeInOut(duration: 0.7)) { cursor = noteSpot }
            guard await pause(0.75) else { return }
            await click()
            for i in 1...note.count {
                typed = i
                guard await pause(0.045) else { return }
            }
            guard await pause(0.35) else { return }

            withAnimation(.easeInOut(duration: 0.6)) { cursor = taskSpot }
            guard await pause(0.65) else { return }
            await click()
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { ticked = true }
            guard await pause(0.5) else { return }

            withAnimation(.easeInOut(duration: 0.6)) { cursor = micSpot }
            guard await pause(0.65) else { return }
            await click()
            withAnimation(Motion.standard) { listening = true }
            guard await pause(2.0) else { return }
            withAnimation(Motion.standard) { listening = false }

            withAnimation(.easeInOut(duration: 0.9)) { cursor = rest }
            guard await pause(0.25) else { return }
            withAnimation(.spring(response: 0.42, dampingFraction: 0.9)) { open = false; peek = false }
            guard await pause(1.6) else { return }
        }
    }

    private func click() async {
        withAnimation(.easeOut(duration: 0.08)) { pressed = true }
        _ = await pause(0.1)
        withAnimation(.easeOut(duration: 0.12)) { pressed = false }
    }

    /// False once the page has gone, so the loop stops.
    private func pause(_ seconds: Double) async -> Bool {
        try? await Task.sleep(for: .seconds(seconds))
        return !Task.isCancelled
    }
}

/// Dictation's level bars, moving while "listening".
private struct LevelBars: View {
    let active: Bool
    let tint: Color
    let idle: Color

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 24, paused: !active)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 2) {
                ForEach(0..<16, id: \.self) { i in
                    let wave = active ? (0.35 + 0.65 * abs(sin(t * 5.2 + Double(i) * 0.7) * cos(t * 2.1 + Double(i) * 0.3))) : 0.12
                    Capsule()
                        .fill(active ? tint.opacity(0.5 + 0.5 * Double(i) / 16) : idle.opacity(0.5))
                        .frame(width: 2.5, height: max(2.5, 16 * wave))
                }
            }
            .frame(maxHeight: .infinity)
        }
    }
}
