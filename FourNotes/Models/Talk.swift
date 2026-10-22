import Foundation

// A recorded conversation, in person or on a call, with who said what. Ported from
// the web app's Talk (src/lib/types.ts) and its helpers (src/lib/talks/transcript.ts),
// so the two read the same. Talks stay on this Mac (Store/TalkStore.swift); "Save to
// Notes" is how one travels.
//
// Speaker ids: "me" (this Mac's microphone on a call), "them" (the call's sound),
// "them:A" (one voice in it), "A", "B"… (voices in a room), "room" (a room, voices not
// told apart).

struct TalkSegment: Codable, Equatable, Hashable {
    var speaker: String
    /// Seconds from the start of the talk.
    var start: Double
    var end: Double
    var text: String
}

struct TalkSummary: Codable, Equatable {
    struct Person: Codable, Equatable {
        var speaker: String
        var profile: String
    }
    var text: String
    var keyPoints: [String]
    var actionItems: [String]
    /// A short profile of each person: what they said, wanted, agreed to.
    var people: [Person]
}

struct Talk: Codable, Equatable, Identifiable {
    enum Mode: String, Codable { case room, call, upload }
    enum Status: String, Codable { case recording, transcribing, done }
    /// Which engine wrote the transcript, for the line above it.
    enum Engine: String, Codable { case whisper, apple }

    var id: String
    var createdAt: String
    var updatedAt: String
    var deletedAt: String?
    var spaceId: String?
    var title: String
    var mode: Mode
    /// What was recorded on a call: "Zoom", "WhatsApp", or nil for all of this Mac's sound.
    var app: String?
    /// The language spoken, as a locale id ("en-US"), for Apple's recognizer.
    var lang: String
    /// Seconds.
    var duration: Double
    var status: Status
    var engine: Engine?
    /// Why some or all of it couldn't be transcribed, in words.
    var problem: String?
    /// The transcript: live words while recording, then the final one.
    var segments: [TalkSegment]
    /// Names given to speakers ("A" → "Andi"). Giving two speakers the same name merges them.
    var names: [String: String]
    var summary: TalkSummary?
    var noteId: String?
    var hasAudio: Bool
    /// Each recorded channel ("me", "them", "room") and when it began, in seconds from
    /// the start of the talk.
    var channels: [String: Double]?

    init(id: String = UUID().uuidString.lowercased(), createdAt: Date = Date(), title: String, mode: Mode,
         app: String? = nil, lang: String, spaceId: String? = nil) {
        self.id = id
        self.createdAt = DateKit.iso(createdAt)
        self.updatedAt = self.createdAt
        self.title = title
        self.mode = mode
        self.app = app
        self.lang = lang
        self.spaceId = spaceId
        duration = 0
        status = .recording
        segments = []
        names = [:]
        hasAudio = false
    }

    var isAlive: Bool { deletedAt == nil }
}

// MARK: - Who's who

enum TalkText {
    struct Speaker: Equatable {
        var name: String
        var ids: [String]
        var seconds: Double
        var lines: Int
    }

    struct Turn: Equatable {
        var speaker: String
        var name: String
        var start: Double
        var end: Double
        var text: String
    }

    /// The name shown for a speaker: the one given, else a plain default.
    static func name(_ talk: Talk, _ id: String) -> String {
        if let given = talk.names[id]?.trimmingCharacters(in: .whitespaces), !given.isEmpty { return given }
        switch id {
        case "me": return "You"
        case "them": return talk.mode == .call ? "Them" : "Speaker"
        case "room": return "Speaker"
        default:
            if id.hasPrefix("them:") { return "Caller \(id.dropFirst(5))" }
            return "Speaker \(id)"
        }
    }

    /// The speakers, in order of first appearance, merged where they share a name.
    static func speakers(_ talk: Talk) -> [Speaker] {
        var out: [Speaker] = []
        for s in talk.segments {
            let name = name(talk, s.speaker)
            if let i = out.firstIndex(where: { $0.name.lowercased() == name.lowercased() }) {
                if !out[i].ids.contains(s.speaker) { out[i].ids.append(s.speaker) }
                out[i].seconds += max(0, s.end - s.start)
                out[i].lines += 1
            } else {
                out.append(Speaker(name: name, ids: [s.speaker], seconds: max(0, s.end - s.start), lines: 1))
            }
        }
        return out
    }

    /// Lines in a row from the same person read as one turn; a long turn is broken up.
    static func turns(_ talk: Talk) -> [Turn] {
        var out: [Turn] = []
        for s in talk.segments.sorted(by: { $0.start < $1.start || ($0.start == $1.start && $0.end < $1.end) }) {
            let text = s.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            let name = name(talk, s.speaker)
            if var last = out.last, last.name == name, s.start - last.end < 2, last.text.count < 400 {
                last.text += " " + text
                last.end = max(last.end, s.end)
                out[out.count - 1] = last
            } else {
                out.append(Turn(speaker: s.speaker, name: name, start: s.start, end: s.end, text: text))
            }
        }
        return out
    }

