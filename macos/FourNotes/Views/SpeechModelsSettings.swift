import AppKit
import SwiftUI

// Settings → AI & API keys → Speech models: download Whisper and the speaker model
// inside the app, watch it come in (size, speed, time left), pause, resume, cancel,
// and delete it again. See Services/SpeechModels.swift.

struct SpeechModelsSettings: View {
    @ObservedObject private var models = SpeechModels.shared
    @Environment(\.palette) private var p
    @State private var confirmDelete: SpeechModels.Pack?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsHint("Downloaded once from Hugging Face, then they work offline and nothing you record leaves this Mac.")

            ForEach(SpeechModels.packs) { pack in
                PackRow(pack: pack, status: models.status(pack), confirmDelete: $confirmDelete)
                if pack.id != SpeechModels.packs.last?.id { Rectangle().fill(p.borderSubtle).frame(height: 1) }
            }

            if models.isInstalled(SpeechModels.whisper) {
                Rectangle().fill(p.borderSubtle).frame(height: 1)
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Use Whisper for recordings").font(FN.body).foregroundStyle(p.foreground)
                        SettingsHint(models.useForRecordings
                             ? "Recordings are transcribed with Whisper\(models.isInstalled(SpeechModels.speakers) ? ", speakers told apart" : ""). Apple's recognizer still shows the words live."
                             : "Apple's speech recognizer transcribes recordings.")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Toggle("Use Whisper for recordings", isOn: $models.useForRecordings)
                        .toggleStyle(.fnSwitch)
                }
            }
        }
        .confirmationDialog(
            "Delete \(confirmDelete?.name ?? "this model")?",
            isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let pack = confirmDelete { models.delete(pack) }
                confirmDelete = nil
            }
            Button("Keep it", role: .cancel) { confirmDelete = nil }
        } message: {
            Text("It's removed from this Mac and frees \(SpeechModels.size(confirmDelete.map { models.status($0).total ?? $0.approxBytes } ?? 0)). You can download it again any time.")
        }
    }
}

private struct PackRow: View {
    @ObservedObject private var models = SpeechModels.shared
    @Environment(\.palette) private var p
    let pack: SpeechModels.Pack
    let status: SpeechModels.Status
    @Binding var confirmDelete: SpeechModels.Pack?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 16) {
                SettingsTile(icon: pack.icon)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(pack.name).font(FN.body).foregroundStyle(p.foreground)
                        if status.phase == .installed {
                            StatusPill(text: "Installed", tone: .good)
                        }
                    }
                    SettingsHint("\(pack.detail) \(SpeechModels.size(status.total ?? pack.approxBytes)).")
                }
                Spacer(minLength: 12)
                buttons
            }

            if showsProgress {
                // As the web's on-device download: an 8pt bar on the muted surface.
                VStack(alignment: .leading, spacing: 10) {
                    ProgressBar(ratio: status.phase == .verifying || status.phase == .preparing ? 1 : max(0.02, status.fraction),
                                tone: status.phase == .paused ? p.textMuted : p.accent, height: 8, track: p.surfaceMuted)
                    Text(progressLine)
                        .font(FN.font(13)).monospacedDigit().foregroundStyle(p.textSecondary)
                        .accessibilityLabel(progressLine)
                }
                .transition(.opacity)
            }

            if case .failed(let message) = status.phase {
                HStack(alignment: .top, spacing: 6) {
                    Icon("warning", size: 15).padding(.top, 1)
                    Text(message).fixedSize(horizontal: false, vertical: true)
                }
                .font(FN.font(13))
                .foregroundStyle(p.danger)
            }
        }
        .animation(Motion.standard, value: status.phase)
    }

    private var showsProgress: Bool {
        switch status.phase {
        case .listing, .downloading, .paused, .verifying, .preparing: return true
        case .failed: return status.received > 0
        case .notInstalled, .installed: return false
        }
    }

    @ViewBuilder
    private var buttons: some View {
        HStack(spacing: 6) {
            switch status.phase {
            case .notInstalled:
                SecondaryButton(title: "Download", icon: "download", small: true) { models.download(pack) }
            case .listing, .downloading:
                SecondaryButton(title: "Pause", small: true) { models.pause(pack) }
                KitButton(kind: .plain, title: "Cancel", small: true) { models.cancel(pack) }
            case .paused:
                SecondaryButton(title: "Resume", small: true) { models.download(pack) }
                KitButton(kind: .plain, title: "Cancel", small: true) { models.cancel(pack) }
            case .failed:
                SecondaryButton(title: status.received > 0 ? "Resume" : "Try again", small: true) { models.download(pack) }
                KitButton(kind: .plain, title: "Cancel", small: true) { models.cancel(pack) }
            case .verifying, .preparing:
                EmptyView()
            case .installed:
                KitButton(kind: .plain, title: "Show in Finder", small: true) {
                    NSWorkspace.shared.activateFileViewerSelecting([models.folder(pack)])
                }
                KitButton(kind: .danger, title: "Delete", small: true) { confirmDelete = pack }
            }
        }
        .fixedSize()
    }

    /// "42% · 263 MB of 627 MB · 12 MB/s · about 1 min left"
    private var progressLine: String {
        switch status.phase {
        case .listing: return "Getting the file list from Hugging Face…"
        case .verifying: return "Checking the files…"
        case .preparing: return "Getting it ready for this Mac (first time only, a minute or two)…"
        default: break
        }
        let total = status.total ?? pack.approxBytes
        var parts = ["\(Int(status.fraction * 100))%", "\(SpeechModels.size(status.received)) of \(SpeechModels.size(total))"]
        if status.phase == .paused { return "Paused · " + parts.joined(separator: " · ") }
        if let rate = status.rate, rate > 0 {
            parts.append("\(SpeechModels.size(Int64(rate)))/s")
            if let left = timeLeft(seconds: Double(total - status.received) / rate) { parts.append(left) }
        }
        return parts.joined(separator: " · ")
    }

    private func timeLeft(seconds: Double) -> String? {
        guard seconds.isFinite, seconds > 0 else { return nil }
        if seconds < 60 { return "less than a minute left" }
        if seconds < 3600 { return "about \(Int((seconds / 60).rounded())) min left" }
        return "about \(Int(seconds / 3600)) h \(Int((seconds.truncatingRemainder(dividingBy: 3600) / 60).rounded())) min left"
    }
}
