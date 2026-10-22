import Combine
import Foundation

// Live Q&A: while a talk is being recorded, the questions asked in it — "what was the
// budget we agreed for Q3?" — looked up in your notes, other talks and library, and
// answered beside your notes when they hold the answer. Only finished lines of the live
// transcript are read, one question is answered at a time, and nothing is sent when
// nothing you have answers it. The answer comes from whichever model Settings picks,
// on this Mac first unless you chose the cloud. Answers are kept on the talk.

extension Notification.Name {
    /// A line added to a talk's notes from outside its editor ("Add to my notes").
    static let talkNotesAdded = Notification.Name("fournotes.talkNotesAdded")
}

/// Which lines of a conversation are questions worth looking up. Pure, so it's tested.
enum LiveQuestions {
    /// Words a question starts with, in English and Indonesian.
    private static let starts: Set<String> = [
        "what", "whats", "how", "hows", "when", "whens", "why", "who", "whos", "whom", "whose", "where", "wheres", "which",
        "apa", "apakah", "bagaimana", "gimana", "kapan", "kenapa", "mengapa", "siapa", "berapa", "dimana", "manakah",
        "bisakah", "bolehkah", "haruskah", "adakah", "benarkah", "sudahkah",
    ]
    /// Words that start a question only when "you", "we"… comes next ("can you…", "is it…").
    private static let auxiliaries: Set<String> = [
        "do", "does", "did", "is", "are", "was", "were", "can", "could", "will", "would", "should", "shall", "have", "has",
        "may", "might", "bisa", "boleh", "ada", "sudah", "udah",
    ]
    private static let subjects: Set<String> = [
        "you", "we", "they", "i", "it", "he", "she", "this", "that", "there", "these", "those", "anyone", "everyone", "the", "our", "your",
        "kamu", "kita", "kami", "anda", "dia", "mereka", "saya", "aku", "ini", "itu", "tolong", "nggak", "gak", "ga",
    ]
    /// Words said before a question that aren't part of it.
    private static let lead: Set<String> = [
        "so", "and", "but", "okay", "ok", "um", "uh", "well", "right", "also", "then", "now", "hey", "oh", "yeah", "actually",
        "jadi", "terus", "trus", "nah", "eh", "oke", "lalu", "tapi", "dan", "kalau", "kalo", "trs",
    ]
    /// Questions that keep a conversation going rather than ask for anything.
    private static let filler = try! NSRegularExpression(pattern: [
        #"^(you know|right|okay|ok|yes|yeah|no|really|sorry|pardon|what|huh|isn't it|aren't they|don't you think|is that right|is that ok(ay)?)$"#,
        #"\b(can|could) (you|you all|everyone|everybody) (hear|see)( me| us| my screen| the screen| it| this)?\b"#, #"\b(are|is) (you|everyone|everybody) (there|here|with me|ready)\b"#,
        #"\bhow (are|r) (you|u|things|we)( doing)?\b"#, #"\bhow('?s| is) (it going|everyone|everybody|your (day|week|weekend))\b"#,
        #"\bwhat'?s up\b"#, #"\b(make|makes) sense\b"#, #"\bany (other )?questions\b"#, #"\bsounds? good\b"#,
        #"\b(does that|that) work for (you|everyone)\b"#, #"\bwho('?s| is) (sharing|talking|next)\b"#, #"\bshall we (start|begin)\b"#,
        #"\b(apa kabar|gimana kabar|bisa dengar|kedengaran|kelihatan|ya kan|kan ya)\b"#,
    ].joined(separator: "|"), options: [.caseInsensitive])

    /// The question in a finished line of conversation — the last sentence that asks one
    /// — or nil. A sentence ending in "?" is one; one left unpunctuated (the captions
    /// don't always punctuate) is when it starts like a question ("what…", "can you…",
    /// "kapan…").
    static func question(in line: String) -> String? {
        for sentence in sentences(line).reversed() {
            let s = trimmedLead(sentence)
            if isQuestion(s) { return s }
        }
        return nil
    }

