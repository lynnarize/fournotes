import Foundation

// Cutting text into pieces the assistant can be given: about a paragraph or two each,
// a little of the one before carried over so a sentence split between them isn't lost.
// A piece never runs across a page, so its page number is exact, and it remembers the
// heading it sits under.

enum KnowledgeChunker {
    /// About 800 characters. Apple's model reads 1,200 of each of the two passages it's
    /// given, and the embedding model reads 256 tokens, about 1,000 characters of English.
    static let target = 800
    /// Carried over from the piece before.
    static let overlap = 150

    /// Pieces of a document, page by page. `paged` numbers them (PDFs).
    static func chunks(pages: [String], paged: Bool) -> [KnowledgeChunk] {
        var out: [KnowledgeChunk] = []
        var heading: String?
        for (index, page) in pages.enumerated() {
            for piece in chunks(page, heading: &heading) {
                var piece = piece
                if paged { piece.page = index + 1 }
                out.append(piece)
            }
        }
        return out
    }

    /// Pieces of one page. `heading` carries the last heading over to the next page.
    static func chunks(_ text: String, heading: inout String?) -> [KnowledgeChunk] {
        var out: [KnowledgeChunk] = []
        var current: [Paragraph] = []
        var hasNew: Bool { current.contains { !$0.carried } }

        // The heading isn't in a piece's text: it's said beside it, and read with it.
        func flush(carryOver: Bool) {
            guard let first = current.first, hasNew else { current = []; return }
            out.append(KnowledgeChunk(text: current.map(\.text).joined(separator: "\n\n"), page: nil,
                                      heading: heading, offset: first.offset))
            if carryOver, let last = current.last, last.text.count > overlap {
                let tail = Self.tail(of: last.text)
                current = [Paragraph(text: tail, offset: last.offset + last.text.count - tail.count, isHeading: false, carried: true)]
            } else {
                current = []
            }
        }

        for paragraph in paragraphs(text) {
            if paragraph.isHeading {
                // A new section starts a new piece; nothing carries over into it.
                flush(carryOver: false)
                heading = paragraph.headingText.isEmpty ? heading : paragraph.headingText
                continue
            }
            for part in split(paragraph) {
                let length = current.reduce(0) { $0 + $1.text.count + 2 }
                if length + part.text.count > target, hasNew { flush(carryOver: true) }
                current.append(part)
            }
        }
        flush(carryOver: false)
        return out
    }

    struct Paragraph: Equatable {
        var text: String
        /// Characters from the start of the page.
        var offset: Int
        var isHeading: Bool
        /// Carried over from the piece before; a piece of only these isn't a piece.
        var carried = false

        var headingText: String {
            text.drop { $0 == "#" || $0 == " " }.trimmingCharacters(in: .whitespaces)
        }
    }

    /// Paragraphs split at empty lines; a "#" line is a heading on its own. Text with
    /// no empty lines (a transcript, a PDF page) is split at line breaks instead.
    static func paragraphs(_ text: String) -> [Paragraph] {
        let lines = text.components(separatedBy: "\n")
        let hasBlankLines = lines.contains { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        var out: [Paragraph] = []
        var buffer: [String] = []
        var bufferStart = 0
        var offset = 0

        func push() {
            let joined = buffer.joined(separator: hasBlankLines ? "\n" : " ").trimmingCharacters(in: .whitespaces)
            if !joined.isEmpty { out.append(Paragraph(text: joined, offset: bufferStart, isHeading: false)) }
            buffer = []
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                push()
            } else if trimmed.hasPrefix("#"), trimmed.count < 160 {
                push()
                out.append(Paragraph(text: trimmed, offset: offset, isHeading: true))
            } else {
                if buffer.isEmpty { bufferStart = offset }
                buffer.append(trimmed)
                // A PDF page breaks lines mid-sentence; a line ending a sentence ends a paragraph.
                if !hasBlankLines, buffer.joined().count >= target / 2,
                   let end = trimmed.last, ".!?:”\"".contains(end) {
                    push()
                }
            }
            offset += line.count + 1
        }
        push()
        return out
    }

    /// A paragraph longer than a piece, cut at sentence ends (or, failing that, spaces).
    static func split(_ p: Paragraph) -> [Paragraph] {
        guard p.text.count > target else { return [p] }
        let text = p.text
        var out: [Paragraph] = []
        var start = text.startIndex

        func add(_ end: String.Index) {
            let piece = text[start..<end].trimmingCharacters(in: .whitespaces)
            if !piece.isEmpty {
                out.append(Paragraph(text: piece, offset: p.offset + text.distance(from: text.startIndex, to: start), isHeading: false))
            }
        }

        while text.distance(from: start, to: text.endIndex) > target {
            let limit = text.index(start, offsetBy: target)
            let window = text[start..<limit]
            var cut = limit
            if let end = window.lastIndex(where: { ".!?".contains($0) }), text.distance(from: start, to: end) > target / 3 {
                cut = text.index(after: end)
            } else if let space = window.lastIndex(of: " "), space > start {
                cut = space
            }
            add(cut)
            start = cut
            while start < text.endIndex, text[start] == " " { start = text.index(after: start) }
        }
        add(text.endIndex)
        return out
    }

    /// The last ~150 characters, from a sentence or word start.
    static func tail(of text: String) -> String {
        let window = text.suffix(overlap)
        if let sentence = window.firstIndex(where: { ".!?".contains($0) }), window.index(after: sentence) < window.endIndex {
            let after = window[window.index(after: sentence)...].trimmingCharacters(in: .whitespaces)
            if after.count > overlap / 3 { return after }
        }
        if let space = window.firstIndex(of: " ") {
            return window[window.index(after: space)...].trimmingCharacters(in: .whitespaces)
        }
        return String(window)
    }
}
