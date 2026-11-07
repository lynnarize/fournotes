import Foundation
import Testing
@testable import FourNotes

// The library and the assistant's search over it: pieces that keep their page and
// heading, one ranking from keywords and meaning, which pieces go to the model, and
// which become chips under its reply.

private func note(_ id: String, _ title: String, _ content: String, updated: String = "2026-10-01T00:00:00.000Z") -> Note {
    Note(id: id, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: updated, title: title, content: content)
}

@Suite("Library: pieces")
struct KnowledgeChunkerTests {
    private let paragraph = String(repeating: "The team agreed the launch moves to March because the payments partner needs more time. ", count: 4)

    @Test("pieces keep their page and never run across one")
    func pages() {
        let pages = [paragraph + "\n\n" + paragraph, "Page two talks about hiring.", paragraph]
        let chunks = KnowledgeChunker.chunks(pages: pages, paged: true)
        #expect(Set(chunks.compactMap(\.page)) == [1, 2, 3])
        #expect(chunks.first { $0.page == 2 }?.text == "Page two talks about hiring.")
        #expect(chunks.allSatisfy { $0.text.count <= KnowledgeChunker.target + KnowledgeChunker.overlap + 2 })
    }

    @Test("a long text is cut with a little of the piece before carried over")
    func overlap() {
        let text = (1...12).map { "Paragraph \($0) says the budget for item \($0) is \($0 * 10) million rupiah, approved by Andi." }
            .joined(separator: "\n\n")
        var heading: String?
        let chunks = KnowledgeChunker.chunks(text, heading: &heading)
        #expect(chunks.count >= 2)
        for (a, b) in zip(chunks, chunks.dropFirst()) {
            let tail = String(a.text.suffix(30))
            #expect(b.text.contains(tail), "the next piece should start with the end of the one before")
        }
        // Every paragraph is somewhere.
        for n in 1...12 { #expect(chunks.contains { $0.text.contains("Paragraph \(n) ") }) }
    }

    @Test("a heading is kept beside the pieces under it, and starts a new one")
    func headings() {
        let text = "# Budget\n\nMarketing gets 40 million.\n\n## Hiring\n\nTwo engineers in Q1."
        var heading: String?
        let chunks = KnowledgeChunker.chunks(text, heading: &heading)
        #expect(chunks.count == 2)
        #expect(chunks[0].heading == "Budget" && chunks[0].text == "Marketing gets 40 million.")
        #expect(chunks[1].heading == "Hiring" && chunks[1].text == "Two engineers in Q1.")
        #expect(!chunks.contains { $0.text.contains("#") })
    }

    @Test("a piece's offset finds it in its page")
    func offsets() {
        let page = "Intro line.\n\n" + paragraph + "\n\nClosing words about the offsite."
        var heading: String?
        for chunk in KnowledgeChunker.chunks(page, heading: &heading) {
            let start = page.index(page.startIndex, offsetBy: chunk.offset)
            #expect(page[start...].hasPrefix(String(chunk.text.prefix(20))))
        }
    }

    @Test("a PDF page's broken lines read as paragraphs")
    func brokenLines() {
        let page = "The partner asked for more\ntime to finish the payments\nintegration, so launch moves.\nNext section starts here."
        let paragraphs = KnowledgeChunker.paragraphs(page)
        #expect(paragraphs.count == 1)
        #expect(paragraphs[0].text.hasPrefix("The partner asked for more time"))
    }

    @Test("a talk is cut into its write-up and about a minute at a time")
    func talk() {
        var t = Talk(title: "Pricing call", mode: .call, lang: "en-US")
        t.segments = (0..<30).map { (i: Int) -> TalkSegment in
            let start = Double(i * 6)
            return TalkSegment(speaker: i % 2 == 0 ? "me" : "them", start: start, end: start + 5,
                               text: "Line \(i) about the Pro plan price and the January date.")
        }
        t.summary = TalkSummary(text: "Agreed to raise Pro to $12.", keyPoints: ["Pro is $12"], actionItems: ["Email customers"], people: [])
        let chunks = KnowledgePieces.talk(t)
        #expect(chunks.first?.heading == "Summary")
        #expect(chunks.first?.text.contains("Agreed to raise Pro") == true)
        #expect(chunks.count > 2)
        #expect(chunks.dropFirst().allSatisfy { ($0.at ?? -1) >= 0 && $0.text.hasPrefix("[") })
    }
}

@Suite("Library: ranking")
struct HybridRankingTests {
    private func unit(_ values: [Float]) -> [Float] { VectorMath.normalized(values) }

