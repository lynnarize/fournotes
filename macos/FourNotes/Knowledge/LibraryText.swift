import AppKit
import PDFKit
import UniformTypeIdentifiers

// Reading what's in a file or a web page, on this Mac: PDFs page by page (PDFKit, and
// Vision for a scanned page with no text in it), Word and rich text through AppKit's
// readers, text and Markdown as they are, images with Vision as Scan reads them, and
// web pages with their menus, scripts and footers taken out.

enum LibraryText {
    struct Extracted: Equatable {
        var title: String?
        /// One per page for a PDF; one for everything else.
        var pages: [String]

        var isEmpty: Bool { pages.allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    }

    enum Failure: LocalizedError {
        case unsupported, unreadable(String), empty, tooLarge

        var errorDescription: String? {
            switch self {
            case .unsupported: return "Four Notes can't read this kind of file yet."
            case .unreadable(let why): return why
            case .empty: return "There's no text in it to read."
            case .tooLarge: return "It's over 100 MB, too large to read."
            }
        }
    }

    /// Files larger than this are skipped: a folder can hold a disk image or a video.
    static let maxBytes = 100 * 1024 * 1024
    /// Scanned pages are read with Vision, which takes a moment each; past this many the rest are left.
    static let maxScannedPages = 40

    static let markdown = UTType("net.daringfireball.markdown") ?? .plainText
    static let docx = UTType("org.openxmlformats.wordprocessingml.document") ?? .data
    static let doc = UTType("com.microsoft.word.doc") ?? .data
    static let odt = UTType("org.oasis-open.opendocument.text") ?? .data

    /// What the import panel offers.
    static let fileTypes: [UTType] = [.pdf, docx, doc, odt, .rtf, .rtfd, .plainText, markdown, .html, .image]

    static func kind(of url: URL) -> LibraryDocument.Kind? {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "md", "markdown", "mdown": return .markdown
        case "txt", "text", "csv", "tsv", "log": return .text
        default: break
        }
        guard let type = UTType(filenameExtension: ext) else { return nil }
        if type.conforms(to: .pdf) { return .pdf }
        if type.conforms(to: docx) || type.conforms(to: doc) || type.conforms(to: odt) { return .word }
        if type.conforms(to: .rtf) || type.conforms(to: .rtfd) { return .rtf }
        if type.conforms(to: .html) { return .html }
        if type.conforms(to: .image) { return .image }
        if type.conforms(to: markdown) { return .markdown }
        if type.conforms(to: .plainText) || type.conforms(to: .sourceCode) { return .text }
        return nil
    }

    /// Reads a file. Runs off the main thread: a long PDF takes a while.
    nonisolated static func extract(_ url: URL) async throws -> Extracted {
        guard let kind = kind(of: url) else { throw Failure.unsupported }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= maxBytes else { throw Failure.tooLarge }
        let out: Extracted
        switch kind {
        case .pdf:
            guard let document = PDFDocument(url: url) else {
                throw Failure.unreadable(url.lastPathComponent + " couldn't be opened. It may be locked with a password.")
            }
            out = await pdf(document)
        case .word, .rtf:
            out = Extracted(title: nil, pages: [try attributedText(url)])
        case .text, .markdown:
            out = Extracted(title: nil, pages: [try plainText(url)])
        case .html, .web:
            let page = readable(html: try plainText(url))
            out = Extracted(title: page.title, pages: [page.text])
        case .image:
            guard let image = NSImage(contentsOf: url) else { throw Failure.unreadable("The image couldn't be opened.") }
            out = Extracted(title: nil, pages: [await OnDevice.readText(from: image).text])
        }
        guard !out.isEmpty else { throw Failure.empty }
        return out
    }

