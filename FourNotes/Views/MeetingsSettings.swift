import AppKit
import SwiftUI

// Settings → Meetings: what macOS allows Transcribe, which calendars' events are
// meetings, the reminder before one, noticing calls that start without one, and Live
// Q&A answering questions asked in them.

struct MeetingsSettings: View {
    @Environment(\.palette) private var p
    @ObservedObject private var calendar = MeetingCalendar.shared
    @ObservedObject private var detector = CallDetector.shared
    @ObservedObject private var permissions = Permissions.shared
    @ObservedObject private var live = LiveQA.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsGroup {
                ForEach(Permissions.Kind.allCases) { kind in
                    SettingsRow(kind.title, description: kind.detail) {
                        PermissionControl(kind: kind)
                    } leading: {
                        SettingsTile(icon: kind.icon)
                    }
                }
            }

            SettingsGroup {
                SettingsRow("Remind me before meetings",
                            description: "For meetings with a call link or other people. The notification starts transcribing in a click") {
                    Toggle("Remind me before meetings", isOn: $calendar.remindersOn)
                        .toggleStyle(.fnSwitch)
                }
                SettingsRow("How early") {
                    SelectMenu(options: [1, 2, 5, 10].map { ($0, $0 == 1 ? "1 minute before" : "\($0) minutes before") },
                               selection: $calendar.remindMinutes)
                        .fixedSize()
                }
                .disabled(!calendar.remindersOn)
                .opacity(calendar.remindersOn ? 1 : 0.45)
            }

            SettingsGroup {
                SettingsRow("Notice calls",
                            description: detector.works
                            ? "When Zoom, Teams, Slack, FaceTime, WhatsApp or a browser starts using the microphone, offer to transcribe the call. Four Notes only sees which app has the microphone, never what's said"
                            : "macOS isn't saying which apps use the microphone on this Mac, so calls can't be noticed. Meetings on your calendar still remind you") {
                    Toggle("Notice calls", isOn: $detector.isOn)
                        .toggleStyle(.fnSwitch)
                }
                SettingsRow("Stop when the call ends", description: "Otherwise a notification asks first") {
                    Toggle("Stop when the call ends", isOn: $detector.stopsRecording)
                        .toggleStyle(.fnSwitch)
                }
                .disabled(!detector.isOn)
                .opacity(detector.isOn ? 1 : 0.45)
            }

            SettingsGroup {
                SettingsRow("Answer questions during meetings",
                            description: "Live Q&A: when someone asks something your notes, talks or library answer, the answer shows beside your notes. "
                            + "Answered by the model in Settings → AI & API keys, on this Mac first unless you chose the cloud") {
                    Toggle("Answer questions during meetings", isOn: $live.isOn)
                        .toggleStyle(.fnSwitch)
                }
            }

            if calendar.access == .allowed, !calendar.sources.isEmpty {
                SettingsGroup {
                    SettingsBlock(spacing: 14) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Calendars").font(FN.body).foregroundStyle(p.foreground)
                            SettingsHint("Events from these are your meetings on the Transcribe page. All-day events and ones you declined never are.")
                        }
                        ForEach(calendar.sources) { source in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(source.title).font(FN.font(12, .medium)).foregroundStyle(p.textMuted)
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 2),
                                          alignment: .leading, spacing: 8) {
                                    ForEach(source.calendars) { choice in
                                        Toggle(isOn: shown(choice.id)) {
                                            HStack(spacing: 6) {
                                                Circle().fill(choice.color).frame(width: 8, height: 8)
                                                Text(choice.title).lineLimit(1)
                                            }
                                        }
                                        .toggleStyle(.fnCheckbox)
                                        .font(FN.body)
                                        .foregroundStyle(p.foreground)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .task {
            await permissions.refresh()
            calendar.reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await permissions.refresh() }
            calendar.reload()
        }
        .onChange(of: permissions.state(.calendar)) { _, _ in calendar.reload() }
    }

    private func shown(_ id: String) -> Binding<Bool> {
        Binding(get: { !calendar.hidden.contains(id) },
                set: { on in if on { calendar.hidden.remove(id) } else { calendar.hidden.insert(id) } })
    }
}