    @Test("with no vectors, keywords rank alone")
    func keywordsOnly() {
        let candidates = [
            HybridRanking.Candidate(text: "Groceries milk eggs", vector: nil),
            HybridRanking.Candidate(text: "Pricing: Pro plan goes to $12 in January", vector: nil),
        ]
        let ranked = HybridRanking.rank(candidates, query: "what about pricing?", queryVector: nil, limit: 5)
        #expect(ranked.map(\.index) == [1])
    }

    @Test("meaning reorders pieces that match the same words")
    func meaningReorders() {
        // Both say "plan"; the second means what the question means.
        var candidates = [
            HybridRanking.Candidate(text: "the travel plan for Bali", vector: unit([0, 1, 0])),
            HybridRanking.Candidate(text: "the plan price goes up", vector: unit([1, 0, 0])),
        ]
        candidates += (0..<8).map { _ in HybridRanking.Candidate(text: "unrelated words here", vector: unit([0, 0, 1])) }
        let ranked = HybridRanking.rank(candidates, query: "plan cost", queryVector: unit([1, 0.05, 0]), limit: 5)
        #expect(ranked.first?.index == 1)
        #expect(ranked.count == 2, "pieces matching neither words nor meaning stay out")
    }

    @Test("a piece with no word in common gets in only when its meaning stands out")
    func meaningOnly() {
        var candidates = (0..<10).map { i in
            HybridRanking.Candidate(text: "filler \(i)", vector: unit([0.1 * Float(i % 3), 0, 1]))
        }
        candidates.append(HybridRanking.Candidate(text: "churn rose after onboarding emails stopped", vector: unit([1, 0, 0])))
        let found = HybridRanking.rank(candidates, query: "why are customers leaving", queryVector: unit([1, 0, 0.1]), limit: 3)
        #expect(found.first?.index == 10)
        #expect(found.count == 1)

        // Too few pieces to say what stands out: keywords only.
        let few = Array(candidates.suffix(3))
        #expect(HybridRanking.rank(few, query: "why are customers leaving", queryVector: unit([1, 0, 0.1]), limit: 3).isEmpty)
    }

    @Test("a pinned piece counts without a matching word")
    func pinned() {
        let candidates = [
            HybridRanking.Candidate(text: "Summary of the standup", vector: nil, pinned: true),
            HybridRanking.Candidate(text: "Summary of another day", vector: nil),
        ]
        #expect(HybridRanking.rank(candidates, query: "what happened yesterday", queryVector: nil, limit: 3).map(\.index) == [0])
    }

    @Test("vectors are stored and read back exactly")
    func vectorSet() throws {
        let vectors: [[Float]] = [[0.5, -0.25, 1], [0, 0.125, -1]]
        let set = VectorSet(model: "m#1", dimension: 3, vectors: vectors)
        let back = try JSONDecoder().decode(VectorSet.self, from: JSONEncoder().encode(set))
        #expect(back.vectors == vectors)
        #expect(back.count == 2)
    }