    /// 75 → "1:15", 3725 → "1:02:05".
    static func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.isFinite ? seconds : 0))
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    /// "[1:15] Andi: …" lines: for the assistant, a note, a copy.
    static func transcript(_ talk: Talk) -> String {
        turns(talk).map { "[\(clock($0.start))] \($0.name): \($0.text)" }.joined(separator: "\n")
    }

    static func defaultTitle(_ date: Date = Date()) -> String {
        "Talk, " + stamp.string(from: date)
    }

    static func isDefaultTitle(_ title: String) -> Bool {
        title.hasPrefix("Talk, ") || title.hasPrefix("Recording, ") || title.isEmpty
    }

    /// "Tue, Oct 21, 3:40 PM"
    static let stamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "EEE, MMM d, h:mm a"
        return f
    }()

    /// "Tue, Oct 21, 3:40 PM · 12:04 · Zoom"
    static func meta(_ talk: Talk) -> String {
        let when = DateKit.date(talk.createdAt).map { stamp.string(from: $0) } ?? ""
        let what: String
        switch talk.mode {
        case .call: what = talk.app ?? "Call"
        case .upload: what = "From a file"
        case .room: what = "In person"
        }
        return [when, clock(talk.duration), what].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: Search

    private static let stop: Set<String> = Set((
        "the and for with that this from have has was were are you your not but all can will just into our out about what when where who how why "
        + "did does say said tell told talk talks call calls meeting there their they them then than yes okay also "
        + "yang dan untuk dengan ini itu dari ada akan bisa juga sudah belum tidak atau karena pada saya aku kamu kita apa siapa kapan bilang"
    ).split(separator: " ").map(String.init))

    static func words(_ s: String) -> [String] {
        s.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 2 && !stop.contains($0) }
    }

    /// Does a talk match a search box's words (title, names, summary, transcript)?
    static func matches(_ talk: Talk, _ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return true }
        let hay = ([talk.title, talk.app ?? "", talk.summary?.text ?? ""] + Array(talk.names.values)
                   + talk.segments.map(\.text)).joined(separator: " ").lowercased()
        return q.split(whereSeparator: \.isWhitespace).allSatisfy { hay.contains($0) }
    }

    struct Passage {
        var talk: Talk
        var text: String
        var start: Double
        var score: Double
    }

    /// The parts of talks that best match a question: about a minute of conversation
    /// each (and each talk's write-up), scored by the distinct words they share with it,
    /// rarer words counting for more. The assistant reads these to answer.
    static func passages(_ talks: [Talk], query: String, limit: Int = 3) -> [Passage] {
        let q = Set(words(query))
        guard !q.isEmpty else { return [] }
        var all: [(talk: Talk, text: String, start: Double, terms: Set<String>)] = []
        for t in talks where t.isAlive {
            let about = ([t.title, t.app ?? ""] + Array(t.names.values)).joined(separator: " ")
            if let s = t.summary {
                let text = "Summary: \(s.text)\nKey points: \(s.keyPoints.joined(separator: "; "))\nAction items: \(s.actionItems.joined(separator: "; "))"
                all.append((t, text, 0, Set(words(about + " " + text))))
            }
            let ts = turns(t)
            var i = 0
            while i < ts.count {
                var j = i, length = 0
                while j < ts.count && (length < 900 || j == i) { length += ts[j].text.count; j += 1 }
                let text = ts[i..<j].map { "[\(clock($0.start))] \($0.name): \($0.text)" }.joined(separator: "\n")
                all.append((t, text, ts[i].start, Set(words(about + " " + text))))
                i = j
            }
        }
        var df: [String: Int] = [:]
        for p in all { for w in q where p.terms.contains(w) { df[w, default: 0] += 1 } }
        let n = Double(all.count)
        return all.map { p in
            let score = q.reduce(0.0) { sum, w in p.terms.contains(w) ? sum + log(1 + n / Double(df[w] ?? 1)) : sum }
            return Passage(talk: p.talk, text: p.text, start: p.start, score: score)
        }
        .filter { $0.score > 0 }
        .sorted { $0.score > $1.score }
        .prefix(limit)
        .map { $0 }
    }

    // MARK: Notes

    /// The note "Save to Notes" writes: the summary, each person's profile, then the transcript.
    static func note(_ talk: Talk) -> String {
        let when = DateKit.date(talk.createdAt).map { noteStamp.string(from: $0) } ?? ""
        let kind = talk.mode == .call ? "Call" : talk.mode == .upload ? "Recording" : "Talk"
        var parts = ["\(kind), \(when), \(clock(talk.duration))\(talk.app.map { ", \($0)" } ?? "")"]
        if let s = talk.summary {
            if !s.text.isEmpty { parts.append("## Summary\n\(s.text)") }
            if !s.keyPoints.isEmpty { parts.append("## Key points\n" + s.keyPoints.map { "- \($0)" }.joined(separator: "\n")) }
            if !s.actionItems.isEmpty { parts.append("## Action items\n" + s.actionItems.map { "☐ \($0)" }.joined(separator: "\n")) }
            var seen = Set<String>()
            let people = s.people.compactMap { p -> String? in
                let line = "- \(name(talk, p.speaker)): \(p.profile)"
                return seen.insert(line).inserted ? line : nil
            }
            if !people.isEmpty { parts.append("## People\n" + people.joined(separator: "\n")) }
        }
        parts.append("## Transcript\n" + transcript(talk))
        return parts.joined(separator: "\n\n")
    }

    private static let noteStamp: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()
}
