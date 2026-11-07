import Foundation
import Testing
@testable import FourNotes

// Live Q&A, chat about a talk, and recipes: which lines are questions, when the library
// holds an answer, reading a model's answer, fitting a talk into a prompt, recipes kept
// and written, and the follow-up email.

private func hit(_ text: String, title: String = "Q3 plan", score: Double = 0.65,
                 origin: KnowledgeHit.Origin = .note(id: "n1")) -> KnowledgeHit {
    KnowledgeHit(origin: origin, title: title, label: title, text: text, score: score, updatedAt: "2026-10-01T00:00:00.000Z")
}

private func talk(lines: Int, length: Int = 60, id: String = UUID().uuidString) -> Talk {
    var t = Talk(id: id, title: "Pricing sync", mode: .call, app: "Zoom", lang: "en-US")
    t.segments = (0..<lines).map { i in
        TalkSegment(speaker: i % 2 == 0 ? "me" : "them", start: Double(i * 10), end: Double(i * 10 + 8),
                    text: "Line \(i) " + String(repeating: "x", count: max(0, length - 8)))
    }
    t.duration = Double(lines * 10)
    t.status = .done
    return t
}

@Suite("Live Q&A: which lines are questions")
struct LiveQuestionTests {
    @Test("A sentence ending in a question mark is one, without what's said before it")
    func asked() {
        #expect(LiveQuestions.question(in: "So, um, what's the budget for Q3?") == "What's the budget for Q3?")
        #expect(LiveQuestions.question(in: "We moved the launch. When is the launch date now?") == "When is the launch date now?")
        #expect(LiveQuestions.question(in: "Kapan deadline proposal klien?") == "Kapan deadline proposal klien?")
        #expect(LiveQuestions.question(in: "Jadi, apakah kontraknya sudah ditandatangani?") == "Apakah kontraknya sudah ditandatangani?")
    }

    @Test("Without punctuation, a line that starts like a question")
    func unpunctuated() {
        #expect(LiveQuestions.question(in: "can you send the pricing deck to Budi") != nil)
        #expect(LiveQuestions.question(in: "berapa harga paket premium untuk klien") != nil)
        #expect(LiveQuestions.question(in: "di mana file kontrak vendor") != nil)
        #expect(LiveQuestions.question(in: "how much did the Bali offsite cost") != nil)
        // "Can" with no one after it isn't asking.
        #expect(LiveQuestions.question(in: "can openers are in the kitchen drawer") == nil)
    }

    @Test("Statements, even those that start with a question word, aren't")
    func statements() {
        #expect(LiveQuestions.question(in: "When we launched, sales doubled.") == nil)
        #expect(LiveQuestions.question(in: "We should ship the pricing page on Friday") == nil)
        #expect(LiveQuestions.question(in: "Apa yang saya maksud sudah jelas.") == nil)
    }

    @Test("Questions that only keep the conversation going are skipped")
    func filler() {
        for line in ["Can you hear me?", "How are you doing?", "Right?", "Makes sense?", "Can everyone see my screen?",
                     "Any other questions?", "Apa kabar semuanya?", "Is everyone here?", "Sounds good?", "You know?"] {
            #expect(LiveQuestions.question(in: line) == nil, "\(line)")
        }
    }

    @Test("The same question asked again is the same")
    func nearDuplicates() {
        #expect(LiveQuestions.similar("What's the budget for Q3?", "what is the Q3 budget?"))
        #expect(LiveQuestions.similar("When does the Bali offsite start?", "So when does the Bali offsite start exactly?"))
        #expect(!LiveQuestions.similar("When is the launch?", "Who owns pricing?"))
    }

    @Test("Theirs before yours")
    func whose() {
        #expect(!LiveQuestions.isTheirs("me"))
        #expect(LiveQuestions.isTheirs("them"))
        #expect(LiveQuestions.isTheirs("them:A"))
        #expect(LiveQuestions.isTheirs("B"))
    }
}