    @Test("taking the average away spreads similar vectors apart")
    func centering() {
        let a = unit([1, 1, 0.1]), b = unit([1, 1, -0.1])
        let mean = VectorMath.mean([a, b], dimension: 3)
        #expect(VectorMath.dot(a, b) > 0.9)
        #expect(VectorMath.dot(VectorMath.centered(a, mean), VectorMath.centered(b, mean)) < 0)
    }
}

@Suite("Library: what a question asks")
struct KnowledgeQueryTests {
    private let now = ISO8601DateFormatter().date(from: "2026-10-22T10:00:00Z")!
    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        return c
    }

    @Test("the words worth matching, in English and Indonesian")
    func terms() {
        #expect(KnowledgeQuery.terms("What did we decide about pricing in last month's calls?") == ["decide", "pricing"])
        #expect(KnowledgeQuery.terms("apa keputusan kita soal harga?") == ["keputusan", "harga"])
        #expect(KnowledgeQuery.terms("the Q3 plan") == ["q3", "plan"])
        #expect(KnowledgeQuery.terms("hi").isEmpty)
    }

    @Test("the time a question names")
    func ranges() throws {
        let yesterday = try #require(KnowledgeQuery.range(in: "what did the call yesterday say?", now: now, calendar: calendar))
        #expect(calendar.component(.day, from: yesterday.start) == 21)
        let lastMonth = try #require(KnowledgeQuery.range(in: "pricing in last month's calls", now: now, calendar: calendar))
        #expect(calendar.component(.month, from: lastMonth.start) == 9)
        let bulanLalu = try #require(KnowledgeQuery.range(in: "rapat bulan lalu", now: now, calendar: calendar))
        #expect(bulanLalu == lastMonth)
        let march = try #require(KnowledgeQuery.range(in: "the offsite in March", now: now, calendar: calendar))
        #expect(calendar.component(.month, from: march.start) == 3 && calendar.component(.year, from: march.start) == 2026)
        let december = try #require(KnowledgeQuery.range(in: "meetings in December", now: now, calendar: calendar))
        #expect(calendar.component(.year, from: december.start) == 2025, "a month still to come means last year's")
        #expect(KnowledgeQuery.range(in: "what is the Pro price?", now: now, calendar: calendar) == nil)
        #expect(KnowledgeQuery.aboutTalks("last week's standup") && !KnowledgeQuery.aboutTalks("my Bali note"))
    }
}

@Suite("Library: what the assistant is given")
struct KnowledgeContextTests {
    private func hit(_ origin: KnowledgeHit.Origin, _ title: String, _ text: String) -> KnowledgeHit {
        KnowledgeHit(origin: origin, title: title, label: title, text: text, score: 1, updatedAt: "2026-10-01T00:00:00.000Z")
    }

    @Test("a short note goes whole, a long one as its passages, a named one not again")
    func notes() {
        let long = (1...80).map { "Line \($0) of the long plan." }.joined(separator: "\n") + "\nThe Pro price is $12."
        let notes = [note("short", "Groceries", "milk, eggs"), note("long", "Plan", long), note("named", "Bali", "Ubud")]
        let hits = [
            hit(.note(id: "named"), "Bali", "Ubud"),
            hit(.note(id: "long"), "Plan", "The Pro price is $12."),
            hit(.note(id: "short"), "Groceries", "milk"),
            hit(.note(id: "long"), "Plan", "Line 1 of the long plan."),
        ]
        let entries = KnowledgeContext.entries(hits, named: ["named"], notes: notes, query: "what's the price?")
        #expect(entries.map(\.relevant.title) == ["Plan", "Groceries"])
        #expect(entries[0].relevant.content == "Line 1 of the long plan.\n…\nThe Pro price is $12.", "passages in the note's order")
        #expect(entries[1].relevant.content == "milk, eggs")
    }

    @Test("a long note the question names by title goes whole")
    func namedByTitle() {
        let long = String(repeating: "Budget detail. ", count: 200)
        let entries = KnowledgeContext.entries([hit(.note(id: "b"), "Budget 2026", "Budget detail.")], named: [],
                                               notes: [note("b", "Budget 2026", long)], query: "summarize budget 2026")
        #expect(entries.first?.relevant.content == String(long.prefix(3_000)))
    }

