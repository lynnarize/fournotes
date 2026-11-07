import AppKit
import AVFoundation
import CoreGraphics
import EventKit
import UserNotifications

// What Transcribe needs macOS to allow — the microphone, the call's sound, the calendar
// and notifications — in one place, for the setup step and Settings: whether each is
// on, asking for it the way the recorder does, and System Settings once only it can
// change the answer.

@MainActor
final class Permissions: ObservableObject {
    static let shared = Permissions()

    enum Kind: String, CaseIterable, Identifiable {
        case microphone, systemAudio, calendar, notifications
        var id: String { rawValue }

        var title: String {
            switch self {
            case .microphone: return "Microphone"
            case .systemAudio: return "System audio"
            case .calendar: return "Calendar"
            case .notifications: return "Notifications"
            }
        }

        var detail: String {
            switch self {
            case .microphone: return "Hears you, and everyone in the room, to transcribe it."
            case .systemAudio: return "Hears the other side of a call in Zoom, Meet or WhatsApp. Only the sound is kept."
            case .calendar: return "Lists your meetings, so one records with its name and who's invited."
            case .notifications: return "Reminds you before a meeting, and offers to transcribe a call."
            }
        }

        var icon: String {
            switch self {
            case .microphone: return "mic"
            case .systemAudio: return "monitor"
            case .calendar: return "calendar"
            case .notifications: return "bell"
            }
        }

        fileprivate var settingsURL: String {
            switch self {
            case .microphone: return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            case .systemAudio: return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            case .calendar: return "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
            case .notifications: return "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
            }
        }
    }

    enum State: Equatable { case notAsked, allowed, denied }

    @Published private(set) var states: [Kind: State] = [:]
    @Published private(set) var asking: Kind?

    /// macOS can't say whether screen and audio recording was refused or never asked, so
    /// the asking is remembered.
    private static let askedSystemAudioKey = "fournotes.permissions.askedSystemAudio"

    func state(_ kind: Kind) -> State { states[kind] ?? .notAsked }
    var allAllowed: Bool { Kind.allCases.allSatisfy { state($0) == .allowed } }

    func refresh() async {
        var next: [Kind: State] = [:]
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: next[.microphone] = .allowed
        case .notDetermined: next[.microphone] = .notAsked
        default: next[.microphone] = .denied
        }
        next[.systemAudio] = CGPreflightScreenCaptureAccess() ? .allowed
            : UserDefaults.standard.bool(forKey: Self.askedSystemAudioKey) ? .denied : .notAsked
        switch MeetingCalendar.currentAccess() {
        case .allowed: next[.calendar] = .allowed
        case .notAsked: next[.calendar] = .notAsked
        case .denied: next[.calendar] = .denied
        }
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional: next[.notifications] = .allowed
        case .notDetermined: next[.notifications] = .notAsked
        default: next[.notifications] = .denied
        }
        states = next
    }

    /// Asks for one. Refused before, macOS won't ask again: System Settings opens instead.
    func request(_ kind: Kind) async {
        if state(kind) == .denied {
            openSystemSettings(kind)
            return
        }
        asking = kind
        defer { asking = nil }
        switch kind {
        case .microphone:
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        case .systemAudio:
            UserDefaults.standard.set(true, forKey: Self.askedSystemAudioKey)
            // Listing what can be recorded is what brings up macOS's prompt, as the recorder does.
            _ = try? await SystemAudio.apps()
        case .calendar:
            await MeetingCalendar.shared.requestAccess()
        case .notifications:
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        }
        await refresh()
    }

    /// "Allow all": each one not yet asked, one prompt after the other.
    func requestAll() async {
        await refresh()
        for kind in Kind.allCases where state(kind) == .notAsked {
            await request(kind)
        }
    }

    func openSystemSettings(_ kind: Kind) {
        if let url = URL(string: kind.settingsURL) { NSWorkspace.shared.open(url) }
    }
}
