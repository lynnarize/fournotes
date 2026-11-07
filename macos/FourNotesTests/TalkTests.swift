import AVFoundation
import Foundation
import Testing
@testable import FourNotes

// Transcribe's talks: who's who, turns, search and the note a talk becomes; the store on
// disk; the channel writer's clock; and Apple's speech model hearing synthesized speech,
// live as a recording does and from a file as an import does.

private func talk(_ segments: [(String, Double, Double, String)], mode: Talk.Mode = .call, names: [String: String] = [:]) -> Talk {
    var t = Talk(title: "Weekly sync", mode: mode, app: mode == .call ? "Zoom" : nil, lang: "en-US")
    t.segments = segments.map { TalkSegment(speaker: $0.0, start: $0.1, end: $0.2, text: $0.3) }
    t.names = names
    t.duration = segments.map(\.2).max() ?? 0
    t.status = .done
    return t
}

@Suite("Talk transcripts")
struct TalkTextTests {
    @Test("Lines from the same person close together are one turn; names default by channel")
    func turns() {
        let t = talk([("me", 0, 2, "Hi Budi."), ("me", 2.5, 4, "Did you book it?"), ("them", 5, 8, "Yes, for seven."),
                      ("me", 20, 22, "Great.")])
        let turns = TalkText.turns(t)
        #expect(turns.map(\.name) == ["You", "Them", "You"])
        #expect(turns[0].text == "Hi Budi. Did you book it?")
        #expect(TalkText.transcript(t).hasPrefix("[0:00] You: Hi Budi. Did you book it?\n[0:05] Them: Yes, for seven."))
    }

    @Test("Giving two speakers the same name merges them")
    func merge() {
        let t = talk([("A", 0, 10, "One."), ("B", 10, 15, "Two."), ("C", 15, 30, "Three.")], mode: .room,
                     names: ["A": "Andi", "C": "andi"])
        let people = TalkText.speakers(t)
        #expect(people.map(\.name) == ["Andi", "Speaker B"])
        #expect(people[0].ids == ["A", "C"])
        #expect(people[0].seconds == 25)
        #expect(TalkText.name(t, "them:B") == "Caller B")
    }

    @Test("Clock")
    func clock() {
        #expect(TalkText.clock(75) == "1:15")
        #expect(TalkText.clock(3725) == "1:02:05")
        #expect(TalkText.clock(.nan) == "0:00")
    }

    @Test("Search matches every word; passages rank the talk that's about it first")
    func search() {
        var budget = talk([("me", 0, 5, "Let's settle the marketing budget for October."), ("them", 6, 12, "Forty million for ads.")])
        budget.title = "Budget call"
        let lunch = talk([("me", 0, 5, "Where should we have lunch tomorrow?"), ("them", 6, 9, "The bakmi place.")])
        #expect(TalkText.matches(budget, "marketing october"))
        #expect(!TalkText.matches(lunch, "marketing october"))
        let found = TalkText.passages([lunch, budget], query: "How much was the marketing budget?")
        #expect(found.first?.talk.title == "Budget call")
        #expect(found.first?.text.contains("Forty million") == true)
        #expect(TalkText.passages([lunch, budget], query: "the and was").isEmpty)
    }

    @Test("The note: summary, action items as a checklist, people, then the transcript")
    func note() {
        var t = talk([("me", 0, 2, "Bring the cake."), ("them:A", 3, 6, "I will, Andi here.")], names: ["them:A": "Andi"])
        t.summary = TalkSummary(text: "Planning the party.", keyPoints: ["Saturday at seven"], actionItems: ["Andi: bring the cake"],
                                people: [.init(speaker: "them:A", profile: "Brings the cake.")])
        let note = TalkText.note(t)
        #expect(note.contains("## Summary\nPlanning the party."))
        #expect(note.contains("## Action items\n☐ Andi: bring the cake"))
        #expect(note.contains("## People\n- Andi: Brings the cake."))
        #expect(note.hasSuffix("## Transcript\n[0:00] You: Bring the cake.\n[0:03] Andi: I will, Andi here."))
        // The note editor reads the checklist and headings back as such.
        #expect(NoteDocument.attributed(fromPlainText: note).string.contains("Action items"))
    }

