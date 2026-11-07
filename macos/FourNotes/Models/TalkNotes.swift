import Foundation

// Meeting notes, as Granola writes them: you jot a few words while the talk runs, and
// Enhance writes them out in full from the transcript. Your own lines stay yours, in your
// words, and are told apart from what the model added (the page shows its lines in a
// lighter ink); a line can say where in the conversation it came from.

struct TalkNotes: Codable, Equatable {
    struct Line: Codable, Equatable, Hashable {
        var text: String
        /// One of your own notes, in your words. False for what Enhance added.
        var mine: Bool
        /// Seconds into the talk where it came from, when the model could say.
        var at: Double?
        /// 1 for a detail under the line before it.
        var depth: Int = 0
    }

    struct Section: Codable, Equatable {
        var heading: String
        var lines: [Line]
    }

    var sections: [Section]
    /// The template it was written for (a `TalkTemplate`).
    var template: String
    /// Your notes as they were when it was written: when they've changed since, it's out of date.
    var basedOn: String
    var createdAt: String

    /// "## Decisions\n- …\n  - …": for Save to Notes, a copy and an export.
    var markdown: String {
        sections.map { section in
            (["## \(section.heading)"] + section.lines.map { String(repeating: "  ", count: min(1, $0.depth)) + "- " + $0.text })
                .joined(separator: "\n")
        }
        .joined(separator: "\n\n")
    }

    /// Enhance's answer made safe to show. A line is yours only when it is one of the lines
    /// you wrote (then it reads exactly as you wrote it), whatever the model called it;
    /// any line of yours the model left out is kept at the end; times outside the talk go.
    static func reconciled(_ sections: [Section], yours: [(text: String, at: Double?)],
                           duration: Double) -> [Section] {
        var unused = Array(yours.indices)
        let headings = Set(sections.map { NoteTimes.key($0.heading) })
        // A heading of yours that became a section heading is there already.
        unused.removeAll { headings.contains(NoteTimes.key(yours[$0].text)) }

        var out: [Section] = sections.compactMap { section in
            let heading = section.heading.trimmingCharacters(in: .whitespacesAndNewlines)
            let lines: [Line] = section.lines.compactMap { line in
                var line = line
                line.text = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !line.text.isEmpty else { return nil }
                line.depth = min(1, max(0, line.depth))
                if let at = line.at, !at.isFinite || at < 0 || (duration > 0 && at > duration + 5) { line.at = nil }
                let match = unused.max { similarity(yours[$0].text, line.text) < similarity(yours[$1].text, line.text) }
                let score = match.map { similarity(yours[$0].text, line.text) } ?? 0
                if let match, score >= 0.95 || (line.mine && score >= 0.5) {
                    unused.removeAll { $0 == match }
                    line.mine = true
                    line.text = plain(yours[match].text)
                    if line.at == nil { line.at = yours[match].at }
                } else {
                    line.mine = false
                }
                return line
            }
            guard !lines.isEmpty, !heading.isEmpty else { return nil }
            return Section(heading: heading, lines: lines)
        }
        let left = unused.sorted().map { yours[$0] }.filter { !$0.text.hasPrefix("#") }
        if !left.isEmpty {
            out.append(Section(heading: "Also in your notes",
                               lines: left.map { Line(text: plain($0.text), mine: true, at: $0.at) }))
        }
        return out
    }

    /// A line of your notes without its list mark: "- Budi sends the deck" → "Budi sends the deck".
    static func plain(_ line: String) -> String {
        line.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: #"^([•\-\*]|☐|☑|\d+[.)])\s*"#, with: "", options: .regularExpression)
    }

    /// How much two lines say the same: the share of words they have in common, 0 to 1.
    static func similarity(_ a: String, _ b: String) -> Double {
        let x = Set(NoteTimes.key(a).split(separator: " ")), y = Set(NoteTimes.key(b).split(separator: " "))
        guard !x.isEmpty, !y.isEmpty else { return 0 }
        return Double(x.intersection(y).count) / Double(x.union(y).count)
    }
}

extension TalkNotes {
    // Read field by field: a talk must still open if a later version writes these differently.
    private enum Keys: String, CodingKey { case sections, template, basedOn, createdAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        var skipped = 0
        sections = c.lenientArray(Section.self, forKey: .sections, skipped: &skipped)
        template = (try? c.decodeIfPresent(String.self, forKey: .template)) ?? TalkTemplate.general.rawValue
        basedOn = (try? c.decodeIfPresent(String.self, forKey: .basedOn)) ?? ""
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? ""
    }
}

extension TalkNotes.Section {
    private enum Keys: String, CodingKey { case heading, lines }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        var skipped = 0
        heading = (try? c.decodeIfPresent(String.self, forKey: .heading)) ?? ""
        lines = c.lenientArray(TalkNotes.Line.self, forKey: .lines, skipped: &skipped)
    }
}

