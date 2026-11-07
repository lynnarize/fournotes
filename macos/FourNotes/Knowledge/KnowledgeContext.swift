import Foundation

// Which search hits the assistant is given with a question, and which it then cites.
//
// A note found by its passages goes whole when it's short or the question names it, as
// notes always have; a long one goes as the passages that matched. A talk's minute and
// a file's passage go as they are. All within a budget, best first — and order matters:
// Apple's model reads only the first two (1,200 characters of each), so the best go first.

/// A chip under a reply: where part of the answer came from, and how to open it there.
struct KnowledgeCitation: Equatable, Hashable, Sendable {
    var origin: KnowledgeHit.Origin
    /// "Q3 plan.pdf · p. 4"
    var label: String
    /// "From “Q3 plan.pdf”, page 4"
    var title: String

    var icon: String {
        switch origin {
        case .note: return "fileText"
        case .talk: return "wave"
        case .library: return "book"
        }
    }
}

enum KnowledgeContext {
    struct Entry {
        var relevant: ClientContext.RelevantNote
        var citation: KnowledgeCitation
    }

    static let maxEntries = 6
    /// Characters, across every entry: a few pages.
    static let budget = 9_000
    /// A note this short goes whole.
    static let wholeNote = 1_500

    static func entries(_ hits: [KnowledgeHit], named: Set<String>, notes: [Note], query: String) -> [Entry] {
        var out: [Entry] = []
        var used = 0
        var seenNotes: Set<String> = []
        let asked = query.lowercased()
        for hit in hits {
            guard out.count < maxEntries, used < budget else { break }
            let content: String
            switch hit.origin {
            case .note(let id):
                guard !named.contains(id), seenNotes.insert(id).inserted, let note = notes.first(where: { $0.id == id }) else { continue }
                let title = note.title.trimmingCharacters(in: .whitespaces).lowercased()
                if note.content.count <= wholeNote || (title.count > 2 && asked.contains(title)) {
                    content = String(note.content.prefix(3_000))
                } else {
                    // This note's best two passages, in the note's own order.
                    let passages = hits.filter { $0.origin == hit.origin }.prefix(2).map(\.text)
                    content = passages.sorted {
                        (note.content.range(of: $0)?.lowerBound ?? note.content.endIndex)
                            < (note.content.range(of: $1)?.lowerBound ?? note.content.endIndex)
                    }.joined(separator: "\n…\n")
                }
            case .talk, .library:
                content = hit.text
            }
            out.append(Entry(relevant: .init(title: hit.title, content: content, updatedAt: hit.updatedAt),
                             citation: KnowledgeCitation(origin: hit.origin, label: hit.label, title: hit.title)))
            used += content.count
        }
        return out
    }

    /// The chips for a reply: what the model that answered was given, and no more. The
    /// notes the question named come first and aren't cited (the user knows them).
    static func citations(_ entries: [Entry], named: Int, answeredBy: String?) -> [KnowledgeCitation] {
        let given = answeredBy == "Apple Intelligence" ? max(0, 2 - named) : entries.count
        var out: [KnowledgeCitation] = []
        for entry in entries.prefix(given) where !out.contains(where: { $0.label == entry.citation.label }) {
            out.append(entry.citation)
        }
        return out
    }
}
