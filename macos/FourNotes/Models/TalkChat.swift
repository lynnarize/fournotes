import Foundation

// What was asked about a talk, while it ran and after: the questions Live Q&A noticed in
// the conversation and answered from your notes and library (Talk.answers), and your own
// chat about it (Talk.chat). Kept on the talk, so they're still there on its page.

/// Where part of an answer came from, as a talk keeps it: a `KnowledgeCitation` that can
/// be saved with the talk.
struct TalkCitation: Codable, Equatable, Hashable {
    enum Kind: String, Codable { case note, talk, library }
    var kind: Kind
    /// The note's, the talk's or the library source's id.
    var id: String
    /// Seconds into a talk.
    var at: Double?
    var documentId: String?
    var page: Int?
    var offset: Int?
    /// "Q3 plan.pdf · p. 4"
    var label: String
    /// "From “Q3 plan.pdf”, page 4"
    var title: String

    init(_ c: KnowledgeCitation) {
        label = c.label
        title = c.title
        switch c.origin {
        case .note(let id):
            kind = .note
            self.id = id
        case .talk(let id, let at):
            kind = .talk
            self.id = id
            self.at = at
        case .library(let source, let document, let page, let offset):
            kind = .library
            id = source
            documentId = document
            self.page = page
            self.offset = offset
        }
    }

    var citation: KnowledgeCitation {
        let origin: KnowledgeHit.Origin
        switch kind {
        case .note: origin = .note(id: id)
        case .talk: origin = .talk(id: id, at: at ?? 0)
        case .library: origin = .library(sourceId: id, documentId: documentId ?? "", page: page, offset: offset ?? 0)
        }
        return KnowledgeCitation(origin: origin, label: label, title: title)
    }
}

/// A question someone asked while the talk ran, and the answer Live Q&A found for it.
struct TalkAnswer: Codable, Equatable, Identifiable {
    var id = UUID().uuidString.lowercased()
    /// Who asked, as the transcript names speakers ("them", "me", "A").
    var speaker: String
    /// Seconds into the talk.
    var at: Double
    var question: String
    var answer: String
    var sources: [TalkCitation]
    /// The model that answered ("Apple Intelligence", "Claude"), and whether on this Mac.
    var by: String
    var onThisMac: Bool
}

/// One message in a chat about a talk.
struct TalkChatMessage: Codable, Equatable, Identifiable {
    enum Role: String, Codable { case user, assistant }
    var id = UUID().uuidString.lowercased()
    var role: Role
    var text: String
    /// Seconds into the talk, for a question asked while it was being recorded.
    var at: Double?
    var sources: [TalkCitation] = []
    /// The model that answered, and whether on this Mac. Nil for your own messages.
    var by: String?
    var onThisMac: Bool?
}
