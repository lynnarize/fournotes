import AppKit
import PDFKit
import Testing
@testable import FourNotes

// Reading what's added to the library: each kind of file comes back as its text, a PDF
// page by page, and a web page without its menus and scripts.

@Suite("Library: reading files")
@MainActor
struct LibraryTextTests {
    private func folder() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("fournotes-libtext-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// A PDF with real (selectable) text on each page, as a word processor writes one.
    private func pdf(_ pages: [String], at url: URL) {
        let document = PDFDocument()
        for (i, text) in pages.enumerated() {
            let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 612, height: 792))
            view.string = text
            guard let page = PDFDocument(data: view.dataWithPDF(inside: view.bounds))?.page(at: 0) else { continue }
            document.insert(page, at: i)
        }
        document.write(to: url)
    }

    @Test("a PDF is read page by page")
    func pdfPages() async throws {
        let url = folder().appendingPathComponent("plan.pdf")
        pdf(["Quarterly plan: hire two engineers.", "Budget: raise the Pro price to $12."], at: url)
        let read = try await LibraryText.extract(url)
        #expect(read.pages.count == 2)
        #expect(read.pages[0].contains("hire two engineers"))
        #expect(read.pages[1].contains("Pro price"))
    }

    @Test("Word, rich text and text files are read as text")
    func documents() async throws {
        let dir = folder()
        let text = NSAttributedString(string: "Standup notes\n\nBudi sends the sales report on Friday.")
        let range = NSRange(location: 0, length: text.length)

        let rtf = dir.appendingPathComponent("notes.rtf")
        try text.rtf(from: range, documentAttributes: [:])?.write(to: rtf)
        #expect(try await LibraryText.extract(rtf).pages[0].contains("sales report"))

        let docx = dir.appendingPathComponent("notes.docx")
        try text.data(from: range, documentAttributes: [.documentType: NSAttributedString.DocumentType.officeOpenXML]).write(to: docx)
        #expect(try await LibraryText.extract(docx).pages[0].contains("sales report"))

        let md = dir.appendingPathComponent("notes.md")
        try "# Standup\n\nBudi sends the sales report.".write(to: md, atomically: true, encoding: .utf8)
        let read = try await LibraryText.extract(md)
        #expect(read.pages == ["# Standup\n\nBudi sends the sales report."])
    }

    @Test("a file with nothing to read says so")
    func empty() async {
        let url = folder().appendingPathComponent("empty.txt")
        try? "  \n ".write(to: url, atomically: true, encoding: .utf8)
        await #expect(throws: LibraryText.Failure.self) { try await LibraryText.extract(url) }
    }

    @Test("kinds are told by extension")
    func kinds() {
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.pdf")) == .pdf)
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.docx")) == .word)
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.md")) == .markdown)
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.html")) == .html)
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.png")) == .image)
        // A Google Doc in Drive for desktop's folder is a link, not a document.
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.gdoc")) == nil)
        #expect(LibraryText.kind(of: URL(fileURLWithPath: "/a/b.mov")) == nil)
    }

    @Test("a web page is read without its menus, scripts and footer")
    func webPage() {
        let html = """
        <html><head><title>Pricing update &amp; plans</title><style>p{color:red}</style>
        <script>var tracking = "do not read";</script></head>
        <body><nav><a href="/">Home</a> <a href="/blog">Blog</a></nav>
        <header>Site name</header>
        <article><h1>We&rsquo;re raising prices</h1>
        <p>From January the Pro plan costs $12 a month, up from $10. This is the first change in three years and it pays for the new sync service.</p>
        <ul><li>Free stays free</li><li>Teams get 20&#37; off</li></ul></article>
        <aside>Related posts</aside><footer>© 2026 Company</footer></body></html>
        """
        let page = LibraryText.readable(html: html)
        #expect(page.title == "Pricing update & plans")
        #expect(page.text.contains("## We’re raising prices"))
        #expect(page.text.contains("Pro plan costs $12 a month"))
        #expect(page.text.contains("• Free stays free"))
        #expect(page.text.contains("20% off"))
        for gone in ["tracking", "Home", "Site name", "Related posts", "Company", "color:red"] {
            #expect(!page.text.contains(gone), "\(gone) should have been taken out")
        }
    }

    @Test("an HTML file is read the same way")
    func htmlFile() async throws {
        let url = folder().appendingPathComponent("saved.html")
        try "<html><body><main><p>Saved page about the offsite in Bandung, two days, twelve people, with a budget of forty million rupiah for everything.</p></main></body></html>"
            .write(to: url, atomically: true, encoding: .utf8)
        #expect(try await LibraryText.extract(url).pages[0].contains("offsite in Bandung"))
    }
}
