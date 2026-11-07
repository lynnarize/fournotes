import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import Speech

// The pieces a recorded talk is made of, each running on the audio threads rather than
// the main actor:
//
// - ChannelWriter: one voice channel (this Mac's microphone, or the call's sound) to an
//   AAC file, its level for the meter, and gaps filled with silence so its clock stays
//   the wall clock's.
// - LiveCaptions: Apple's on-device speech model transcribing a channel as it comes in.
// - SystemAudio: the sound of a call (all of this Mac's, or one app's) via ScreenCaptureKit.

/// One channel: converted to 48 kHz mono, written to an AAC file, and passed on to captions.
final class ChannelWriter: @unchecked Sendable {
    nonisolated static let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000,
                                                  channels: 1, interleaved: false)!

    let channel: String
    let url: URL
    /// Each buffer as written, silence included: what the captions hear.
    var onBuffer: (@Sendable (AVAudioPCMBuffer) -> Void)?

    private let lock = NSLock()
    private var file: AVAudioFile?
    private var converter: AVAudioConverter?
    private var converterInput: AVAudioFormat?
    /// Host-clock seconds of the first frame written, and how many frames since.
    private var startSeconds: Double?
    private var frames: AVAudioFramePosition = 0
    private var level: Float = 0

    init(url: URL, channel: String) throws {
        self.url = url
        self.channel = channel
        file = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ], commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    /// When the channel's first sound arrived, on the host clock (nil before any).
    var startedAt: Double? { lock.withLock { startSeconds } }
    var seconds: Double { lock.withLock { Double(frames) / Self.format.sampleRate } }
    /// The latest loudness, 0…1, for the meter; it falls back between buffers.
    func takeLevel() -> Float {
        lock.withLock {
            let l = level
            level *= 0.6
            return l
        }
    }

    /// `at` is the buffer's start on the host clock. A gap since the last buffer (a
    /// silent app sends nothing) is written as silence, so times in the file stay true.
    func write(_ buffer: AVAudioPCMBuffer, at hostSeconds: Double) {
        lock.lock()
        defer { lock.unlock() }
        guard file != nil, buffer.frameLength > 0, let out = convert(buffer) else { return }
        if let start = startSeconds {
            let expected = start + Double(frames) / Self.format.sampleRate
            let gap = hostSeconds - expected
            // Under a tenth of a second is jitter, not a gap; an hour is a clock gone wrong.
            if gap > 0.1, gap < 3600 { writeSilence(seconds: gap) }
        } else {
            startSeconds = hostSeconds
        }
        append(out)
        level = max(level, Self.loudness(out))
    }

    /// Stops writing and closes the file.
    func close() {
        lock.withLock {
            file?.close()
            file = nil
        }
    }

    // Called with the lock held.

    private func append(_ buffer: AVAudioPCMBuffer) {
        do { try file?.write(from: buffer) } catch { return }
        frames += AVAudioFramePosition(buffer.frameLength)
        onBuffer?(buffer)
    }

    private func writeSilence(seconds: Double) {
        var left = AVAudioFrameCount(seconds * Self.format.sampleRate)
        while left > 0 {
            let n = min(left, 48_000)
            guard let silence = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: n) else { return }
            silence.frameLength = n
            // Fresh buffers are zeroed: silence.
            append(silence)
            left -= n
        }
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if buffer.format == Self.format { return buffer }
        if converterInput != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: Self.format)
            converterInput = buffer.format
        }
        guard let converter else { return nil }
        let ratio = Self.format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: capacity) else { return nil }
        var fed = false
        var error: NSError?
        _ = converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil && out.frameLength > 0 ? out : nil
    }

    /// RMS on a rough perceptual scale: speech sits around the middle of the meter.
    private static func loudness(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        let rms = (sum / Float(buffer.frameLength)).squareRoot()
        let db = 20 * log10(max(rms, 0.000_01))
        return min(1, max(0, (db + 55) / 50))
    }
}

// MARK: - Live captions

/// Apple's on-device speech model, transcribing one channel as it is recorded.
final class LiveCaptions: @unchecked Sendable {
    /// text, start and end in seconds from the channel's first sound, and whether it's final.
    typealias Handler = @Sendable (String, Double, Double, Bool) -> Void