@Suite("Live Q&A: answering only when there's something to answer from")
struct LiveAnswerThresholdTests {
    @Test("A hit needs half the question's words, two at the least")
    func coverage() {
        let q = "What was the Q3 marketing budget?"
        let all = hit("Q3 marketing budget is Rp 120 million, agreed with Sari.")
        let two = hit("Budget for marketing, reviewed monthly.", title: "Finance notes")
        let one = hit("Budget for the office party.", title: "Party")
        #expect(LiveAnswer.usable([all, two, one], question: q) == [all, two])
    }

    @Test("Words match as search matches them: a word they begin")
    func prefixes() {
        let q = "When did the Bali offsite launch?"
        #expect(LiveAnswer.usable([hit("The offsite in Bali launched on 3 March.")], question: q).count == 1)
    }

    @Test("A one-word question needs its word and a meaning that stands out")
    func oneWord() {
        let q = "What's the budget?"
        #expect(LiveAnswer.usable([hit("Budget: 120 million", score: 0.65)], question: q).isEmpty)
        #expect(LiveAnswer.usable([hit("Budget: 120 million", score: 0.8)], question: q).count == 1)
        #expect(LiveAnswer.usable([hit("Spending plan", score: 0.9)], question: q).isEmpty)
    }

    @Test("A question with nothing to look up finds nothing")
    func nothing() {
        #expect(LiveAnswer.usable([hit("How are you all doing today")], question: "How are you?").isEmpty)
    }

    @Test("A question that says little is looked up with the line before it")
    func query() {
        #expect(LiveAnswer.query("What's the Q3 budget?", before: "Sari: about marketing") == "What's the Q3 budget?")
        #expect(LiveAnswer.query("And for it?", before: "Sari: the marketing budget") == "And for it? Sari: the marketing budget")
    }

    @Test("Passages are numbered and kept within the room")
    func passages() {
        let hits = [hit(String(repeating: "a", count: 1_000)), hit(String(repeating: "b", count: 1_000)),
                    hit(String(repeating: "c", count: 1_000))]
        let p = LiveAnswer.passages(hits, budget: 2_000, each: 800)
        #expect(p.used.count == 2)
        #expect(p.text.contains("[1] Q3 plan:"))
        #expect(p.text.contains("[2] Q3 plan:"))
        #expect(!p.text.contains("[3]"))
        // The best one goes in even when it alone is more than the room.
        #expect(LiveAnswer.passages(hits, budget: 100, each: 800).used.count == 1)
    }
}

@Suite("Reading a model's answer")
struct LiveAnswerParseTests {
    let given = [hit("Q3 budget is 120 million", title: "Q3 plan"), hit("Sari owns the budget", title: "Standup")]

    @Test("JSON: the answer and the passages it names")
    func json() {
        let reply = LiveAnswer.parse(#"{"answer": "It's Rp 120 million.", "sources": [2]}"#, given: given)
        #expect(reply?.text == "It's Rp 120 million.")
        #expect(reply?.sources == [given[1]])
    }

    @Test("Passages it names that weren't given are ignored; none named cites what it was given")
    func sources() {
        #expect(LiveAnswer.parse(#"{"answer": "Sari.", "sources": [7]}"#, given: given)?.sources == given)
        #expect(LiveAnswer.parse("Sari owns it.", given: given)?.sources == given)
    }

    @Test("No answer, in any of the ways a model says it, shows nothing")
    func none() {
        for text in [#"{"answer": "", "sources": []}"#, "NONE", "The passages don't say.", "The passages don’t answer this.",
                     "I don't know.", "There is no information about that.", "Tidak ada informasi tentang itu.", "  "] {
            #expect(LiveAnswer.parse(text, given: given) == nil, "\(text)")
        }
        #expect(LiveAnswer.parse("Nothing changed: it's still 120 million.", given: given) != nil)
    }
}

@Suite("A talk fitted into a prompt")
struct TalkMaterialTests {
    @Test("The latest lines whole, and the ones before them")
    func cut() {
        let lines = (0..<10).map { "[0:\($0)0] A: " + String(repeating: "y", count: 40) }
        let (earlier, recent) = TalkMaterial.cut(lines.joined(separator: "\n"), recent: 120)
        #expect(recent.count <= 120)
        #expect(earlier + recent.components(separatedBy: "\n") == lines)
        #expect(recent.hasSuffix(lines[9]))
        // A last line longer than the room is cut to its end.
        let long = TalkMaterial.cut("short line\n" + String(repeating: "z", count: 500), recent: 100)
        #expect(long.recent.count == 100)
        #expect(long.earlier == ["short line"])
    }