extension TalkNotes.Line {
    private enum Keys: String, CodingKey { case text, mine, at, depth }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        text = try c.decode(String.self, forKey: .text)
        mine = (try? c.decodeIfPresent(Bool.self, forKey: .mine)) ?? false
        at = try? c.decodeIfPresent(Double.self, forKey: .at)
        depth = (try? c.decodeIfPresent(Int.self, forKey: .depth)) ?? 0
    }
}

// MARK: - Templates

/// The kind of meeting the notes are written for: the sections they're in, and what's
/// worth pulling out of the conversation.
enum TalkTemplate: String, CaseIterable, Identifiable, Sendable {
    case general
    case oneOnOne = "one-on-one"
    case standup
    case customer
    case userInterview = "user-interview"
    case hiring
    case planning

    var id: String { rawValue }

    static func of(_ id: String?) -> TalkTemplate { id.flatMap(TalkTemplate.init(rawValue:)) ?? .general }

    var label: String {
        switch self {
        case .general: return "General"
        case .oneOnOne: return "1:1"
        case .standup: return "Standup"
        case .customer: return "Customer call"
        case .userInterview: return "User interview"
        case .hiring: return "Hiring interview"
        case .planning: return "Planning"
        }
    }

    /// The kind of meeting, for the model: "It was a standup."
    var kind: String {
        switch self {
        case .general: return "meeting"
        case .planning: return "planning meeting"
        default: return label.lowercased()
        }
    }

    /// The sections, in order. General's are named for what was talked about.
    var sections: [String] {
        switch self {
        case .general: return []
        case .oneOnOne: return ["Updates", "Wins and blockers", "Feedback", "Growth", "Next steps"]
        case .standup: return ["Done", "Next", "Blockers"]
        case .customer: return ["About them", "Needs and pain points", "Objections", "Pricing and timeline", "Next steps"]
        case .userInterview: return ["About them", "How they work today", "Pain points", "Quotes worth keeping", "Requests and ideas", "Next steps"]
        case .hiring: return ["Background", "Strengths", "Concerns", "Their questions", "Next steps"]
        case .planning: return ["Goals", "Options", "Decisions", "Owners and dates", "Risks", "Next steps"]
        }
    }

    /// What to pull out, for the model.
    var focus: String {
        switch self {
        case .general: return "Decisions, numbers, names and dates, and who will do what."
        case .oneOnOne: return "What each person is working on, what's going well or stuck, feedback given either way, and what was agreed."
        case .standup: return "For each person, by name: what they finished, what they'll do next, and what's in their way."
        case .customer: return "Their situation, what they need and why, concerns or objections, budget, timeline and who decides, and the agreed next step."
        case .userInterview: return "How they work today, where it hurts, their own words worth quoting (in quotation marks), and what they asked for."
        case .hiring: return "What the candidate said and showed, as facts: experience, skills, how they answered, their questions. Nothing about age, family, health, religion or other personal traits."
        case .planning: return "The goals, the options weighed, what was decided and why, who owns what by when, and the risks raised."
        }
    }
}

// MARK: - When each line was written

/// The time each line of your notes was written while the talk ran, kept by the line's
/// words so it survives lines moving. A line being typed or changed keeps the time it was
/// started; one that's new gets now.
enum NoteTimes {
    /// A line's words, without its list mark, spacing or case: "- Budi  Sends" → "budi sends".
    static func key(_ line: String) -> String {
        TalkNotes.plain(line)
            .replacingOccurrences(of: #"^#{1,3}\s*|^>\s*"#, with: "", options: .regularExpression)
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// The times after an edit from `old` to `new`. `now` is nil once the talk is over:
    /// lines written then have no time.
    static func update(_ times: [String: Double], old: String, new: String, now: Double?) -> [String: Double] {
        let before = old.components(separatedBy: .newlines).map(key)
        let after = new.components(separatedBy: .newlines).map(key)
        let present = Set(after)
        // Lines that were there and aren't now: what a changed line was before.
        let gone = before.enumerated().filter { !$0.element.isEmpty && !present.contains($0.element) && times[$0.element] != nil }
        let shift = abs(after.count - before.count)
        var out: [String: Double] = [:]
        for (i, k) in after.enumerated() where !k.isEmpty {
            if let t = times[k] { out[k] = min(out[k] ?? t, t); continue }
            let from = gone.filter { abs($0.offset - i) <= shift + 1 && related($0.element, k) }
                .min { abs($0.offset - i) < abs($1.offset - i) }
            if let from, let t = times[from.element] {
                out[k] = min(out[k] ?? t, t)
            } else if let now {
                out[k] = out[k] ?? now
            }
        }
        return out
    }

    /// The same line, changed: one grew out of the other, or they start alike.
    private static func related(_ a: String, _ b: String) -> Bool {
        if a.hasPrefix(b) || b.hasPrefix(a) { return true }
        if min(a.count, b.count) >= 4, a.contains(b) || b.contains(a) { return true }
        return zip(a, b).prefix { $0 == $1 }.count >= 3
    }
}
