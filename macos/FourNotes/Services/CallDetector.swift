import AppKit
import CoreAudio
import Foundation

// Notices a call that starts without a calendar, as Granola does: an app people call
// from (Zoom, Teams, Slack, FaceTime, WhatsApp, a browser for Google Meet) starts using
// the microphone while nothing is being recorded, and a notification offers to
// transcribe it. When that app lets go of the microphone while its call is being
// recorded, one offers to stop (or the recording stops, if Settings says so).
//
// It only asks CoreAudio which apps have the microphone open, every few seconds. It
// hears nothing.

/// An app people call from, as the process using the microphone names it.
struct CallApp: Equatable, Hashable, Sendable {
    var name: String
    /// The app's bundle id. Its helpers' ids start with it ("com.google.Chrome.helper").
    var bundleId: String
    var isBrowser = false

    static let known: [CallApp] = [
        CallApp(name: "Zoom", bundleId: "us.zoom.xos"),
        CallApp(name: "Microsoft Teams", bundleId: "com.microsoft.teams2"),
        CallApp(name: "Microsoft Teams", bundleId: "com.microsoft.teams"),
        CallApp(name: "Slack", bundleId: "com.tinyspeck.slackmacgap"),
        CallApp(name: "FaceTime", bundleId: "com.apple.FaceTime"),
        CallApp(name: "WhatsApp", bundleId: "net.whatsapp.WhatsApp"),
        CallApp(name: "WhatsApp", bundleId: "desktop.WhatsApp"),
        CallApp(name: "Discord", bundleId: "com.hnc.Discord"),
        CallApp(name: "Webex", bundleId: "Cisco-Systems.Spark"),
        CallApp(name: "Webex", bundleId: "com.webex.meetingmanager"),
        CallApp(name: "Telegram", bundleId: "ru.keepcoder.Telegram"),
        CallApp(name: "Google Chrome", bundleId: "com.google.Chrome", isBrowser: true),
        CallApp(name: "Arc", bundleId: "company.thebrowser.Browser", isBrowser: true),
        CallApp(name: "Dia", bundleId: "company.thebrowser.dia", isBrowser: true),
        CallApp(name: "Microsoft Edge", bundleId: "com.microsoft.edgemac", isBrowser: true),
        CallApp(name: "Brave", bundleId: "com.brave.Browser", isBrowser: true),
        CallApp(name: "Firefox", bundleId: "org.mozilla.firefox", isBrowser: true),
        CallApp(name: "Opera", bundleId: "com.operasoftware.Opera", isBrowser: true),
        CallApp(name: "Vivaldi", bundleId: "com.vivaldi.Vivaldi", isBrowser: true),
        CallApp(name: "Safari", bundleId: "com.apple.Safari", isBrowser: true),
    ]

    /// Which call app a process using the microphone belongs to. Safari's pages hear
    /// through WebKit's shared GPU process, so that counts as Safari only while Safari is
    /// open; FaceTime's calls go through the conferencing daemon.
    static func of(bundleId: String, safariOpen: Bool) -> CallApp? {
        let id = bundleId.lowercased()
        guard !id.isEmpty else { return nil }
        if let me = Bundle.main.bundleIdentifier?.lowercased(), id == me || id.hasPrefix(me + ".") { return nil }
        if id == "com.apple.webkit.gpu" { return safariOpen ? known.first { $0.bundleId == "com.apple.Safari" } : nil }
        if id == "com.apple.avconferenced" { return known.first { $0.bundleId == "com.apple.FaceTime" } }
        return known.first { app in
            let own = app.bundleId.lowercased()
            return id == own || id.hasPrefix(own + ".")
        }
    }
}

/// The detector's memory between looks: which call apps have the microphone, for how
/// many looks in a row, and which have been reported.
struct CallWatch: Equatable {
    enum Event: Equatable { case started(CallApp), ended(CallApp) }

    /// Looks in a row an app needs the microphone (or not) before it counts: Slack checks
    /// the microphone for a moment when it opens, and a call lasts.
    static let settle = 2

    private(set) var using: [CallApp: Int] = [:]
    private(set) var away: [CallApp: Int] = [:]
    /// Apps on a call, as reported.
    private(set) var onCall: Set<CallApp> = []

