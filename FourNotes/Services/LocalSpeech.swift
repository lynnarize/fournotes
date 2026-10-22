import Foundation
import SpeakerKit
import WhisperKit

// Transcribing a recording on this Mac with the models from SpeechModels: Whisper
// for the words, and, when it's installed, SpeakerKit for who said them. Nothing
// leaves the Mac and nothing is downloaded here: both load from their folders.
//
// The models are loaded for each recording and let go after, so they don't sit in
// memory between recordings. Loading takes seconds once Core ML has compiled them
// for this Mac, which `prepare` does right after the download.

enum LocalSpeech {
    struct Transcript: Sendable {
        var text: String
        /// How many people were told apart (0 without the speaker model).
        var speakers: Int
    }

    enum Failure: LocalizedError {
        case empty
        var errorDescription: String? { "Nothing was heard in that recording." }
    }

    /// Loads a freshly downloaded model once, so Core ML compiles it for this Mac
    /// now (a minute or two) rather than on the first recording.
    static func prepare(_ pack: SpeechModels.Pack, in folder: URL) async {
        do {
            switch pack.kind {
            case .whisper: _ = try await whisper(folder, prewarm: true)
            case .speakers: _ = try await speakers(folder, load: true)
            }
        } catch {
            // Nothing lost: it compiles on first use instead.
            print("[speech] couldn't prepare \(pack.id): \(error.localizedDescription)")
        }
    }

    /// One stretch of speech: who (an index from the speaker model, nil when voices
    /// weren't told apart), when, and what.
    struct Piece: Sendable, Equatable {
        var speaker: Int?
        var start: Double
        var end: Double
        var text: String
    }

    /// The recording piece by piece, with times, and voices told apart when the speaker
    /// model is there and hears more than one. For Transcribe's talks.
    static func pieces(_ audio: URL, whisperFolder: URL, speakersFolder: URL?) async throws -> (pieces: [Piece], speakers: Int) {
        let samples = try AudioProcessor.loadAudioAsFloatArray(fromPath: audio.path)
        let results = try await words(samples, whisperFolder: whisperFolder, timed: speakersFolder != nil)
        let plain = results.flatMap(\.segments).map { Piece(speaker: nil, start: Double($0.start), end: Double($0.end), text: clean($0.text)) }
            .filter { !$0.text.isEmpty }
        guard !plain.isEmpty else { throw Failure.empty }
        guard let speakersFolder else { return (plain, 0) }
        do {
            let diarizer = try await speakers(speakersFolder, load: false)
            let diarization = try await diarizer.diarize(audioArray: samples)
            guard diarization.speakerCount > 1 else { return (plain, diarization.speakerCount) }
            var out: [Piece] = []
            for segment in diarization.addSpeakerInfo(to: results).flatMap({ $0 }) {
                let text = clean(segment.text)
                guard !text.isEmpty else { continue }
                let speaker: Int?
                switch segment.speaker {
                case .speakerId(let id): speaker = id
                case .multiple(let ids): speaker = ids.first
                case .noMatch: speaker = out.last?.speaker
                @unknown default: speaker = out.last?.speaker
                }
                out.append(Piece(speaker: speaker, start: Double(segment.startTime), end: Double(segment.endTime), text: text))
            }
            return (out.isEmpty ? plain : out, diarization.speakerCount)
        } catch {
            print("[speech] speaker separation failed: \(error.localizedDescription)")
            return (plain, 0)
        }
    }

    private static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: #"<\|[^|]*\|>"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func words(_ samples: [Float], whisperFolder: URL, timed: Bool) async throws -> [TranscriptionResult] {
        let kit = try await whisper(whisperFolder, prewarm: false)
        let options = DecodingOptions(
            task: .transcribe,
            // Each stretch's language is detected: talks here switch between Indonesian and English.
            language: nil,
            detectLanguage: true,
            skipSpecialTokens: true,
            wordTimestamps: timed,
            chunkingStrategy: .vad
        )
        return try await kit.transcribe(audioArray: samples, decodeOptions: options)
    }

    /// The recording as text, with "Speaker 1:" lines when the speaker model is there.
    static func transcribe(_ audio: URL, whisperFolder: URL, speakersFolder: URL?) async throws -> Transcript {
        let samples = try AudioProcessor.loadAudioAsFloatArray(fromPath: audio.path)
        let results = try await words(samples, whisperFolder: whisperFolder, timed: speakersFolder != nil)
        let plain = results.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !plain.isEmpty else { throw Failure.empty }

        guard let speakersFolder else { return Transcript(text: plain, speakers: 0) }
        do {
            let diarizer = try await speakers(speakersFolder, load: false)
            let diarization = try await diarizer.diarize(audioArray: samples)
            let lines = turns(diarization.addSpeakerInfo(to: results))
            guard diarization.speakerCount > 1, !lines.isEmpty else { return Transcript(text: plain, speakers: diarization.speakerCount) }
            return Transcript(text: lines.joined(separator: "\n"), speakers: diarization.speakerCount)
        } catch {
            // Who said what is a bonus: the words alone still make the note.
            print("[speech] speaker separation failed: \(error.localizedDescription)")
            return Transcript(text: plain, speakers: 0)
        }
    }

    /// "Speaker 1: …" lines, consecutive pieces from the same person joined into one turn.
    private static func turns(_ groups: [[SpeakerSegment]]) -> [String] {
        var out: [(speaker: String, text: String)] = []
        for segment in groups.flatMap({ $0 }) {
            let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            let speaker: String
            switch segment.speaker {
            case .speakerId(let id): speaker = "Speaker \(id + 1)"
            case .multiple(let ids): speaker = ids.map { "Speaker \($0 + 1)" }.joined(separator: " & ")
            case .noMatch: speaker = out.last?.speaker ?? "Speaker"
            @unknown default: speaker = out.last?.speaker ?? "Speaker"
            }
            if out.last?.speaker == speaker { out[out.count - 1].text += " " + text } else { out.append((speaker, text)) }
        }
        return out.map { "\($0.speaker): \($0.text)" }
    }

    private static func whisper(_ folder: URL, prewarm: Bool) async throws -> WhisperKit {
        let config = WhisperKitConfig(
            modelFolder: folder.path,
            // The tokenizer was downloaded into the model's folder: no fetching here.
            tokenizerFolder: folder,
            verbose: false,
            logLevel: .error,
            prewarm: prewarm,
            load: true,
            download: false
        )
        return try await WhisperKit(config)
    }

    private static func speakers(_ folder: URL, load: Bool) async throws -> SpeakerKit {
        let config = PyannoteConfig(modelFolder: folder.path, download: false, load: load, verbose: false, logLevel: .error)
        return try await SpeakerKit(config)
    }
}
