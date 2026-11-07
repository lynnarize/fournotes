import Foundation
import Testing
@testable import FourNotes

// Meeting notes: when each line was written, Enhance's answer read and checked, the
// Markdown it becomes, old talks still opening, and long talks read in pieces.

private func talk(_ segments: [(String, Double, Double, String)]) -> Talk {
    var t = Talk(title: "Weekly sync", mode: .call, app: "Zoom", lang: "en-US")
    t.segments = segments.map { TalkSegment(speaker: $0.0, start: $0.1, end: $0.2, text: $0.3) }
    t.duration = segments.map(\.2).max() ?? 0
    t.status = .done
    return t
}

@Suite("When each note was written")
struct NoteTimesTests {
    @Test("Keys ignore list marks, case and spacing")
    func keys() {
        #expect(NoteTimes.key("• Budi  Sends the DECK!") == "budi sends the deck")
        #expect(NoteTimes.key("☐ book table") == "book table")
        #expect(NoteTimes.key("2. Second") == "second")
        #expect(NoteTimes.key("## Budget") == "budget")
        #expect(NoteTimes.key("   ").isEmpty)
    }

    @Test("A line typed letter by letter keeps the time it was started; a new line gets now")
    func typing() {
        var times: [String: Double] = [:]
        var text = ""
        for (i, next) in ["b", "bu", "budget", "budget tight"].enumerated() {
            times = NoteTimes.update(times, old: text, new: next, now: 60 + Double(i))
            text = next
        }
        #expect(times == ["budget tight": 60])
        times = NoteTimes.update(times, old: text, new: text + "\nask Budi", now: 200)
        #expect(times == ["budget tight": 60, "ask budi": 200])
    }

    @Test("A line changed in the middle keeps its time; a line deleted drops it")
    func editing() {
        let times = ["budget tight": 60.0, "ask budi": 200]
        let edited = NoteTimes.update(times, old: "budget tight\nask Budi", new: "budget is tight\nask Budi", now: 900)
        #expect(edited == ["budget is tight": 60, "ask budi": 200])
        let deleted = NoteTimes.update(edited, old: "budget is tight\nask Budi", new: "ask Budi", now: 900)
        #expect(deleted == ["ask budi": 200])
    }

    @Test("Lines written after the talk have no time")
    func afterwards() {
        let times = NoteTimes.update(["budget tight": 60], old: "budget tight", new: "budget tight\nlater thought", now: nil)
        #expect(times == ["budget tight": 60])
    }

    @Test("A talk's note lines carry their times")
    func noteLines() {
        var t = talk([])
        t.notes = "• budget tight\n\nask Budi"
        t.noteTimes = ["budget tight": 61]
        let lines = TalkText.noteLines(t)
        #expect(lines.map(\.text) == ["• budget tight", "ask Budi"])
        #expect(lines.map(\.at) == [61, nil])
    }
}

@Suite("Enhance")
struct TalkEnhanceTests {
    @Test("Times as a model writes them")
    func seconds() {
        #expect(TalkText.seconds("12:04") == 724)
        #expect(TalkText.seconds("[1:02:05]") == 3725)
        #expect(TalkText.seconds("0:75") == nil)
        #expect(TalkText.seconds("soon") == nil)
        #expect(TalkText.seconds("12") == nil)
    }

    @Test("The model's JSON is read, times and depths in any of their forms")
    func parse() {
        let text = """
        Here are the notes:
        ```json
        {"sections": [
          {"heading": "Budget", "lines": [
            {"text": "budget tight", "mine": true, "at": "1:00"},
            {"text": "40M for ads in October", "mine": false, "at": 75, "depth": 1},
            {"text": "Ads moved to November", "mine": "false", "at": "[0:02:10]", "sub": true},
            "A bare line"
          ]},
          {"heading": "", "lines": [{"text": "orphan"}]},
          {"heading": "Empty", "lines": []}
        ]}
        ```
        """
        let sections = TalkEnhance.parse(text)
        #expect(sections?.count == 1)
        let lines = sections?.first?.lines ?? []
        #expect(lines.map(\.text) == ["budget tight", "40M for ads in October", "Ads moved to November", "A bare line"])
        #expect(lines.map(\.mine) == [true, false, false, false])
        #expect(lines.map(\.at) == [60, 75, 130, nil])
        #expect(lines.map(\.depth) == [0, 1, 1, 0])
        #expect(TalkEnhance.parse("no json") == nil)
        #expect(TalkEnhance.parse(#"{"sections": []}"#) == nil)
    }