    private let analyzer: SpeechAnalyzer
    private let transcriber: SpeechTranscriber
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let target: AVAudioFormat
    private let converter: AVAudioConverter?
    private var results: Task<Void, Never>?

    private init(analyzer: SpeechAnalyzer, transcriber: SpeechTranscriber,
                 input: AsyncStream<AnalyzerInput>.Continuation, target: AVAudioFormat) {
        self.analyzer = analyzer
        self.transcriber = transcriber
        self.input = input
        self.target = target
        converter = target == ChannelWriter.format ? nil : AVAudioConverter(from: ChannelWriter.format, to: target)
    }

    /// Starts listening. Throws when the language isn't available on this Mac.
    static func start(locale: Locale, onResult: @escaping Handler) async throws -> LiveCaptions {
        let supported = try await AppleSpeech.prepare(locale)
        let transcriber = SpeechTranscriber(locale: supported, preset: .progressiveTranscription)
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber],
                                                                          considering: ChannelWriter.format) else {
            throw AppleSpeech.Failure.unavailable
        }
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        try await analyzer.prepareToAnalyze(in: format)
        let captions = LiveCaptions(analyzer: analyzer, transcriber: transcriber, input: continuation, target: format)
        captions.results = Task {
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    let start = result.range.start.seconds, end = result.range.end.seconds
                    onResult(text, start.isFinite ? start : 0, end.isFinite ? end : 0, result.isFinal)
                }
            } catch {
                print("[talks] live captions stopped: \(error.localizedDescription)")
            }
        }
        try await analyzer.start(inputSequence: stream)
        return captions
    }

    /// Called on the audio thread with the channel writer's buffers.
    func feed(_ buffer: AVAudioPCMBuffer) {
        guard let converter else {
            input.yield(AnalyzerInput(buffer: buffer))
            return
        }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var fed = false
        var error: NSError?
        _ = converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        if error == nil, out.frameLength > 0 { input.yield(AnalyzerInput(buffer: out)) }
    }

    /// Finishes what it has heard, then stops.
    func finish() async {
        input.finish()
        do { try await analyzer.finalizeAndFinishThroughEndOfInput() } catch { await analyzer.cancelAndFinishNow() }
        await results?.value
    }
}

/// Apple's speech model: getting a language ready, and transcribing a whole file.
enum AppleSpeech {
    enum Failure: LocalizedError {
        case language(String)
        case unavailable
        var errorDescription: String? {
            switch self {
            case .language(let name): return "Apple's speech recognizer doesn't know \(name) on this Mac."
            case .unavailable: return "Apple's speech recognizer isn't available on this Mac."
            }
        }
    }

    /// The language as the recognizer knows it, downloaded first if it isn't on this Mac yet.
    static func prepare(_ locale: Locale) async throws -> Locale {
        guard SpeechTranscriber.isAvailable else { throw Failure.unavailable }
        guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            throw Failure.language(Locale.current.localizedString(forIdentifier: locale.identifier) ?? locale.identifier)
        }
        let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        return supported
    }

    /// A recording, phrase by phrase, with times.
    static func transcribe(_ url: URL, locale: Locale) async throws -> [(start: Double, end: Double, text: String)] {
        let supported = try await prepare(locale)
        let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
        let collecting = Task { () -> [(start: Double, end: Double, text: String)] in
            var out: [(start: Double, end: Double, text: String)] = []
            for try await result in transcriber.results where result.isFinal {
                let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                out.append((result.range.start.seconds, result.range.end.seconds, text))
            }
            return out
        }
        let file = try AVAudioFile(forReading: url)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        do {
            if let end = try await analyzer.analyzeSequence(from: file) {
                try await analyzer.finalizeAndFinish(through: end)
            } else {
                await analyzer.cancelAndFinishNow()
            }
        } catch {
            collecting.cancel()
            throw error
        }
        return try await collecting.value
    }
}

// MARK: - The sound of a call

