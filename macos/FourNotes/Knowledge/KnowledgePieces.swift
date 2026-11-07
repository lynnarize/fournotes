import Foundation

// Notes and talks cut into the same pieces as the library's files, so one search
// covers all three. A talk is cut as the assistant has always read it (TalkText.passages):
// its write-up, then about a minute of conversation at a time.

enum KnowledgePieces {
    static func note(_ note: Note) -> [KnowledgeChunk] {
        var heading: String? = nil
        return KnowledgeChunker.chunks(note.content, heading: &heading)
    }

    static func talk(_ talk: Talk) -> [KnowledgeChunk] {
        var out: [KnowledgeChunk] = []
        if let s = talk.summary {
            let text = "Summary: \(s.text)\nKey points: \(s.keyPoints.joined(separator: "; "))\nAction items: \(s.actionItems.joined(separator: "; "))"
            out.append(KnowledgeChunk(text: text, page: nil, heading: "Summary", offset: 0, at: 0))
        }
        let turns = TalkText.turns(talk)
        var i = 0
        while i < turns.count {
            var j = i, length = 0
            while j < turns.count && (length < 900 || j == i) { length += turns[j].text.count; j += 1 }
            let text = turns[i..<j].map { "[\(TalkText.clock($0.start))] \($0.name): \($0.text)" }.joined(separator: "\n")
            out.append(KnowledgeChunk(text: text, page: nil, heading: nil, offset: i, at: turns[i].start))
            i = j
        }
        return out
    }

    /// What the embedding model reads for a piece: what it belongs to, its heading, then
    /// the piece, so "the Bali note" and a paragraph under "Budget" both mean something.
    static func embedding(_ chunk: KnowledgeChunk, in title: String) -> String {
        [title, chunk.heading ?? "", chunk.text].filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// What keywords are matched against: the title counts twice, as in Notes' search.
    static func keywords(_ chunk: KnowledgeChunk, in title: String) -> String {
        "\(title) \(title) \(chunk.heading ?? "") \(chunk.text)"
    }
}