    @Test("A line is yours only when you wrote it, in your words; lines left out are kept; times outside the talk go")
    func reconcile() {
        let yours: [(text: String, at: Double?)] = [("# Budget", 5), ("• budget tight", 60), ("ask Budi re deck", 200), ("call Sari", 300)]
        let model: [TalkNotes.Section] = [
            .init(heading: "Budget", lines: [
                .init(text: "Budget tight.", mine: true, at: nil),
                .init(text: "40M for ads", mine: true, at: 75),
                .init(text: "ask budi re deck", mine: false, at: 9_999),
            ]),
        ]
        let out = TalkNotes.reconciled(model, yours: yours, duration: 600)
        #expect(out.map(\.heading) == ["Budget", "Also in your notes"])
        let lines = out[0].lines
        // Your words, your time where the model gave none.
        #expect(lines[0] == .init(text: "budget tight", mine: true, at: 60))
        // The model called it yours; you didn't write it.
        #expect(lines[1].mine == false)
        // Yours word for word, though the model said otherwise; the time was past the end.
        #expect(lines[2] == .init(text: "ask Budi re deck", mine: true, at: 200))
        #expect(out[1].lines == [.init(text: "call Sari", mine: true, at: 300)])
    }

    @Test("The prompt carries the template's sections and your notes with their times")
    func prompt() {
        let input = TalkEnhance.Input(title: "Sync", when: "Today", app: "Zoom", speakers: [("me", "You"), ("them", "Them")],
                                      template: .standup, notes: [("budget tight", 61), ("later", nil)],
                                      transcript: "[0:00] You: Hi.")
        let text = TalkEnhance.prompt(input, limit: 1_000)
        #expect(text.contains("Done, Next, Blockers"))
        #expect(text.contains("[1:01] budget tight\nlater"))
        #expect(text.contains("It was a standup."))
        var none = input
        none.notes = []
        #expect(TalkEnhance.prompt(none, limit: 1_000).contains("They wrote no notes"))
    }
}

@Suite("Meeting notes as Markdown and on disk")
struct TalkNotesFormatTests {
    private let notes = TalkNotes(sections: [
        .init(heading: "Decisions", lines: [.init(text: "Launch in May", mine: true, at: 10),
                                            .init(text: "Budi owns the date", mine: false, at: 12, depth: 1)]),
        .init(heading: "Next steps", lines: [.init(text: "Sari: send the deck", mine: false, at: nil)]),
    ], template: "general", basedOn: "launch may", createdAt: "2026-10-22T10:00:00.000Z")

    @Test("Markdown: a heading per section, details indented")
    func markdown() {
        #expect(notes.markdown == "## Decisions\n- Launch in May\n  - Budi owns the date\n\n## Next steps\n- Sari: send the deck")
    }

    @Test("Save to Notes puts the notes first: Enhance's, else yours")
    func note() {
        var t = talk([("me", 0, 2, "Hi.")])
        t.notes = "launch may"
        #expect(TalkText.note(t).contains("## Your notes\nlaunch may"))
        t.enhanced = notes
        let note = TalkText.note(t)
        #expect(note.contains("## Decisions\n- Launch in May"))
        #expect(!note.contains("## Your notes"))
        #expect(note.range(of: "## Decisions")!.lowerBound < note.range(of: "## Transcript")!.lowerBound)
    }

    @Test("Notes count for search and the assistant's passages")
    func search() {
        var t = talk([("me", 0, 2, "Hi.")])
        t.enhanced = notes
        #expect(TalkText.matches(t, "launch may"))
        #expect(TalkText.passages([t], query: "When is the launch?").first?.text.contains("Meeting notes") == true)
    }