    @Test("A talk still going on: whole when it fits, else notes on the start and the latest part, made once")
    @MainActor func live() async throws {
        let short = talk(lines: 5)
        var asked = 0
        let whole = try await TalkMaterial.text(short, live: true, limit: 3_000) { _ in asked += 1; return "" }
        #expect(asked == 0)
        #expect(whole.contains("Line 0") && whole.contains("Line 4"))

        let long = talk(lines: 120)
        let text = try await TalkMaterial.text(long, live: true, limit: 3_000) { _ in
            asked += 1
            return "[0:10] Budi: the launch moves to May"
        }
        #expect(asked > 0)
        #expect(text.contains("Notes on the earlier part"))
        #expect(text.contains("The latest part"))
        #expect(text.contains("Line 119"))
        #expect(!text.contains("Line 0 "))
        #expect(text.count <= 3_000 + 300)
        // Asked again with nothing new: the notes are kept.
        let before = asked
        _ = try await TalkMaterial.text(long, live: true, limit: 3_000) { _ in asked += 1; return "" }
        #expect(asked == before)
    }

    @Test("A finished talk: its notes and write-up, then the transcript")
    @MainActor func finished() async throws {
        var t = talk(lines: 4)
        t.summary = TalkSummary(text: "Pricing stays.", keyPoints: ["Premium at 99k"], actionItems: ["Budi: send deck"], people: [])
        t.notes = "premium 99k?"
        let text = try await TalkMaterial.text(t, live: false, limit: 16_000) { _ in "" }
        #expect(text.contains("The notes they wrote:\npremium 99k?"))
        #expect(text.contains("The write-up: Pricing stays."))
        #expect(text.contains("Action items: Budi: send deck"))
        #expect(text.contains("<transcript>"))
    }
}

@Suite("Recipes")
struct RecipeTests {
    @Test("The prompt carries the recipe, the talk and who was invited")
    func prompt() {
        let recipe = TalkRecipe.builtIn[0]
        let text = TalkRecipes.prompt(recipe, talk: "“Pricing sync”, Tue", attendees: ["Budi", "Sari"], material: "<transcript>hi</transcript>")
        #expect(text.contains(recipe.prompt))
        #expect(text.contains("“Pricing sync”, Tue"))
        #expect(text.contains("Invited: Budi, Sari."))
        #expect(text.contains("<transcript>hi</transcript>"))
    }

    @Test("The app's recipes: each once, and the email first")
    func builtIn() {
        let ids = TalkRecipe.builtIn.map(\.id)
        #expect(Set(ids).count == ids.count)
        #expect(TalkRecipe.builtIn.allSatisfy { $0.isBuiltIn })
        #expect(TalkRecipe.builtIn.first?.isEmail == true)
        #expect(TalkRecipe.builtIn.contains { $0.name == "What did I miss?" })
    }