    @Test("talks and files go as their passages, within the budget")
    func budget() {
        let text = String(repeating: "x", count: 2_000)
        let hits = (0..<8).map { (i: Int) in hit(.library(sourceId: "s", documentId: "d\(i)", page: i, offset: 0), "Doc \(i)", text) }
        let entries = KnowledgeContext.entries(hits, named: [], notes: [], query: "x")
        #expect(entries.count == 5, "9,000 characters at 2,000 each")
    }

    @Test("chips are what the model was given: Apple's model reads only the first two")
    func chips() {
        let hits = [
            hit(.talk(id: "t", at: 65), "Pricing call · 1:05", "[1:05] Andi: twelve dollars"),
            hit(.library(sourceId: "s", documentId: "d", page: 4, offset: 10), "plan.pdf · p. 4", "Pro is $12"),
            hit(.library(sourceId: "s", documentId: "d", page: 4, offset: 900), "plan.pdf · p. 4", "more on page 4"),
            hit(.note(id: "n"), "Pricing", "Pro $12"),
        ]
        let entries = KnowledgeContext.entries(hits, named: [], notes: [note("n", "Pricing", "Pro $12")], query: "price")
        #expect(entries.count == 4)
        let cloud = KnowledgeContext.citations(entries, named: 0, answeredBy: "Claude")
        #expect(cloud.map(\.label) == ["Pricing call · 1:05", "plan.pdf · p. 4", "Pricing"], "one chip per page")
        #expect(KnowledgeContext.citations(entries, named: 0, answeredBy: "Apple Intelligence").count == 2)
        #expect(KnowledgeContext.citations(entries, named: 1, answeredBy: "Apple Intelligence").map(\.label) == ["Pricing call · 1:05"])
        #expect(KnowledgeContext.citations(entries, named: 2, answeredBy: "Apple Intelligence").isEmpty)
    }
}

@Suite("Library: adding, keeping and searching")
@MainActor
struct KnowledgeLibraryTests {
    private func folder() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("fournotes-lib-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func settle(_ library: Knowledge) async {
        for _ in 0..<200 where library.isBusy { try? await Task.sleep(for: .milliseconds(25)) }
        library.flush()
    }

    @Test("a file added is read, found by search, and kept across launches")
    func addSearchReload() async throws {
        let files = folder()
        let file = files.appendingPathComponent("offsite.txt")
        try "The offsite is in Bandung on 14 November. Budget forty million rupiah, twelve people."
            .write(to: file, atomically: true, encoding: .utf8)
        let root = folder()
        let library = Knowledge(root: root)
        let id = try #require(library.add(files: [file]).first)
        await settle(library)
        let source = try #require(library.source(id))
        #expect(source.status == .ready)
        #expect(source.documents.first?.pieces == 1)

        let hits = await library.search("where is the offsite?", notes: [], talks: [], space: nil, limit: 3)
        #expect(hits.first?.title == "From “offsite.txt”")
        guard case .library(let sid, _, _, _) = hits.first?.origin else { Issue.record("expected a library hit"); return }
        #expect(sid == id)

        // A new launch reads what was saved.
        let again = Knowledge(root: root)
        #expect(again.sources.map(\.id) == [id])
        again.start(store: Store(persistence: Persistence(fileURL: root.appendingPathComponent("data.json"))))
        for _ in 0..<100 where again.text(source.documents[0].id) == nil { try? await Task.sleep(for: .milliseconds(25)) }
        #expect(again.text(source.documents[0].id)?.pages.first?.contains("Bandung") == true)
    }

