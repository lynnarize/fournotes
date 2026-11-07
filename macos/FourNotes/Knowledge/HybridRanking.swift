import Foundation

// One ranking from two signals. Keywords (BM25, as Notes' search) are the one to trust:
// the embedding model is loose (see Embedder). So a piece's score is mostly how well its
// words match, with meaning added on top, and a piece that shares no word with the
// question gets in only when its meaning stands well clear of everything else's.

enum HybridRanking {
    struct Candidate: Sendable {
        /// What keywords are matched against: the piece and what it's part of.
        var text: String
        /// Centred and normalized (VectorMath.centered), or nil when it has none yet.
        var vector: [Float]?
        /// Counted as a keyword match whatever its words: a talk on the day the question names.
        var pinned = false
    }

    struct Ranked: Equatable, Sendable {
        var index: Int
        var score: Double
        var keyword: Double
        /// How many standard deviations its similarity is above the average piece's.
        var meaning: Double
    }

    static let keywordWeight = 0.65
    static let meaningWeight = 0.35
    /// A piece no keyword matched needs to be this far above the rest by meaning.
    static let meaningOnly = 2.0
    /// Below this many pieces with vectors, "above the rest" says little.
    static let meaningPool = 8

    static func rank(_ candidates: [Candidate], query: String, queryVector: [Float]?, limit: Int) -> [Ranked] {
        guard !candidates.isEmpty else { return [] }
        let words = KnowledgeQuery.terms(query)
        let keywords = words.isEmpty ? [Double](repeating: 0, count: candidates.count)
            : Search.bm25(candidates.map(\.text), words.joined(separator: " "))
        let top = keywords.max() ?? 0

        var meaning = [Double](repeating: 0, count: candidates.count)
        var pool = 0
        if let q = queryVector {
            var sims: [(Int, Double)] = []
            for (i, c) in candidates.enumerated() {
                if let v = c.vector, v.count == q.count { sims.append((i, Double(VectorMath.dot(q, v)))) }
            }
            pool = sims.count
            if sims.count >= 2 {
                let mean = sims.reduce(0) { $0 + $1.1 } / Double(sims.count)
                let variance = sims.reduce(0) { $0 + ($1.1 - mean) * ($1.1 - mean) } / Double(sims.count)
                let sd = sqrt(variance)
                if sd > 1e-6 { for (i, s) in sims { meaning[i] = (s - mean) / sd } }
            }
        }

        var out: [Ranked] = []
        for i in candidates.indices {
            let kw = top > 0 ? keywords[i] / top : 0
            let matched = keywords[i] > 0 || candidates[i].pinned
            let z = meaning[i]
            guard matched || (pool >= meaningPool && z >= meaningOnly) else { continue }
            let kwPart = max(kw, candidates[i].pinned ? 0.5 : 0)
            let meaningPart = min(1, max(0, (z - 1) / 2))
            out.append(Ranked(index: i, score: keywordWeight * kwPart + meaningWeight * meaningPart, keyword: kw, meaning: z))
        }
        return Array(out.sorted { $0.score > $1.score || ($0.score == $1.score && $0.index < $1.index) }.prefix(limit))
    }
}
