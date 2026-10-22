import AVFoundation
import Foundation

// Transcribe's recorder: a conversation in person (this Mac's microphone) or on a call
// (the microphone for you, the call's sound for them), with Apple's on-device speech
// model writing the words as they're spoken. When it stops, Whisper, if it's
// downloaded, transcribes it again, better, telling voices apart; then a model writes it
// up. As the web app's recorder (src/lib/talks/recorder.ts), on this Mac's own audio.
//
// A recording carries on while the rest of the app is used.

@MainActor
final class TalkRecorder: ObservableObject {
    static let shared = TalkRecorder()

    enum Status: Equatable { case idle, starting, recording, stopping }

    struct Options {
        var mode: Talk.Mode
        /// On a call: the app to hear, or nil for all of this Mac's sound.
        var app: SystemAudio.App?
        var title: String
        var lang: String
        /// The calendar event it's recorded for.
        var event: TalkEvent?
    }

    struct Levels: Equatable {
        var me: Float = 0
        var them: Float = 0
    }

    enum Failure: LocalizedError {
        case busy(String)
        case microphone
        var errorDescription: String? {
            switch self {
            case .busy(let what): return what
            case .microphone: return "Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone."
            }
        }
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var talkId: String?
    @Published private(set) var startedAt: Date?
    @Published private(set) var levels = Levels()
    /// The words still being heard, before they're final.
    @Published private(set) var caption = ""
    /// What's happening while it starts: "Getting Apple's speech model…".
    @Published private(set) var preparing: String?
    @Published private(set) var warning: String?
    /// Talks being transcribed or written up, and what's being done.
    @Published private(set) var working: [String: String] = [:]

    private var store: TalkStore { .shared }
    private var mic: AVAudioEngine?
    private var system: SystemAudio?
    private var writers: [String: ChannelWriter] = [:]
    private var captions: [String: LiveCaptions] = [:]
    private var volatile: [String: String] = [:]
    private var meter: Task<Void, Never>?
    /// When the talk began, on the host clock: each channel's offset is measured from it.
    private var hostStart: Double = 0

    var isActive: Bool { status != .idle }
    /// Whether a model writes each talk up once it's transcribed. Off in tests, so no
    /// transcript goes to a provider on the developer's keys.
    var writesUp = !AppModel.isTesting

    // MARK: - Recording

    /// Starts recording and returns the new talk's id.
    func start(_ options: Options) async throws -> String {
        guard status == .idle else { throw Failure.busy("A talk is already being recorded.") }
        if AppModel.shared.assistant.micBusy { throw Failure.busy("A voice note is being recorded. Stop it first.") }
        if QuickTranscriber.shared.isActive { throw Failure.busy("Dictation is running in the edge dock. Stop it first.") }
        status = .starting
        warning = nil
        caption = ""
        volatile = [:]
        do {
            return try await begin(options)
        } catch {
            if let id = talkId { store.discard(id) }
            await teardown()
            status = .idle
            preparing = nil
            throw error
        }
    }

    private func begin(_ options: Options) async throws -> String {
        guard await Self.microphoneAllowed() else { throw Failure.microphone }

        var talk = Talk(title: options.title.trimmingCharacters(in: .whitespaces).isEmpty
                            ? TalkText.defaultTitle() : options.title.trimmingCharacters(in: .whitespaces),
                        mode: options.mode,
                        app: options.mode == .call ? (options.app?.name ?? "All sound on this Mac") : nil,
                        lang: options.lang, spaceId: AppModel.shared.store.currentSpaceId)
        talk.event = options.event
        let folder = store.folder(talk.id)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let channels = options.mode == .call ? ["me", "them"] : ["room"]
        for channel in channels {
            let file = folder.appendingPathComponent(channel == "them" ? "system.m4a" : "mic.m4a")
            writers[channel] = try ChannelWriter(url: file, channel: channel)
        }

        // Apple's model, for the words as they're spoken. Without it the recording still
        // works; Whisper, if it's there, transcribes it when it stops.
        preparing = "Getting Apple's speech model ready…"
        let locale = Locale(identifier: options.lang)
        for channel in channels {
            do {
                let live = try await LiveCaptions.start(locale: locale) { [weak self] text, start, end, final in
                    Task { @MainActor in self?.heard(channel, text, start, end, final) }
                }
                captions[channel] = live
                writers[channel]?.onBuffer = { live.feed($0) }
            } catch {
                warning = SpeechModels.shared.isInstalled(SpeechModels.whisper)
                    ? "Words won't show while recording (\(error.localizedDescription)) Whisper transcribes it when you stop."
                    : "Words won't show while recording, and nothing will transcribe it: \(error.localizedDescription) Download Whisper in Settings → AI & API keys → Speech models."
                break
            }
        }
        preparing = options.mode == .call ? "Connecting to the call's sound…" : nil

        talk.channels = [:]
        store.add(talk)
        talkId = talk.id
        hostStart = AVAudioTime.seconds(forHostTime: mach_absolute_time())

        if let them = writers["them"] {
            let system = SystemAudio(writer: them)
            system.onStop = { [weak self] error in
                Task { @MainActor in
                    self?.warning = "Stopped hearing the call\(error.map { ": \($0.localizedDescription)" } ?? "."). Your voice is still being recorded."
                }
            }
            try await system.start(app: options.app)
            self.system = system
        }
        let engine = AVAudioEngine()
        guard let writer = writers["me"] ?? writers["room"], Self.tap(engine.inputNode, into: writer) else {
            throw Failure.busy("No microphone was found.")
        }
        engine.prepare()
        try engine.start()
        mic = engine

        preparing = nil
        startedAt = Date()
        status = .recording
        meter = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        return talk.id
    }