    static func isQuestion(_ sentence: String) -> Bool {
        let words = sentence.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        let asked = sentence.hasSuffix("?") || sentence.hasSuffix("？")
        // Punctuated as a statement ("When we launched, sales doubled."): the captions said so.
        if !asked, let last = sentence.last, ".!。".contains(last) { return false }
        guard words.count >= (asked ? 3 : 4), !isFiller(sentence) else { return false }
        // Something to look up: "how are you doing?" has nothing.
        guard !KnowledgeQuery.terms(sentence).isEmpty else { return false }
        if asked { return true }
        guard let first = words.first else { return false }
        if starts.contains(first) || (first == "di" && words.dropFirst().first == "mana") { return true }
        if auxiliaries.contains(first), let second = words.dropFirst().first, subjects.contains(second) { return true }
        return false
    }

    static func isFiller(_ sentence: String) -> Bool {
        let t = sentence.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters)).lowercased()
        return filler.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil
    }

    /// Whether two questions ask the same thing: most of their words shared.
    static func similar(_ a: String, _ b: String) -> Bool {
        let x = Set(KnowledgeQuery.terms(a)), y = Set(KnowledgeQuery.terms(b))
        guard !x.isEmpty, !y.isEmpty else { return a.lowercased() == b.lowercased() }
        let shared = Double(x.intersection(y).count)
        return shared / Double(x.union(y).count) >= 0.6 || (min(x.count, y.count) >= 2 && shared == Double(min(x.count, y.count)))
    }

    /// A question from someone else in the conversation, rather than your own.
    static func isTheirs(_ speaker: String) -> Bool { speaker != "me" }

    private static func sentences(_ line: String) -> [String] {
        var out: [String] = []
        var current = ""
        for ch in line {
            current.append(ch)
            if ".?!？。".contains(ch) {
                out.append(current)
                current = ""
            }
        }
        out.append(current)
        return out.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// "So, um, what's the budget?" → "What's the budget?"
    private static func trimmedLead(_ sentence: String) -> String {
        var s = Substring(sentence)
        while let word = s.split(whereSeparator: { $0 == " " || $0 == "," }).first,
              lead.contains(word.lowercased().trimmingCharacters(in: .punctuationCharacters)),
              s.split(separator: " ").count > 3 {
            s = s.dropFirst(word.count).drop { $0 == " " || $0 == "," }
        }
        guard let first = s.first else { return String(sentence) }
        return first.uppercased() + s.dropFirst()
    }
}

@MainActor
final class LiveQA: ObservableObject {
    static let shared = LiveQA()

    /// Off: questions aren't looked up. Remembered.
    @Published var isOn: Bool {
        didSet {
            UserDefaults.standard.set(isOn, forKey: Self.onKey)
            if !isOn { queue.removeAll() }
        }
    }
    /// The question being looked up now.
    @Published private(set) var working: String?
    /// The last question nothing you have answered, said quietly.
    @Published private(set) var missed: String?
    /// Why the last answer couldn't be had (no model, a model's error).
    @Published private(set) var problem: String?
    /// Answers that came while the Live Q&A tab wasn't showing.
    @Published private(set) var unseen = 0

    /// True while the Live Q&A tab shows: what arrives then is seen.
    var viewing = false {
        didSet { if viewing { unseen = 0 } }
    }

    static let onKey = "fournotes.liveQA"
    /// Questions waiting at most: in a fast conversation the newest matter, not a backlog.
    static let queueLimit = 3

    private struct Pending {
        var question: String
        var speaker: String
        var at: Double
        var before: String
        var theirs: Bool
    }

    private var talkId: String?
    /// How many of the talk's lines have been read for questions.
    private var read = 0
    private var queue: [Pending] = []
    /// Questions already looked up, so the same one asked again isn't.
    private var asked: [String] = []
    private var worker: Task<Void, Never>?
    private var watching: AnyCancellable?

    private init() {
        isOn = UserDefaults.standard.object(forKey: Self.onKey) as? Bool ?? true
    }