    mutating func look(_ now: Set<CallApp>) -> [Event] {
        var events: [Event] = []
        for app in now {
            using[app, default: 0] += 1
            away[app] = nil
            if using[app, default: 0] >= Self.settle, onCall.insert(app).inserted { events.append(.started(app)) }
        }
        for app in Set(using.keys).subtracting(now) { using[app] = nil }
        for app in onCall.subtracting(now) {
            away[app, default: 0] += 1
            if away[app, default: 0] >= Self.settle {
                onCall.remove(app)
                away[app] = nil
                events.append(.ended(app))
            }
        }
        return events
    }
}

@MainActor
final class CallDetector: ObservableObject {
    static let shared = CallDetector()

    /// Offer to transcribe a call when one starts. On by default.
    @Published var isOn: Bool {
        didSet {
            UserDefaults.standard.set(isOn, forKey: Self.onKey)
            isOn ? start() : stop()
        }
    }
    /// Stop recording when the call's app hangs up, rather than asking.
    @Published var stopsRecording: Bool {
        didSet { UserDefaults.standard.set(stopsRecording, forKey: Self.stopsKey) }
    }
    /// False when CoreAudio wouldn't say which apps use the microphone.
    @Published private(set) var works = true

    private static let onKey = "fournotes.meetings.detectCalls"
    private static let stopsKey = "fournotes.meetings.stopWhenCallEnds"

    private var watch = CallWatch()
    private var looking: Task<Void, Never>?
    /// The call apps heard during the recording now going: the call it's of.
    private var recorded: Set<CallApp> = []

    private init() {
        isOn = UserDefaults.standard.object(forKey: Self.onKey) as? Bool ?? true
        stopsRecording = UserDefaults.standard.bool(forKey: Self.stopsKey)
    }

    func start() {
        guard isOn, looking == nil else { return }
        looking = Task { [weak self] in
            while !Task.isCancelled {
                await self?.look()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() {
        looking?.cancel()
        looking = nil
        watch = CallWatch()
        recorded = []
    }

    private func look() async {
        // CoreAudio asks its daemon, which can be slow to answer: not on the main thread.
        guard let ids = await Task.detached(priority: .utility, operation: { Self.micUsers() }).value else {
            works = false
            return
        }
        works = true
        let safariOpen = NSWorkspace.shared.runningApplications.contains { $0.bundleIdentifier == "com.apple.Safari" }
        let apps = Set(ids.compactMap { CallApp.of(bundleId: $0, safariOpen: safariOpen) })
        let events = watch.look(apps)

        let recorder = TalkRecorder.shared
        let callTalk = recorder.status == .recording
            ? recorder.talkId.flatMap { TalkStore.shared.talk($0) }.flatMap { $0.mode == .call ? $0 : nil } : nil
        if callTalk == nil { recorded = [] } else { recorded.formUnion(watch.onCall) }

        for event in events {
            switch event {
            case .started(let app):
                // A voice note or dictation has the microphone too; a recording is already going.
                guard !recorder.isActive, !AppModel.shared.assistant.micBusy, !QuickTranscriber.shared.isActive else { continue }
                let meeting = MeetingRules.current(MeetingCalendar.shared.meetings, now: Date(), app: app.bundleId, browser: app.isBrowser)
                await MeetingAlerts.callStarted(app, meeting: meeting)
            case .ended(let app):
                guard callTalk != nil, recorded.contains(app), recorded.isDisjoint(with: watch.onCall) else { continue }
                recorded = []
                if stopsRecording { await recorder.stop() }
                await MeetingAlerts.callEnded(app, stopped: stopsRecording)
            }
        }
    }

    // MARK: - CoreAudio

    /// The bundle ids of the processes using a microphone now, or nil when CoreAudio
    /// won't say (it's macOS 14.2's process list).
    nonisolated static func micUsers() -> [String]? {
        var list = address(kAudioHardwarePropertyProcessObjectList)
        let system = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &list, 0, nil, &size) == noErr else { return nil }
        var processes = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &list, 0, nil, &size, &processes) == noErr else { return nil }
        return processes.compactMap { process in
            var input = address(kAudioProcessPropertyIsRunningInput)
            var running: UInt32 = 0
            var length = UInt32(MemoryLayout<UInt32>.size)
            guard AudioObjectGetPropertyData(process, &input, 0, nil, &length, &running) == noErr, running != 0 else { return nil }
            var bundle = address(kAudioProcessPropertyBundleID)
            var name: Unmanaged<CFString>?
            var nameLength = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            let status = withUnsafeMutablePointer(to: &name) { AudioObjectGetPropertyData(process, &bundle, 0, nil, &nameLength, $0) }
            guard status == noErr, let id = name?.takeRetainedValue() as String?, !id.isEmpty else { return nil }
            return id
        }
    }

    nonisolated private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }
}