    @Test("A talk saved before notes existed still opens, and the notes survive a round trip")
    func decoding() throws {
        let old = #"""
        [{"id":"t1","createdAt":"2026-10-01T09:00:00.000Z","updatedAt":"2026-10-01T09:30:00.000Z","title":"Old talk",
          "mode":"room","lang":"en-US","duration":60,"status":"done","segments":[],"names":{},"hasAudio":false}]
        """#
        let talks = try JSONDecoder().decode([Talk].self, from: Data(old.utf8))
        #expect(talks.first?.notes == nil)
        #expect(talks.first?.enhanced == nil)
        #expect(talks.first?.template == nil)
        #expect(talks.first?.wantsNotes == false)

        var t = talks[0]
        t.notes = "launch may"
        t.noteTimes = ["launch may": 10]
        t.template = TalkTemplate.planning.rawValue
        t.enhanced = notes
        let back = try JSONDecoder().decode(Talk.self, from: JSONEncoder().encode(t))
        #expect(back == t)
        #expect(back.wantsNotes)
    }

    @Test("Notes written differently by a later version are read as far as they can be")
    func lenient() throws {
        let json = #"{"sections":[{"heading":"A","lines":[{"text":"kept"},{"mine":true},{"text":"also kept","at":"soon"}]},{"lines":"odd"}],"extra":1}"#
        let n = try JSONDecoder().decode(TalkNotes.self, from: Data(json.utf8))
        #expect(n.sections.first?.lines.map(\.text) == ["kept", "also kept"])
        #expect(n.sections.first?.lines.last?.at == nil)
        #expect(n.template == "general")
    }
}

@Suite("Long talks in pieces")
@MainActor
struct TalkPiecesTests {
    private let transcript = (0..<40).map { "[\($0):00] Speaker A: point number \($0) about the launch plan" }.joined(separator: "\n")

    @Test("Pieces stay under the limit, cut between lines, and keep every line")
    func split() {
        let pieces = TalkPieces.split(transcript, limit: 300)
        #expect(pieces.count > 1)
        #expect(pieces.allSatisfy { $0.count <= 300 })
        #expect(pieces.joined(separator: "\n") == transcript)
        let long = String(repeating: "x", count: 250)
        #expect(TalkPieces.split(long, limit: 100).map(\.count) == [100, 100, 50])
    }

    @Test("A talk that fits is read whole; a long one as notes on each piece")
    func fitted() async throws {
        var asked = 0
        let short = try await TalkPieces.fitted("[0:00] A: hi", limit: 300) { _ in asked += 1; return "" }
        #expect(short.text == "[0:00] A: hi")
        #expect(!short.condensed)
        #expect(asked == 0)

        let long = try await TalkPieces.fitted(transcript, limit: 300) { prompt in
            asked += 1
            return "Here are the notes:\n- [\(asked):00] A: piece \(asked)"
        }
        #expect(long.condensed)
        #expect(asked == TalkPieces.split(transcript, limit: 300).count)
        #expect(long.text.hasPrefix("[1:00] A: piece 1\n[2:00] A: piece 2"))
        #expect(!long.text.contains("Here are"))
    }

    @Test("A piece the model won't take is left out; when none can be read, it says why")
    func failures() async throws {
        struct Refused: Error {}
        var asked = 0
        let some = try await TalkPieces.fitted(transcript, limit: 300) { _ in
            asked += 1
            if asked == 1 { throw Refused() }
            return "[0:00] A: kept"
        }
        #expect(some.condensed)
        #expect(!some.text.isEmpty)
        await #expect(throws: Refused.self) {
            _ = try await TalkPieces.fitted(transcript, limit: 300) { _ in throw Refused() }
        }
    }

    @Test("Notes still too long are taken down again")
    func twice() async throws {
        var rounds: Set<Int> = []
        let result = try await TalkPieces.fitted(transcript, limit: 300) { prompt in
            // The first round's notes on each piece are long; the second round's short.
            let second = prompt.contains("note round 1")
            rounds.insert(second ? 2 : 1)
            return second ? "[0:00] A: short" : String(repeating: "[0:00] A: note round 1 ", count: 6)
        }
        #expect(rounds == [1, 2])
        #expect(result.text.count <= 300)
        #expect(result.condensed)
    }
}
