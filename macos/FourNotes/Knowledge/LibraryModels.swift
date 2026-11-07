import Foundation

// The library: files, folders and web pages you add so the assistant can answer from
// them, as Foresight's "Sources". Kept on this Mac only, beside the talks, and never
// synced: a folder of PDFs is far too much for the notes file.
//
//   Application Support/FourNotes/Library/library.json     every source
//   Application Support/FourNotes/Library/Docs/<id>.json   one document's text, its pieces and their vectors
//   Application Support/FourNotes/Library/Index/           vectors for notes and talks (rebuilt if lost)

struct LibrarySource: Codable, Equatable, Identifiable {
    enum Kind: String, Codable { case file, folder, web }
    enum Status: String, Codable { case indexing, ready, failed }

    var id: String
    var kind: Kind
    /// The file's or folder's name, or the page's title.
    var title: String
    /// A path for a file or folder, the address for a web page.
    var location: String
    /// Security-scoped, so the sandboxed app can read the file again after a relaunch.
    var bookmark: Data?
    var spaceId: String?
    var addedAt: String
    var indexedAt: String?
    var status: Status
    /// Why it couldn't be read, in words.
    var problem: String?
    /// A file has one; a folder one per file inside it; a page one.
    var documents: [LibraryDocument]

    var bytes: Int { documents.reduce(0) { $0 + $1.bytes } }
    var pieces: Int { documents.reduce(0) { $0 + $1.pieces } }
    var url: URL? { kind == .web ? URL(string: location) : URL(fileURLWithPath: location) }
}

struct LibraryDocument: Codable, Equatable, Identifiable {
    enum Kind: String, Codable { case pdf, word, rtf, text, markdown, html, image, web }

    var id: String
    var name: String
    /// Inside a folder, the path below it ("Plans/Q3.pdf"); otherwise the name.
    var path: String
    var kind: Kind
    var bytes: Int
    /// When the file last changed, so a folder's changes are read again and nothing else.
    var modified: String?
    var pages: Int?
    var pieces: Int
    var problem: String?

    var kindName: String {
        switch kind {
        case .pdf: return "PDF"
        case .word: return "Word"
        case .rtf: return "Rich text"
        case .text: return "Text"
        case .markdown: return "Markdown"
        case .html: return "Web page"
        case .image: return "Image"
        case .web: return "Web page"
        }
    }
}

/// A piece of a document, note or talk: about a paragraph or two, small enough that
/// Apple's model can read two of them and the embedding model all of one.
struct KnowledgeChunk: Codable, Equatable, Hashable, Sendable {
    var text: String
    /// 1-based, for PDFs.
    var page: Int?
    /// The heading it sits under, when the text has headings.
    var heading: String?
    /// Where it starts in its page's text, in characters, to find it again.
    var offset: Int
    /// A talk's piece: seconds from the start.
    var at: Double?
}

/// One document's text as read, its pieces, and a vector for each piece.
struct LibraryDocumentText: Codable, Equatable {
    var documentId: String
    /// Page by page; one page for everything but a PDF.
    var pages: [String]
    var chunks: [KnowledgeChunk]
    var vectors: VectorSet?
}

/// Float32 vectors, one per piece, packed together. Stored as raw bytes (base64 in the
/// JSON), a few kilobytes a piece, and read straight back.
struct VectorSet: Codable, Equatable, Sendable {
    /// The embedding model and its revision: vectors from another model don't compare.
    var model: String
    var dimension: Int
    var data: Data

    init(model: String, dimension: Int, vectors: [[Float]]) {
        self.model = model
        self.dimension = dimension
        var floats: [Float] = []
        floats.reserveCapacity(vectors.count * dimension)
        for v in vectors where v.count == dimension { floats += v }
        data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    var count: Int { dimension > 0 ? data.count / (dimension * MemoryLayout<Float>.size) : 0 }

    var vectors: [[Float]] {
        guard dimension > 0 else { return [] }
        // Copied out rather than bound in place: Data's bytes needn't be aligned for Float.
        var floats = [Float](repeating: 0, count: data.count / MemoryLayout<Float>.size)
        _ = floats.withUnsafeMutableBytes { data.copyBytes(to: $0) }
        return stride(from: 0, to: floats.count - dimension + 1, by: dimension).map { Array(floats[$0..<$0 + dimension]) }
    }
}

/// A note's or a talk's pieces and vectors, as of one version of it.
struct IndexedItem: Codable, Equatable {
    /// The note's `updatedAt`, the talk's `updatedAt`: a newer one means read it again.
    var version: String
    var chunks: [KnowledgeChunk]
    var vectors: VectorSet?
}