/// Everything this Mac plays (or one app's sound), minus Four Notes' own, through
/// ScreenCaptureKit. Needs Screen & System Audio Recording permission; nothing of the
/// screen itself is kept.
final class SystemAudio: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    struct App: Identifiable, Hashable {
        var id: String { bundleId }
        var bundleId: String
        var name: String
    }

    enum Failure: LocalizedError {
        case denied
        case noDisplay
        case appGone(String)
        var errorDescription: String? {
            switch self {
            case .denied:
                return "Four Notes needs permission to hear your call. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then try again."
            case .noDisplay: return "Couldn't find a display to record the sound of."
            case .appGone(let name): return "\(name) isn't open any more."
            }
        }
    }

    /// Apps people call from, first in the picker when they're open.
    nonisolated static let callApps: [String] = [
        "us.zoom.xos", "net.whatsapp.WhatsApp", "com.microsoft.teams2", "com.microsoft.teams", "com.apple.FaceTime",
        "com.tinyspeck.slackmacgap", "com.hnc.Discord", "ru.keepcoder.Telegram", "com.google.Chrome",
        "com.apple.Safari", "company.thebrowser.Browser", "com.microsoft.edgemac", "org.mozilla.firefox",
    ]

    private let writer: ChannelWriter
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "fournotes.talk.system-audio", qos: .userInitiated)
    /// Called if the stream stops on its own (the app quit, permission was taken back).
    var onStop: (@Sendable (Error?) -> Void)?

    init(writer: ChannelWriter) {
        self.writer = writer
    }

    /// The apps with a window open, call apps first. Asking for these is what brings up
    /// the permission prompt the first time.
    static func apps() async throws -> [App] {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            throw denied(error) ? Failure.denied : error
        }
        let me = Bundle.main.bundleIdentifier
        let withWindows = Set(content.windows.compactMap { $0.owningApplication?.bundleIdentifier })
        var seen = Set<String>()
        let apps = content.applications
            .filter { !$0.bundleIdentifier.isEmpty && $0.bundleIdentifier != me && withWindows.contains($0.bundleIdentifier) }
            .filter { seen.insert($0.bundleIdentifier).inserted }
            .map { App(bundleId: $0.bundleIdentifier, name: $0.applicationName) }
        let rank = { (app: App) in callApps.firstIndex(of: app.bundleId) ?? Int.max }
        return apps.sorted { rank($0) != rank($1) ? rank($0) < rank($1) : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Starts hearing `app`, or every app when nil.
    func start(app: App?) async throws {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            throw Self.denied(error) ? Failure.denied : error
        }
        guard let display = content.displays.first else { throw Failure.noDisplay }
        let filter: SCContentFilter
        if let app {
            guard let running = content.applications.first(where: { $0.bundleIdentifier == app.bundleId }) else {
                throw Failure.appGone(app.name)
            }
            filter = SCContentFilter(display: display, including: [running], exceptingWindows: [])
        } else {
            let me = content.applications.filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
            filter = SCContentFilter(display: display, excludingApplications: me, exceptingWindows: [])
        }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1
        // The screen is required but unused: as small and as rare as it goes.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        do {
            try await stream.startCapture()
        } catch {
            throw Self.denied(error) ? Failure.denied : error
        }
        self.stream = stream
    }

    func stop() async {
        guard let stream else { return }
        self.stream = nil
        try? await stream.stopCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, let pcm = Self.pcm(sampleBuffer) else { return }
        let time = sampleBuffer.presentationTimeStamp.seconds
        writer.write(pcm, at: time.isFinite ? time : AVAudioTime.seconds(forHostTime: mach_absolute_time()))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onStop?(Self.denied(error) ? Failure.denied : error)
    }

    private static func denied(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == SCStreamErrorDomain && e.code == SCStreamError.userDeclined.rawValue
    }

    private static func pcm(_ sample: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let description = sample.formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
              let format = AVAudioFormat(streamDescription: asbd) else { return nil }
        let count = CMSampleBufferGetNumSamples(sample)
        guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else { return nil }
        buffer.frameLength = AVAudioFrameCount(count)
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(count),
                                                                  into: buffer.mutableAudioBufferList)
        return status == noErr ? buffer : nil
    }
}