    @Test("A model's write-up is read from JSON, wrapped or not")
    func writeUp() {
        let text = """
        Here you go:
        ```json
        {"title":"Party plan","summary":"They plan a party.","keyPoints":["Sat 7pm"],"actionItems":["Book the table"],
         "people":[{"id":"them","name":"Budi","profile":"Booked it."}]}
        ```
        """
        let w = TalkWriteUp.parse(text)
        #expect(w?.title == "Party plan")
        #expect(w?.actionItems == ["Book the table"])
        #expect(w?.people.first?.name == "Budi")
        #expect(TalkWriteUp.parse("no json here") == nil)
        #expect(TalkWriteUp.parse(AIEngine.encode(w!)) == w)
    }
}

@MainActor
@Suite("Talk store", .serialized)
struct TalkStoreTests {
    @Test("Saves to disk, reads back, deletes softly, and purges old deletions with their recording")
    func roundTrip() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("talks-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = TalkStore(root: root)
        var a = talk([("me", 0, 1, "Hello")])
        a.spaceId = "work"
        let old = talk([("me", 0, 1, "Old")])
        store.add(a)
        store.add(old)
        try FileManager.default.createDirectory(at: store.folder(old.id), withIntermediateDirectories: true)
        store.update(a.id) { $0.names["them"] = "Budi" }
        store.update(old.id) { $0.deletedAt = DateKit.iso(Date().addingTimeInterval(-8 * 86_400)) }
        store.flush()

        let again = TalkStore(root: root)
        #expect(again.talk(a.id)?.names["them"] == "Budi")
        #expect(again.live(in: "work").map(\.id) == [a.id])
        #expect(again.live(in: nil).isEmpty)
        #expect(again.talk(old.id) == nil)
        #expect(!FileManager.default.fileExists(atPath: again.folder(old.id).path))

        again.remove(a.id)
        #expect(again.live(in: "work").isEmpty)
        again.update(a.id) { $0.deletedAt = nil }
        #expect(again.live(in: "work").count == 1)
        again.discard(a.id)
        #expect(again.talk(a.id) == nil)
    }
}

@Suite("Channel writer")
struct ChannelWriterTests {
    @Test("A gap between buffers is written as silence, so the file keeps the wall clock's time")
    func gaps() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("channel-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try ChannelWriter(url: url, channel: "them")
        // A second of tone at 44.1 kHz stereo (converted on the way in), then two seconds
        // of nothing, then another second.
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!
        let tone = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100)!
        tone.frameLength = 44_100
        for c in 0..<2 { for i in 0..<44_100 { tone.floatChannelData![c][i] = 0.3 * sin(Float(i) * 0.06) } }
        writer.write(tone, at: 100)
        #expect(writer.takeLevel() > 0.3)
        writer.write(tone, at: 103)
        #expect(abs(writer.seconds - 4) < 0.05)
        #expect(writer.startedAt == 100)
        writer.close()
        let file = try AVAudioFile(forReading: url)
        #expect(abs(Double(file.length) / file.processingFormat.sampleRate - 4) < 0.1)
    }
}

/// Apple's speech model needs its English model on this Mac; the first run downloads it.
@MainActor
@Suite("Apple's speech model hears a talk", .serialized)
struct AppleSpeechTalkTests {
    private let lines = [
        "Hi Budi, did you book the table at the restaurant for Saturday?",
        "Yes, I booked it for seven in the evening. Can you bring the birthday cake?",
    ]

    @Test("Live captions, fed as a recording feeds them, give timed final words")
    func live() async throws {
        let speech = FileManager.default.temporaryDirectory.appendingPathComponent("talk-live-\(UUID().uuidString).caf")
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("talk-live-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: speech); try? FileManager.default.removeItem(at: out) }
        try await synthesize(lines, to: speech)

        let heard = Heard()
        let captions = try await LiveCaptions.start(locale: Locale(identifier: "en-US")) { text, start, end, final in
            if final { heard.add(text, start, end) }
        }
        let writer = try ChannelWriter(url: out, channel: "room")
        writer.onBuffer = { captions.feed($0) }
        // In pieces the size the microphone delivers, as quickly as it can be read.
        let file = try AVAudioFile(forReading: speech)
        let chunk: AVAudioFrameCount = 4096
        var at = 0.0
        while file.framePosition < file.length {
            let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk)!
            try file.read(into: buffer, frameCount: chunk)
            writer.write(buffer, at: at)
            at += Double(buffer.frameLength) / file.processingFormat.sampleRate
        }
        writer.close()
        await captions.finish()

        let text = heard.text.lowercased()
        print("TALK | live: \(heard.text)")
        #expect(text.contains("table") || text.contains("restaurant"))
        #expect(text.contains("cake"))
        #expect(heard.lastEnd > 3)
        #expect(abs(writer.seconds - at) < 0.2)
    }

