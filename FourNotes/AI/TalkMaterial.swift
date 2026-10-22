import Foundation

// What a model reads of a talk to answer about it (a chat, a recipe), fitted to the room
// it has. A finished talk: your notes as Enhance wrote them and the write-up, then the
// transcript, read in pieces first when it's long (TalkPieces). A talk still going on:
// your notes so far, the latest part as it was said, and notes on what came before, made
// a piece at a time as the talk grows and kept, so a question doesn't read it all again.

enum TalkMaterial {
    /// Characters of a talk each model is given with a question: Apple's has room for
    /// little beside the passages and the answer.
    static let appleRoom = 3_000
    static let providerRoom = 16_000
    static let claudeRoom = 150_000

    /// The talk for a prompt, within `limit` characters. `ask` is the same model, for
    /// notes on the parts that don't fit.
    @MainActor
    static func text(_ talk: Talk, live: Bool, limit: Int,
                     ask: @MainActor (String) async throws -> String) async throws -> String {
        live ? try await liveText(talk, limit: limit, ask: ask) : try await finishedText(talk, limit: limit, ask: ask)
    }

    /// Whole lines from the end of `transcript`, up to `recent` characters, and the lines
    /// before them. A last line longer than that is cut to its end.
    static func cut(_ transcript: String, recent: Int) -> (earlier: [String], recent: String) {
        let lines = transcript.components(separatedBy: .newlines).filter { !$0.isEmpty }
        var kept: [String] = []
        var length = 0
        for line in lines.reversed() {
            if kept.isEmpty, line.count > recent { return (Array(lines.dropLast()), String(line.suffix(recent))) }
            guard length + line.count + 1 <= recent else { break }
            kept.insert(line, at: 0)
            length += line.count + 1
        }
        return (Array(lines.dropLast(kept.count)), kept.joined(separator: "\n"))
    }

    /// Your notes while the talk runs, for the model to know what you've written.
    static func notesBlock(_ talk: Talk, limit: Int) -> String {
        let notes = (talk.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return notes.isEmpty ? "" : "The notes they're writing:\n<notes>\n\(notes.prefix(limit))\n</notes>\n"
    }

    // MARK: - Still going on

    private struct Earlier {
        /// How many lines of the transcript the notes cover.
        var lines: Int
        var notes: [String]
    }

    /// Notes on each live talk's earlier part, by talk and room.
    @MainActor private static var earlier: [String: Earlier] = [:]

    @MainActor
    private static func liveText(_ talk: Talk, limit: Int, ask: @MainActor (String) async throws -> String) async throws -> String {
        let yours = notesBlock(talk, limit: limit / 5)
        let transcript = TalkText.transcript(talk)
        let room = max(1_000, limit - yours.count)
        guard transcript.count > room else { return yours + "<transcript>\n\(transcript)\n</transcript>" }

        let (before, recent) = cut(transcript, recent: room * 3 / 5)
        let key = "\(talk.id)|\(limit)"
        var kept = earlier[key] ?? Earlier(lines: 0, notes: [])
        // Fewer lines than before: the transcript was redone. Start again.
        if before.count < kept.lines { kept = Earlier(lines: 0, notes: []) }
        if before.count > kept.lines {
            let fresh = before[kept.lines...].joined(separator: "\n")
            let pieces = TalkPieces.split(fresh, limit: room)
            for (i, piece) in pieces.enumerated() {
                do {
                    kept.notes.append(TalkPieces.lines(try await ask(TalkPieces.prompt(piece, part: i + 1, of: pieces.count))))
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    // A piece the model won't take is left out; the latest part is still there.
                }
            }
            kept.lines = before.count
            earlier[key] = kept
        }
        let notes = kept.notes.filter { !$0.isEmpty }.joined(separator: "\n")
        let noteRoom = max(0, room - recent.count - 120)
        let shown = notes.count > noteRoom ? String(notes.suffix(noteRoom)) : notes
        return yours
            + (shown.isEmpty ? "" : "Notes on the earlier part, in order, with the time and who said each point:\n<notes>\n\(shown)\n</notes>\n")
            + "The latest part, as it was said:\n<transcript>\n\(recent)\n</transcript>"
    }

    // MARK: - Finished

    /// Long transcripts read in pieces, by talk, room and length, so a second question or
    /// recipe doesn't read them again.
    @MainActor private static var condensed: [String: (text: String, condensed: Bool)] = [:]

    @MainActor
    private static func finishedText(_ talk: Talk, limit: Int, ask: @MainActor (String) async throws -> String) async throws -> String {
        var head: [String] = []
        if let e = talk.enhanced, !e.sections.isEmpty {
            head.append("Their meeting notes:\n" + e.markdown)
        } else if let notes = talk.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
            head.append("The notes they wrote:\n" + notes)
        }
        if let s = talk.summary {
            var lines = ["The write-up: \(s.text)"]
            if !s.keyPoints.isEmpty { lines.append("Key points: " + s.keyPoints.joined(separator: "; ")) }
            if !s.actionItems.isEmpty { lines.append("Action items: " + s.actionItems.joined(separator: "; ")) }
            head.append(lines.joined(separator: "\n"))
        }
        let top = String(head.joined(separator: "\n\n").prefix(limit / 3))
        let room = max(1_000, limit - top.count)
        let transcript = TalkText.transcript(talk)
        let key = "\(talk.id)|\(room)|\(transcript.count)"
        let fitted: (text: String, condensed: Bool)
        if let cached = condensed[key] {
            fitted = cached
        } else {
            fitted = try await TalkPieces.fitted(transcript, limit: room, ask: ask)
            if fitted.condensed { condensed[key] = fitted }
        }
        return (top.isEmpty ? "" : top + "\n\n") + TalkWriteUp.transcriptBlock(fitted.text, condensed: fitted.condensed, limit: room)
    }
}
