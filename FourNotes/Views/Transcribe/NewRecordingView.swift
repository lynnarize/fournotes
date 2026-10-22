import AppKit
import SwiftUI
import UniformTypeIdentifiers

// Starting a recording: in person or a call, which app's sound for a call, a name, the
// language spoken, and how it will be transcribed. Or a file to transcribe instead.

struct NewRecordingView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @ObservedObject private var recorder = TalkRecorder.shared
    @ObservedObject private var models = SpeechModels.shared

    let onStarted: (String) -> Void
    let onCancel: () -> Void

    @AppStorage("fournotes.transcribe.mode") private var modeRaw = Talk.Mode.room.rawValue
    @AppStorage("fournotes.transcribe.lang") private var lang = TranscribeLanguages.preferred
    @AppStorage("fournotes.transcribe.app") private var appId = ""
    @State private var title = ""
    @State private var apps: [SystemAudio.App] = []
    @State private var appsProblem: String?
    @State private var busy = false
    @State private var importing = false

    private var mode: Talk.Mode { Talk.Mode(rawValue: modeRaw) == .call ? .call : .room }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                KitButton(kind: .plain, title: "Talks", icon: "chevronLeft", action: onCancel)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(height: 60)
            Rectangle().fill(p.borderSubtle).frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("New recording")
                        .font(FN.display(30))
                        .tracking(FN.displayTracking(30))
                        .foregroundStyle(p.foreground)

                    HStack(alignment: .top, spacing: 12) {
                        option(.room, icon: "users", label: "In person",
                               text: "A meeting in a room, an interview, a chat. Put your Mac between you.")
                        option(.call, icon: "monitor", label: "A call or meeting",
                               text: "Zoom, Google Meet, Teams or a WhatsApp call on this Mac: your voice and theirs.")
                    }

                    if mode == .call { callSetup.transition(.opacity.combined(with: .offset(y: -4))) }

                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Name it (optional)").font(FN.font(13)).foregroundStyle(p.textMuted)
                            TextField("Weekly sync with Andi", text: $title)
                                .textFieldStyle(.plain)
                                .font(FN.body)
                                .padding(.horizontal, 14)
                                .frame(height: 36)
                                .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                        }
                        .frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Language spoken").font(FN.font(13)).foregroundStyle(p.textMuted)
                            MenuButton(help: "Language spoken") {
                                TranscribeLanguages.all.map { code, name in .item(name, checked: lang == code) { lang = code } }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(TranscribeLanguages.name(lang)).font(FN.body).foregroundStyle(p.foreground)
                                    Icon("chevronDown", size: 12).foregroundStyle(p.textMuted)
                                }
                                .padding(.horizontal, 14)
                                .frame(height: 36)
                                .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                            }
                            .fixedSize()
                        }
                    }

                    how

                    Text("Tell everyone you're recording before you start. In many places it's the law.")
                        .font(FN.font(13)).foregroundStyle(p.textMuted)

                    if let preparing = recorder.preparing {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(preparing).font(FN.small).foregroundStyle(p.textSecondary)
                        }
                    }

                    HStack(spacing: 12) {
                        KitButton(kind: .primary, title: mode == .call ? "Start recording the call" : "Start recording",
                                  icon: "mic", large: true, disabled: busy || recorder.isActive) { start() }
                        KitButton(kind: .plain, title: "Transcribe a file", icon: "upload", large: true, action: pickFile)
                            .disabled(busy)
                    }
                }
                .frame(maxWidth: 640, alignment: .leading)
                .padding(.horizontal, 40)
                .padding(.top, 32)
                .padding(.bottom, 90)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.never)
        }
        .background(p.bg)
        .animation(Motion.standard, value: mode)
        .task(id: mode) { if mode == .call { await loadApps() } }
    }

    // MARK: - Pieces

    private func option(_ id: Talk.Mode, icon: String, label: String, text: String) -> some View {
        let on = mode == id
        return Button { modeRaw = id.rawValue } label: {
            VStack(alignment: .leading, spacing: 6) {
                Icon(icon, size: 20).foregroundStyle(on ? p.accent : p.textSecondary)
                Text(label).font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                Text(text).font(FN.font(13)).lineSpacing(2).foregroundStyle(p.textMuted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(on ? p.accentSubtle : p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
                .strokeBorder(on ? p.accent : p.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }

    private var callSetup: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Whose sound to record").font(FN.small).foregroundStyle(p.textMuted)
                MenuButton(help: "Whose sound to record") {
                    var entries: [MenuEntry] = [.item("All sound on this Mac", checked: appId.isEmpty) { appId = "" }]
                    if !apps.isEmpty {
                        entries.append(.divider)
                        entries += apps.map { app in .item(app.name, checked: appId == app.bundleId) { appId = app.bundleId } }
                    }
                    return entries
                } label: {
                    HStack(spacing: 6) {
                        Icon("monitor", size: 14).foregroundStyle(p.textSecondary)
                        Text(apps.first { $0.bundleId == appId }?.name ?? "All sound on this Mac").font(FN.body).foregroundStyle(p.foreground)
                        Icon("chevronDown", size: 12).foregroundStyle(p.textMuted)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                }
                .fixedSize()
            }
            if let appsProblem {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Icon("info", size: 14).foregroundStyle(p.warning)
                    Text(appsProblem).font(FN.small).foregroundStyle(p.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    SecondaryButton(title: "Open System Settings") { openPrivacySettings() }.fixedSize()
                }
                .padding(12)
                .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
            }
            VStack(alignment: .leading, spacing: 4) {
                bullet("Pick the app the call is in (Zoom, WhatsApp, Chrome for Google Meet), or keep all sound on this Mac.")
                bullet("The first time, macOS asks to let Four Notes record screen and system audio. Only the sound is kept.")
                bullet("Wear headphones, so your microphone doesn't pick up the other side as well.")
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").foregroundStyle(p.textMuted)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(FN.small)
        .foregroundStyle(p.textSecondary)
    }

    /// How it will be transcribed, in a line, with the way to do better.
    private var how: some View {
        let whisper = TalkRecorder.whisperReady
        let speakers = TalkRecorder.speakersReady
        let text: String
        if whisper {
            text = speakers
                ? "Transcribed on this Mac by Whisper, telling voices apart. Nothing you record leaves this Mac."
                : "Transcribed on this Mac by Whisper. Download the speaker model to tell voices apart."
        } else {
            text = "Transcribed on this Mac by Apple's speech model as you go. Whisper writes a better transcript, in any language, and tells voices apart."
        }
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Icon("info", size: 14).foregroundStyle(p.textMuted)
            Text(text).font(FN.small).foregroundStyle(p.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if !whisper || !speakers {
                Button(whisper ? "Get the speaker model" : "Get Whisper") { nav.openSettings(section: "api/speech") }
                    .buttonStyle(.link)
                    .font(FN.small)
            }
        }
    }

    // MARK: - Actions

    private func loadApps() async {
        do {
            apps = try await SystemAudio.apps()
            appsProblem = nil
            if !appId.isEmpty, !apps.contains(where: { $0.bundleId == appId }) { appId = "" }
        } catch {
            appsProblem = error.localizedDescription
        }
    }

    private func start() {
        busy = true
        let options = TalkRecorder.Options(mode: mode, app: mode == .call ? apps.first { $0.bundleId == appId } : nil,
                                           title: title, lang: lang)
        Task {
            defer { busy = false }
            do {
                onStarted(try await recorder.start(options))
            } catch {
                if case SystemAudio.Failure.denied = error { appsProblem = error.localizedDescription }
                AppModel.shared.toasts.push(error.localizedDescription, tone: .error)
            }
        }
    }

    private func pickFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio, .movie]
        panel.allowsMultipleSelection = false
        panel.message = "Pick a recording of a conversation to transcribe"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                onStarted(try await recorder.importFile(url, lang: lang))
            } catch {
                AppModel.shared.toasts.push("Couldn't read that file: \(error.localizedDescription)", tone: .error)
            }
        }
    }

    private func openPrivacySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }
}

/// The languages offered for Apple's recognizer; Whisper hears any of them.
enum TranscribeLanguages {
    static let all: [(String, String)] = [
        ("en-US", "English"), ("id-ID", "Bahasa Indonesia"), ("ms-MY", "Bahasa Melayu"), ("ja-JP", "日本語"), ("ko-KR", "한국어"),
        ("zh-CN", "中文"), ("es-ES", "Español"), ("fr-FR", "Français"), ("de-DE", "Deutsch"), ("pt-BR", "Português"), ("ar-SA", "العربية"),
    ]

    static func name(_ code: String) -> String { all.first { $0.0 == code }?.1 ?? code }

    /// This Mac's language, when it's one of them.
    static var preferred: String {
        let mine = Locale.current.language.languageCode?.identifier ?? "en"
        return all.first { $0.0.hasPrefix(mine) }?.0 ?? "en-US"
    }
}