    /// Stops, and transcribes and writes it up in the background.
    func stop() async {
        guard status == .recording, let id = talkId else { return }
        status = .stopping
        meter?.cancel()
        mic?.inputNode.removeTap(onBus: 0)
        mic?.stop()
        mic = nil
        await system?.stop()
        system = nil
        for writer in writers.values { writer.close() }
        for live in captions.values { await live.finish() }
        captions = [:]

        var offsets: [String: Double] = [:]
        var duration = 0.0
        for (channel, writer) in writers {
            let offset = max(0, (writer.startedAt ?? hostStart) - hostStart)
            offsets[channel] = offset
            duration = max(duration, offset + writer.seconds)
        }
        // Words still being heard when it stopped are kept as they were.
        let left = volatile.filter { !$0.value.isEmpty }
        store.update(id) { talk in
            for (channel, text) in left {
                let at = (offsets[channel] ?? 0) + max(0, duration - 3)
                talk.segments.append(TalkSegment(speaker: channel, start: at, end: duration, text: text))
            }
            talk.channels = offsets
            talk.duration = duration
            talk.hasAudio = true
            talk.status = .transcribing
        }
        await teardown()
        status = .idle
        Task { await finish(id) }
    }

    private func teardown() async {
        meter?.cancel()
        meter = nil
        mic?.inputNode.removeTap(onBus: 0)
        mic?.stop()
        mic = nil
        await system?.stop()
        system = nil
        for writer in writers.values { writer.close() }
        writers = [:]
        for live in captions.values { await live.finish() }
        captions = [:]
        volatile = [:]
        caption = ""
        levels = Levels()
        talkId = nil
        startedAt = nil
    }

    private func tick() {
        levels = Levels(me: (writers["me"] ?? writers["room"])?.takeLevel() ?? 0,
                        them: writers["them"]?.takeLevel() ?? 0)
    }

    /// A result from the live captions: final words join the transcript, the rest show as the caption.
    private func heard(_ channel: String, _ text: String, _ start: Double, _ end: Double, _ final: Bool) {
        guard let id = talkId else { return }
        if final {
            volatile[channel] = ""
            if !text.isEmpty {
                let offset = max(0, (writers[channel]?.startedAt ?? hostStart) - hostStart)
                store.update(id) { $0.segments.append(TalkSegment(speaker: channel, start: start + offset, end: end + offset, text: text)) }
            }
        } else {
            volatile[channel] = text
        }
        caption = ["me", "them", "room"].compactMap { volatile[$0] }.filter { !$0.isEmpty }.joined(separator: " … ")
    }

    // MARK: - After recording

    /// Mixes the channels for playback, transcribes it again with Whisper when it's
    /// there, and writes it up. Also finishes a talk left half done when the app quit.
    func finish(_ id: String) async {
        guard working[id] == nil, let talk = store.talk(id) else { return }
        working[id] = "Getting the recording ready…"
        defer { working[id] = nil }
        await mix(talk)

        if Self.whisperReady {
            working[id] = Self.speakersReady ? "Transcribing and telling voices apart…" : "Transcribing on this Mac…"
            await whisper(id)
        } else if talk.mode == .upload, let file = store.audio(id) {
            working[id] = "Transcribing on this Mac…"
            do {
                let pieces = try await AppleSpeech.transcribe(file, locale: Locale(identifier: talk.lang))
                store.update(id) {
                    $0.segments = pieces.map { TalkSegment(speaker: "room", start: $0.start, end: $0.end, text: $0.text) }
                    $0.engine = .apple
                }
            } catch {
                store.update(id) { $0.problem = "Couldn't transcribe it: \(error.localizedDescription) Download Whisper in Settings → AI & API keys → Speech models to transcribe any language." }
            }
        } else {
            store.update(id) { if !$0.segments.isEmpty { $0.engine = .apple } }
        }
        store.update(id) {
            if $0.segments.isEmpty, $0.problem == nil {
                $0.problem = "Nothing was transcribed. Download Whisper in Settings → AI & API keys → Speech models, then use Transcribe again."
            }
            $0.status = .done
        }
        if writesUp, store.talk(id)?.segments.isEmpty == false {
            working[id] = "Writing it up…"
            try? await writeUp(id)
        }
    }