    /// Starts listening to a talk that's being recorded (TalkRecorder.start).
    func follow(_ id: String) {
        worker?.cancel()
        worker = nil
        talkId = id
        read = TalkStore.shared.talk(id)?.segments.count ?? 0
        queue = []
        asked = []
        working = nil
        missed = nil
        problem = nil
        unseen = 0
        // `all` is published before it changes: the new value is the one handed over.
        watching = TalkStore.shared.$all.sink { [weak self] all in
            MainActor.assumeIsolated { self?.changed(all) }
        }
    }

    private func stopFollowing() {
        watching = nil
        talkId = nil
        queue = []
        working = nil
    }

    private func changed(_ all: [Talk]) {
        guard let id = talkId else { return }
        // Once the recording stops, Whisper may write the transcript again: that isn't live.
        let recorder = TalkRecorder.shared
        guard recorder.talkId == id, recorder.status != .idle else { return stopFollowing() }
        guard let talk = all.first(where: { $0.id == id }) else { return }
        let segments = talk.segments
        guard segments.count > read else {
            read = min(read, segments.count)
            return
        }
        let fresh = Array(segments[read...])
        let start = read
        read = segments.count
        guard isOn else { return }
        for (i, s) in fresh.enumerated() {
            guard let question = LiveQuestions.question(in: s.text) else { continue }
            let before = segments[max(0, start + i - 3)..<(start + i)]
                .map { "\(TalkText.name(talk, $0.speaker)): \($0.text)" }.joined(separator: "\n")
            enqueue(Pending(question: question, speaker: s.speaker, at: s.start, before: before,
                            theirs: LiveQuestions.isTheirs(s.speaker)))
        }
        pump()
    }

    private func enqueue(_ p: Pending) {
        guard !asked.contains(where: { LiveQuestions.similar($0, p.question) }),
              !queue.contains(where: { LiveQuestions.similar($0.question, p.question) }),
              working.map({ !LiveQuestions.similar($0, p.question) }) ?? true else { return }
        queue.append(p)
        // Too many waiting: your own oldest question goes first, then the oldest.
        while queue.count > Self.queueLimit {
            queue.remove(at: queue.firstIndex { !$0.theirs } ?? 0)
        }
    }

    /// The next to answer: theirs before yours, the newest of each first.
    private func next() -> Pending? {
        guard let i = queue.lastIndex(where: \.theirs) ?? queue.indices.last else { return nil }
        return queue.remove(at: i)
    }

    private func pump() {
        guard worker == nil, isOn, let id = talkId, let p = next() else { return }
        worker = Task { [weak self] in
            await self?.answer(p, in: id)
            self?.worker = nil
            self?.pump()
        }
    }

    private func answer(_ p: Pending, in id: String) async {
        working = p.question
        defer { if talkId == id { working = nil } }
        asked.append(p.question)
        let store = AppModel.shared.store
        let space = store.currentSpaceId
        // This talk is the conversation itself; its own words aren't an answer to it.
        let others = TalkStore.shared.live(in: space).filter { $0.id != id }
        let query = LiveAnswer.query(p.question, before: p.before)
        let hits = await Knowledge.shared.search(query, notes: store.liveNotes, talks: others, space: space, limit: 6)
        let usable = LiveAnswer.usable(hits, question: query)
        guard talkId == id, !Task.isCancelled else { return }
        guard !usable.isEmpty else {
            missed = p.question
            return
        }
        do {
            let asker = TalkStore.shared.talk(id).map { TalkText.name($0, p.speaker) } ?? "someone"
            let result = try await AppModel.shared.engine.liveAnswer(question: p.question, asker: asker, before: p.before, hits: usable)
            guard talkId == id, !Task.isCancelled else { return }
            problem = nil
            guard let result else {
                missed = p.question
                return
            }
            let (reply, by) = result
            let answer = TalkAnswer(speaker: p.speaker, at: p.at, question: p.question, answer: reply.text,
                                    sources: reply.sources.map { TalkCitation(KnowledgeCitation(origin: $0.origin, label: $0.label, title: $0.title)) },
                                    by: by.name, onThisMac: by.onThisMac)
            TalkStore.shared.update(id) { $0.answers = ($0.answers ?? []) + [answer] }
            missed = nil
            if !viewing { unseen += 1 }
        } catch is CancellationError {
        } catch {
            if talkId == id { problem = AIEngine.reason(error) }
        }
    }