    @Test("A file is transcribed phrase by phrase, with times")
    func file() async throws {
        let speech = FileManager.default.temporaryDirectory.appendingPathComponent("talk-file-\(UUID().uuidString).caf")
        defer { try? FileManager.default.removeItem(at: speech) }
        try await synthesize(lines, to: speech)
        let pieces = try await AppleSpeech.transcribe(speech, locale: Locale(identifier: "en-US"))
        print("TALK | file: \(pieces.map(\.text).joined(separator: " | "))")
        #expect(!pieces.isEmpty)
        #expect(pieces.map(\.text).joined(separator: " ").lowercased().contains("cake"))
        #expect(zip(pieces, pieces.dropFirst()).allSatisfy { $0.start <= $1.start })
    }
}

@MainActor
@Suite("Transcribing a file", .serialized)
struct TalkImportTests {
    @Test("A file becomes a talk: copied in, transcribed on this Mac, timed, searchable")
    func importFile() async throws {
        let speech = FileManager.default.temporaryDirectory.appendingPathComponent("Dinner plans.caf")
        defer { try? FileManager.default.removeItem(at: speech) }
        try await synthesize(["Can you bring the birthday cake on Saturday?", "Sure, I will bring the chocolate cake."], to: speech)

        let recorder = TalkRecorder.shared
        let id = try await recorder.importFile(speech, lang: "en-US")
        let store = TalkStore.shared
        #expect(store.talk(id)?.title == "Dinner plans")
        #expect(store.talk(id)?.mode == .upload)
        #expect(store.audio(id)?.lastPathComponent == "talk.m4a")

        let deadline = Date().addingTimeInterval(600)
        while store.talk(id)?.status != .done || recorder.working[id] != nil {
            if Date() > deadline { Issue.record("Transcribing took too long"); return }
            try await Task.sleep(for: .milliseconds(200))
        }
        let talk = try #require(store.talk(id))
        print("TALK | import (\(talk.engine?.rawValue ?? "none")): \(TalkText.transcript(talk))")
        #expect(talk.problem == nil)
        #expect(talk.duration > 3)
        #expect(TalkText.transcript(talk).lowercased().contains("cake"))
        #expect(TalkText.passages(store.live(in: nil), query: "who brings the chocolate cake").first?.talk.id == id)
        store.discard(id)
    }
}

private final class Heard: @unchecked Sendable {
    private let lock = NSLock()
    private var parts: [String] = []
    private var end = 0.0
    func add(_ text: String, _ start: Double, _ end: Double) {
        lock.withLock {
            parts.append(text)
            self.end = max(self.end, end)
        }
    }
    var text: String { lock.withLock { parts.joined(separator: " ") } }
    var lastEnd: Double { lock.withLock { end } }
}

/// Speaks each line with the system voice into one file.
private func synthesize(_ lines: [String], to url: URL) async throws {
    let sink = SpeechSink(url: url)
    for line in lines {
        let utterance = AVSpeechUtterance(string: line)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        let synthesizer = AVSpeechSynthesizer()
        let done = OnceFlag()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            synthesizer.write(utterance) { buffer in
                guard let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0 else {
                    if done.first() { continuation.resume() }
                    return
                }
                sink.write(pcm)
            }
        }
    }
    sink.close()
}

private final class SpeechSink: @unchecked Sendable {
    private let url: URL
    private var file: AVAudioFile?
    init(url: URL) { self.url = url }
    func write(_ buffer: AVAudioPCMBuffer) {
        if file == nil {
            file = try? AVAudioFile(forWriting: url, settings: buffer.format.settings,
                                    commonFormat: buffer.format.commonFormat, interleaved: buffer.format.isInterleaved)
        }
        try? file?.write(from: buffer)
    }
    func close() { file = nil }
}

private final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func first() -> Bool { lock.withLock { defer { done = true }; return !done } }
}