    /// The recording through Whisper again: for Transcribe again, or once Whisper is downloaded.
    func transcribeAgain(_ id: String) async {
        guard working[id] == nil, Self.whisperReady else { return }
        working[id] = Self.speakersReady ? "Transcribing and telling voices apart…" : "Transcribing on this Mac…"
        await whisper(id)
        if writesUp {
            working[id] = "Writing it up…"
            try? await writeUp(id)
        }
        working[id] = nil
    }

    /// A model's write-up: title, summary, key points, action items, and who each person was.
    func writeUp(_ id: String) async throws {
        guard let talk = store.talk(id), !talk.segments.isEmpty else { return }
        let alreadyWorking = working[id] != nil
        if !alreadyWorking { working[id] = "Writing it up…" }
        defer { if !alreadyWorking { working[id] = nil } }
        var ids: [String] = []
        for s in talk.segments where !ids.contains(s.speaker) { ids.append(s.speaker) }
        let input = TalkWriteUp.Input(
            title: talk.title, when: TalkText.meta(talk), app: talk.app,
            speakers: ids.map { ($0, TalkText.name(talk, $0)) }, transcript: TalkText.transcript(talk))
        let w = try await AppModel.shared.engine.talkWriteUp(input)
        store.update(id) { t in
            t.summary = TalkSummary(text: w.summary, keyPoints: w.keyPoints, actionItems: w.actionItems,
                                    people: w.people.filter { $0.id != "me" && ids.contains($0.id) && !$0.profile.isEmpty }
                                        .map { .init(speaker: $0.id, profile: $0.profile) })
            for p in w.people where p.id != "me" && ids.contains(p.id) && !p.name.isEmpty && (t.names[p.id] ?? "").isEmpty {
                t.names[p.id] = String(p.name.prefix(60))
            }
            if TalkText.isDefaultTitle(t.title), !w.title.isEmpty { t.title = String(w.title.prefix(120)) }
        }
    }

    /// A file of a conversation (a voice memo, a meeting's recording, a video) as a talk.
    func importFile(_ url: URL, lang: String) async throws -> String {
        let name = url.deletingPathExtension().lastPathComponent
        var talk = Talk(title: name.isEmpty ? TalkText.defaultTitle() : name, mode: .upload, lang: lang,
                        spaceId: AppModel.shared.store.currentSpaceId)
        let folder = store.folder(talk.id)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let out = folder.appendingPathComponent("talk.m4a")
        let asset = AVURLAsset(url: url)
        guard try await !asset.loadTracks(withMediaType: .audio).isEmpty,
              let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            try? FileManager.default.removeItem(at: folder)
            throw Failure.busy("There's no sound in that file to transcribe.")
        }
        do {
            try await session.export(to: out, as: .m4a)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
        let duration = try await asset.load(.duration).seconds
        talk.duration = duration.isFinite ? duration : 0
        talk.channels = ["room": 0]
        talk.hasAudio = true
        talk.status = .transcribing
        store.add(talk)
        Task { await finish(talk.id) }
        return talk.id
    }

    /// Talks the app quit in the middle of: recordings cut off are kept as they are,
    /// transcriptions are finished.
    func resumeInterrupted() {
        for talk in store.all where talk.isAlive && talk.id != talkId && working[talk.id] == nil {
            switch talk.status {
            case .recording:
                store.update(talk.id) {
                    $0.status = .done
                    $0.problem = "The recording was cut off when Four Notes quit. The words heard until then are kept."
                    $0.engine = $0.segments.isEmpty ? nil : .apple
                }
            case .transcribing:
                Task { await finish(talk.id) }
            case .done:
                break
            }
        }
    }

    // MARK: - Pieces

    static var whisperReady: Bool {
        SpeechModels.shared.useForRecordings && SpeechModels.shared.isInstalled(SpeechModels.whisper)
    }

    static var speakersReady: Bool { SpeechModels.shared.isInstalled(SpeechModels.speakers) }