    // MARK: - On the card

    /// The answer as a line of your notes, timed when it was asked.
    nonisolated static func noteLine(_ a: TalkAnswer) -> String {
        "- \(a.question) → \(a.answer)"
    }

    func addToNotes(_ a: TalkAnswer, talkId: String) {
        let line = Self.noteLine(a)
        TalkStore.shared.update(talkId) { t in
            let notes = (t.notes ?? "").trimmingCharacters(in: .newlines)
            t.notes = notes.isEmpty ? line : notes + "\n" + line
            var times = t.noteTimes ?? [:]
            times[NoteTimes.key(line)] = a.at
            t.noteTimes = times
        }
        // An open notes editor may hold typing it hasn't saved yet, which would be written
        // over this line: it takes the line in and saves both.
        NotificationCenter.default.post(name: .talkNotesAdded, object: nil,
                                        userInfo: ["talkId": talkId, "line": line, "at": a.at])
    }

    func dismiss(_ answerId: String, talkId: String) {
        TalkStore.shared.update(talkId) { t in
            t.answers?.removeAll { $0.id == answerId }
            if t.answers?.isEmpty == true { t.answers = nil }
        }
    }
}

// MARK: - Chat about a talk

/// Your questions about a talk, while it runs and after, answered from the conversation
/// and what else you have on it. Kept on the talk (Talk.chat).
@MainActor
final class TalkChat: ObservableObject {
    static let shared = TalkChat()

    /// The talks a question is being answered for.
    @Published private(set) var busy: Set<String> = []

    /// Asks about a talk. The question shows at once; when no model could answer it's
    /// taken back and the error thrown, for the caller to say.
    func ask(_ text: String, talkId: String) async throws {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !busy.contains(talkId), let talk = TalkStore.shared.talk(talkId) else { return }
        let engine = AppModel.shared.engine
        let recorder = TalkRecorder.shared
        let live = recorder.talkId == talkId && recorder.status != .idle
        let question = TalkChatMessage(role: .user, text: clean,
                                       at: live ? recorder.startedAt.map { Date().timeIntervalSince($0) } : nil)
        let history = (talk.chat ?? []).suffix(6).map { (role: $0.role, text: $0.text) }
        TalkStore.shared.update(talkId) { $0.chat = ($0.chat ?? []) + [question] }
        busy.insert(talkId)
        defer { busy.remove(talkId) }

        // Refused before any model is asked, as the assistant's chat is (Guard).
        if let refusal = Guard.blockedReply(clean, tier: engine.chatRunsOnDevice ? .local : .cloud) {
            reply(talkId, TalkChatMessage(role: .assistant, text: refusal, by: "Four Notes", onThisMac: true))
            return
        }
        let store = AppModel.shared.store
        let space = store.currentSpaceId
        let others = TalkStore.shared.live(in: space).filter { $0.id != talkId }
        let hits = await Knowledge.shared.search(clean, notes: store.liveNotes, talks: others, space: space, limit: 6)
        do {
            let (answer, by) = try await engine.talkChatAnswer(question: clean, talk: TalkStore.shared.talk(talkId) ?? talk, live: live,
                                                               hits: LiveAnswer.usable(hits, question: clean), history: history)
            reply(talkId, TalkChatMessage(role: .assistant, text: answer.text,
                                          sources: answer.sources.map { TalkCitation(KnowledgeCitation(origin: $0.origin, label: $0.label, title: $0.title)) },
                                          by: by.name, onThisMac: by.onThisMac))
        } catch {
            TalkStore.shared.update(talkId) { t in t.chat?.removeAll { $0.id == question.id } }
            throw error
        }
    }

    private func reply(_ talkId: String, _ message: TalkChatMessage) {
        TalkStore.shared.update(talkId) { $0.chat = ($0.chat ?? []) + [message] }
    }

    func clear(_ talkId: String) {
        TalkStore.shared.update(talkId) { $0.chat = nil }
    }
}