    @Test("a folder's files are read, and one taken out of it leaves the library")
    func folderSource() async throws {
        let dir = folder()
        try "Hiring plan: two engineers in Q1.".write(to: dir.appendingPathComponent("hiring.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("Plans"), withIntermediateDirectories: true)
        try "Pricing: Pro goes to $12.".write(to: dir.appendingPathComponent("Plans/pricing.txt"), atomically: true, encoding: .utf8)
        try Data([0, 1, 2]).write(to: dir.appendingPathComponent("video.mov"))
        let library = Knowledge(root: folder())
        let id = library.add(folder: dir)
        await settle(library)
        #expect(library.source(id)?.documents.map(\.path) == ["hiring.md", "Plans/pricing.txt"])

        try FileManager.default.removeItem(at: dir.appendingPathComponent("hiring.md"))
        library.read(id)
        await settle(library)
        #expect(library.source(id)?.documents.map(\.path) == ["Plans/pricing.txt"])
        let hits = await library.search("pricing", notes: [], talks: [], space: nil, limit: 3)
        #expect(hits.first?.title == "From “Plans/pricing.txt”")
        library.remove(id)
        #expect(await library.search("pricing", notes: [], talks: [], space: nil, limit: 3).isEmpty)
    }

    @Test("notes and talks are searched with the library, a talk by the day asked about")
    func acrossKinds() async {
        let library = Knowledge(root: folder())
        let notes = [note("n1", "Bali trip", "Villa in Ubud, scooter rental."), note("n2", "Groceries", "milk eggs")]
        var call = Talk(createdAt: Date().addingTimeInterval(-86_400), title: "Standup", mode: .call, lang: "en-US")
        call.status = .done
        call.segments = [TalkSegment(speaker: "them", start: 3, end: 8, text: "Budi ships the release on Friday.")]
        let hits = await library.search("scooter in Bali", notes: notes, talks: [call], space: nil, limit: 5)
        #expect(hits.first?.origin == .note(id: "n1"))

        let yesterday = await library.search("what happened in yesterday's meeting?", notes: notes, talks: [call], space: nil, limit: 5)
        #expect(yesterday.first?.origin == .talk(id: call.id, at: 3))
        #expect(await library.search("hi", notes: notes, talks: [call], space: nil, limit: 5).isEmpty)
    }

    @Test("web addresses as typed")
    func webAddresses() {
        #expect(Knowledge.webURL("example.com/post")?.absoluteString == "https://example.com/post")
        #expect(Knowledge.webURL("http://blog.example.org")?.absoluteString == "http://blog.example.org")
        #expect(Knowledge.webURL("not an address") == nil)
        #expect(Knowledge.webURL("localhost") == nil)
    }
}

@Suite("Library: meaning on this Mac")
struct EmbedderTests {
    @Test("Apple's model gives a normalized vector, and finds a paraphrase among unrelated text")
    func paraphrase() async throws {
        guard await Embedder.shared.prepare() else { return }  // No model on this Mac: keywords only.
        let docs = [
            "The hiking trail to the waterfall is closed after heavy rain.",
            "Remember to buy milk, eggs and bread on the way home.",
            "Budi will send the quarterly sales report to the finance team by Friday.",
            "We agreed to raise the price of the Pro plan to $12 a month starting in January.",
        ]
        let vectors = await Embedder.shared.vectors(docs).compactMap { $0 }
        #expect(vectors.count == docs.count)
        let length = sqrt(vectors[0].reduce(0) { $0 + $1 * $1 })
        #expect(abs(length - 1) < 0.001)
        let query = try #require(await Embedder.shared.vector("is the waterfall path open?"))
        let mean = VectorMath.mean(vectors + [query], dimension: query.count)
        let q = VectorMath.centered(query, mean)
        let best = vectors.indices.max { VectorMath.dot(q, VectorMath.centered(vectors[$0], mean)) < VectorMath.dot(q, VectorMath.centered(vectors[$1], mean)) }
        #expect(best == 0)
    }
}