    /// Each page's text. A page with none is a scan, so Vision reads its picture.
    nonisolated static func pdf(_ document: PDFDocument) async -> Extracted {
        var pages: [String] = []
        var scanned = 0
        for i in 0..<document.pageCount {
            guard let page = document.page(at: i) else { pages.append(""); continue }
            var text = page.string ?? ""
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, scanned < maxScannedPages {
                scanned += 1
                let bounds = page.bounds(for: .mediaBox)
                let scale = min(2, 2000 / max(bounds.width, bounds.height, 1))
                let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
                text = await OnDevice.readText(from: image).text
            }
            pages.append(text)
        }
        let title = (document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return Extracted(title: title?.isEmpty == false ? title : nil, pages: pages)
    }

    /// Word, OpenDocument and rich text, through AppKit's readers (not HTML's, which
    /// needs the main thread).
    nonisolated static func attributedText(_ url: URL) throws -> String {
        do {
            let text = try NSAttributedString(url: url, options: [:], documentAttributes: nil).string
            return text.replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{fffc}", with: "")
        } catch {
            throw Failure.unreadable(url.lastPathComponent + " couldn't be read.")
        }
    }

    /// Text in whatever encoding it was saved in, UTF-8 first.
    nonisolated static func plainText(_ url: URL) throws -> String {
        guard let data = try? Data(contentsOf: url) else { throw Failure.unreadable(url.lastPathComponent + " couldn't be read.") }
        return text(data)
    }

    nonisolated static func text(_ data: Data) -> String {
        if let s = String(data: data, encoding: .utf8) { return s }
        if let s = String(data: data, encoding: .utf16) { return s }
        return String(data: data, encoding: .windowsCP1252) ?? String(decoding: data, as: UTF8.self)
    }

    // MARK: - Web pages

    /// A page's title and its readable text: the article (or main part) if it marks
    /// one, with scripts, styles, menus, headers, footers and forms taken out, headings
    /// as "## " lines and list items as "• ". Plain string work, so it runs anywhere.
    nonisolated static func readable(html raw: String) -> (title: String?, text: String) {
        var html = raw
        let title = first(#"<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']"#, in: html)
            ?? first(#"<title[^>]*>(.*?)</title>"#, in: html)
        html = replace(#"<!--.*?-->"#, in: html, with: " ")
        for tag in ["script", "style", "noscript", "svg", "template", "iframe", "head", "nav", "header", "footer", "aside", "form", "button", "select"] {
            html = replace("<\(tag)\\b[^>]*>.*?</\(tag)>", in: html, with: " ")
        }
        // The article when the page says which part it is, else the main part, else the body.
        for tag in ["article", "main", "body"] {
            let parts = all("<\(tag)\\b[^>]*>(.*?)</\(tag)>", in: html)
            if let longest = parts.max(by: { $0.count < $1.count }), longest.count > 200 || tag == "body" {
                html = longest
                break
            }
        }
        html = replace(#"<h[1-6][^>]*>"#, in: html, with: "\n\n## ")
        html = replace(#"</h[1-6]>"#, in: html, with: "\n\n")
        html = replace(#"<li[^>]*>"#, in: html, with: "\n• ")
        html = replace(#"<br\s*/?>"#, in: html, with: "\n")
        html = replace(#"</?(p|div|section|article|blockquote|pre|ul|ol|table|tr|figure|figcaption|dl|dt|dd|hr)\b[^>]*>"#, in: html, with: "\n\n")
        html = replace(#"</t[dh]>"#, in: html, with: " · ")
        html = replace(#"<[^>]+>"#, in: html, with: "")
        let text = tidy(entities(html))
        return (title.map { tidy(entities($0)) }.flatMap { $0.isEmpty ? nil : $0 }, text)
    }

    /// Lines trimmed, runs of spaces made one, and no more than one empty line in a row;
    /// a "## " with nothing after it dropped.
    nonisolated static func tidy(_ text: String) -> String {
        var out: [String] = []
        for line in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            let clean = line.replacingOccurrences(of: #"[ \t\u{00a0}]+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            if clean == "##" || clean == "•" { continue }
            if clean.isEmpty, out.last?.isEmpty ?? true { continue }
            out.append(clean)
        }
        while out.last?.isEmpty == true { out.removeLast() }
        return out.joined(separator: "\n")
    }

    private static let named: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "mdash": "—", "ndash": "–",
        "hellip": "…", "rsquo": "’", "lsquo": "‘", "ldquo": "“", "rdquo": "”", "copy": "©", "reg": "®",
        "trade": "™", "bull": "•", "middot": "·", "euro": "€", "pound": "£", "times": "×", "laquo": "«", "raquo": "»",
    ]

    nonisolated static func entities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        let regex = try! NSRegularExpression(pattern: "&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);")
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in regex.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let name = ns.substring(with: m.range(at: 1))
            var replacement: String?
            if name.hasPrefix("#x") || name.hasPrefix("#X") {
                replacement = UInt32(name.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else if name.hasPrefix("#") {
                replacement = UInt32(name.dropFirst()).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else {
                replacement = named[name.lowercased()]
            }
            out += replacement ?? ns.substring(with: m.range)
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        return out
    }

    private static func regex(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators])
    }

    private static func replace(_ pattern: String, in s: String, with template: String) -> String {
        guard let r = regex(pattern) else { return s }
        return r.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length),
                                          withTemplate: NSRegularExpression.escapedTemplate(for: template))
    }

    private static func first(_ pattern: String, in s: String) -> String? {
        guard let r = regex(pattern),
              let m = r.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)),
              m.numberOfRanges > 1, m.range(at: 1).location != NSNotFound else { return nil }
        return (s as NSString).substring(with: m.range(at: 1))
    }

    private static func all(_ pattern: String, in s: String) -> [String] {
        guard let r = regex(pattern) else { return [] }
        return r.matches(in: s, range: NSRange(location: 0, length: (s as NSString).length)).compactMap {
            $0.range(at: 1).location == NSNotFound ? nil : (s as NSString).substring(with: $0.range(at: 1))
        }
    }

    // MARK: - Fetching a page

    /// Fetches a web page (or a PDF or text file at an address) and reads it.
    nonisolated static func fetch(_ url: URL) async throws -> Extracted {
        var request = URLRequest(url: url, timeoutInterval: 25)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
                         forHTTPHeaderField: "User-Agent")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure.unreadable("The page couldn't be reached. Check the address and your connection.")
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw Failure.unreadable("The page answered with an error (\(http.statusCode)).")
        }
        guard data.count <= maxBytes else { throw Failure.tooLarge }
        let type = (response.mimeType ?? "").lowercased()
        let out: Extracted
        if type == "application/pdf" || url.pathExtension.lowercased() == "pdf" {
            guard let document = PDFDocument(data: data) else { throw Failure.unreadable("The PDF couldn't be opened.") }
            out = await pdf(document)
        } else if type.hasPrefix("text/plain") || type == "text/markdown" {
            out = Extracted(title: nil, pages: [text(data)])
        } else {
            let page = readable(html: text(data))
            out = Extracted(title: page.title, pages: [page.text])
        }
        guard !out.isEmpty else { throw Failure.empty }
        return out
    }
}