    @Test("Your own are kept, changed and deleted")
    @MainActor func custom() throws {
        let suite = "fournotes-recipes-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let book = RecipeBook(defaults: defaults)
        let made = try #require(book.save(name: "  Pricing feedback  ", prompt: "List every price mentioned."))
        #expect(made.name == "Pricing feedback")
        #expect(!made.isBuiltIn)
        #expect(RecipeBook(defaults: defaults).custom == [made])

        book.save(id: made.id, name: "Prices", prompt: "List every price.")
        #expect(RecipeBook(defaults: defaults).custom.map(\.name) == ["Prices"])
        #expect(book.all.count == TalkRecipe.builtIn.count + 1)

        #expect(book.save(name: "", prompt: "x") == nil)
        #expect(book.save(name: "x", prompt: "   ") == nil)
        #expect(book.save(id: "builtin.email", name: "Mine", prompt: "x") == nil)
        #expect(book.save(name: String(repeating: "n", count: 100), prompt: "x")?.name.count == RecipeBook.nameLimit)

        book.delete(made.id)
        #expect(!RecipeBook(defaults: defaults).custom.contains { $0.id == made.id })
    }

    @Test("Email: the invited who have an address, once each")
    func addresses() {
        let picked = TalkRecipes.emailAddresses(["Budi Santoso <budi@acme.co>", "sari@x.id", "Andi", "BUDI@acme.co", ""])
        #expect(picked == ["budi@acme.co", "sari@x.id"])
    }

    @Test("Email: the subject from its first line, the body without Markdown's marks")
    func email() {
        let e = TalkRecipes.email("Subject: Pricing follow-up\n\nHi all,\n**Next steps**\n## Owners\n- [ ] Budi: send deck", title: "Sync")
        #expect(e.subject == "Pricing follow-up")
        #expect(e.body == "Hi all,\nNext steps\nOwners\n- Budi: send deck")
        #expect(TalkRecipes.email("**Subject:** Thanks", title: "Sync").subject == "Thanks")
        #expect(TalkRecipes.email("Hi all,\nThanks.", title: "Sync").subject == "Follow-up: Sync")
    }
}

@Suite("What's kept on a talk")
struct TalkChatStorageTests {
    @Test("A cited place survives being saved with the talk")
    func citations() {
        let cases: [KnowledgeCitation] = [
            .init(origin: .note(id: "n1"), label: "Plan", title: "Plan"),
            .init(origin: .talk(id: "t1", at: 75), label: "Sync · 1:15", title: "Recorded talk “Sync”"),
            .init(origin: .library(sourceId: "s1", documentId: "d1", page: 4, offset: 120), label: "Q3.pdf · p. 4", title: "From “Q3.pdf”, page 4"),
        ]
        for c in cases { #expect(TalkCitation(c).citation == c) }
    }

    @Test("Answers and the chat round-trip; a talk from before them opens without them")
    func decoding() throws {
        var t = talk(lines: 2)
        t.answers = [TalkAnswer(speaker: "them", at: 12, question: "Budget?", answer: "120 million",
                                sources: [TalkCitation(.init(origin: .note(id: "n1"), label: "Plan", title: "Plan"))],
                                by: "Apple Intelligence", onThisMac: true)]
        t.chat = [TalkChatMessage(role: .user, text: "What did I miss?", at: 30),
                  TalkChatMessage(role: .assistant, text: "Nothing much.", by: "Claude", onThisMac: false)]
        let data = try JSONEncoder().encode(t)
        #expect(try JSONDecoder().decode(Talk.self, from: data) == t)

        var object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        object["answers"] = nil
        object["chat"] = nil
        let old = try JSONDecoder().decode(Talk.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(old.answers == nil && old.chat == nil)
    }

    @Test("An answer added to your notes is a line with a time")
    func noteLine() {
        let a = TalkAnswer(speaker: "them", at: 42, question: "What's the Q3 budget?", answer: "Rp 120 million.",
                           sources: [], by: "Apple Intelligence", onThisMac: true)
        let line = LiveQA.noteLine(a)
        #expect(line == "- What's the Q3 budget? → Rp 120 million.")
        #expect(!NoteTimes.key(line).isEmpty)
    }
}