    /// Each channel through Whisper, its voices told apart when the speaker model is there.
    private func whisper(_ id: String) async {
        guard let talk = store.talk(id) else { return }
        let models = SpeechModels.shared
        let folder = store.folder(id)
        var channels = talk.channels ?? [:]
        if channels.isEmpty { channels = talk.mode == .call ? ["me": 0, "them": 0] : ["room": 0] }
        var segments: [TalkSegment] = []
        var transcribed = Set<String>()
        var failures: [String] = []
        for (channel, offset) in channels.sorted(by: { $0.key < $1.key }) {
            let name = talk.mode == .upload ? "talk.m4a" : channel == "them" ? "system.m4a" : "mic.m4a"
            let file = folder.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: file.path) else { continue }
            do {
                // Your own microphone on a call is you: no need to tell voices apart there.
                let speakers = channel == "me" || !Self.speakersReady ? nil : models.folder(SpeechModels.speakers)
                let result = try await LocalSpeech.pieces(file, whisperFolder: models.folder(SpeechModels.whisper), speakersFolder: speakers)
                var letters: [Int: String] = [:]
                for piece in result.pieces {
                    let speaker: String
                    if channel == "me" || result.speakers < 2 || piece.speaker == nil {
                        speaker = channel
                    } else {
                        let index = piece.speaker!
                        if letters[index] == nil { letters[index] = Self.letter(letters.count) }
                        speaker = channel == "them" ? "them:\(letters[index]!)" : letters[index]!
                    }
                    segments.append(TalkSegment(speaker: speaker, start: piece.start + offset, end: piece.end + offset, text: piece.text))
                }
                transcribed.insert(channel)
            } catch LocalSpeech.Failure.empty {
                continue
            } catch {
                failures.append(error.localizedDescription)
            }
        }
        store.update(id) { t in
            if !transcribed.isEmpty {
                // Whisper's words replace the live ones on each channel it heard; a
                // channel it couldn't do keeps what was heard live.
                let kept = t.segments.filter { !transcribed.contains(Self.channel(of: $0.speaker)) }
                t.segments = (segments + kept).sorted { $0.start < $1.start }
                t.engine = .whisper
                t.problem = nil
            } else if !failures.isEmpty {
                t.problem = "Whisper couldn't transcribe it: \(failures[0])"
            }
        }
    }

    /// Which recording a speaker's words came from.
    nonisolated static func channel(of speaker: String) -> String {
        speaker == "me" ? "me" : speaker == "them" || speaker.hasPrefix("them:") ? "them" : "room"
    }

    private static func letter(_ i: Int) -> String {
        i < 26 ? String(UnicodeScalar(65 + i)!) : "\(i + 1)"
    }

    /// On a call, both channels in one file for playback, each at its own start.
    private func mix(_ talk: Talk) async {
        let folder = store.folder(talk.id)
        let me = folder.appendingPathComponent("mic.m4a"), them = folder.appendingPathComponent("system.m4a")
        let out = folder.appendingPathComponent("talk.m4a")
        let fm = FileManager.default
        guard talk.mode == .call, fm.fileExists(atPath: me.path), fm.fileExists(atPath: them.path), !fm.fileExists(atPath: out.path) else { return }
        let offsets = talk.channels ?? [:]
        let base = offsets.values.min() ?? 0
        let composition = AVMutableComposition()
        for (url, channel) in [(me, "me"), (them, "them")] {
            let asset = AVURLAsset(url: url)
            guard let track = try? await asset.loadTracks(withMediaType: .audio).first,
                  let duration = try? await asset.load(.duration), duration.seconds > 0,
                  let into = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
            let at = CMTime(seconds: (offsets[channel] ?? 0) - base, preferredTimescale: 48_000)
            try? into.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: track, at: at)
        }
        guard !composition.tracks.isEmpty,
              let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else { return }
        do { try await session.export(to: out, as: .m4a) } catch {
            try? fm.removeItem(at: out)
            print("[talks] couldn't mix the recording: \(error.localizedDescription)")
        }
    }

    nonisolated private static func microphoneAllowed() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    /// The microphone into a channel. Made here, outside the main actor, because the tap
    /// runs on the audio thread (see Assistant.swift on why that matters). False when
    /// there's no usable input: a tap with an empty format raises an exception nothing catches.
    nonisolated private static func tap(_ input: AVAudioInputNode, into writer: ChannelWriter) -> Bool {
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return false }
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, when in
            let seconds = when.isHostTimeValid ? AVAudioTime.seconds(forHostTime: when.hostTime)
                                               : AVAudioTime.seconds(forHostTime: mach_absolute_time())
            writer.write(buffer, at: seconds)
        }
        return true
    }
}
