import AppKit
import PDFKit
import SwiftUI

// One source: what it is, how its reading went, and what was read — the PDF itself at
// the cited page, or the text with the cited passage marked. A folder lists its files
// first; one opens like a file.

struct SourcePage: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var assistant: Assistant
    @ObservedObject private var library = Knowledge.shared
    let source: LibrarySource

    /// The document showing: a file's or a page's only one, or the folder's file picked.
    private var document: LibraryDocument? {
        if source.kind != .folder { return source.documents.first }
        return nav.selectedDocumentId.flatMap { id in source.documents.first { $0.id == id } }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(p.borderSubtle).frame(height: 1)
            if let document, library.text(document.id) != nil {
                VStack(alignment: .leading, spacing: 0) {
                    titleBlock(document).padding(.horizontal, 40).padding(.top, 28).padding(.bottom, 16)
                    DocumentPreview(source: source, document: document)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        titleBlock(nil)
                        if source.kind == .folder { files }
                    }
                    .frame(maxWidth: 680, alignment: .leading)
                    .padding(.horizontal, 40)
                    .padding(.top, 36)
                    .padding(.bottom, 90)
                    .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.never)
            }
        }
        .background(p.bg)
        // A cited passage in a folder opens its file.
        .task(id: nav.libraryPassage) {
            if let passage = nav.libraryPassage, source.documents.contains(where: { $0.id == passage.documentId }) {
                nav.selectedDocumentId = passage.documentId
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            if source.kind == .folder, document != nil {
                SecondaryButton(title: source.title, icon: "chevronLeft") { nav.selectedDocumentId = nil }
                    .fixedSize()
                    .help("Back to the folder")
            }
            Spacer()
            SecondaryButton(title: library.working[source.id] == nil ? "Read again" : "Reading…", icon: "refresh") {
                library.read(source.id)
            }
            .fixedSize()
            .disabled(library.working[source.id] != nil)
            IconMenu("more", size: 20, help: "More actions", align: .trailing) {
                var entries: [MenuEntry] = []
                if source.kind == .web {
                    entries.append(.item("Open the page") { if let url = URL(string: source.location) { NSWorkspace.shared.open(url) } })
                    entries.append(.item("Copy the address") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(source.location, forType: .string)
                    })
                } else {
                    entries.append(.item("Show in Finder") { showInFinder() })
                    if let document, source.kind == .folder {
                        entries.append(.item("Open “\(document.name)”") { open(document) })
                    } else if let document {
                        entries.append(.item("Open in its app") { open(document) })
                    }
                }
                entries.append(.item("Ask the assistant about it") { ask() })
                entries += [.divider, .item("Remove from library", destructive: true) { remove() }]
                return entries
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 60)
    }

    private func titleBlock(_ document: LibraryDocument?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(document.map { source.kind == .folder ? $0.name : source.title } ?? source.title)
                    .font(FN.display(document == nil ? 36 : 28))
                    .tracking(FN.displayTracking(document == nil ? 36 : 28))
                    .foregroundStyle(p.foreground)
                    .lineLimit(2)
                    .textSelection(.enabled)
                Text(meta(document))
                    .font(FN.small).monospacedDigit().foregroundStyle(p.textMuted)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
            if let working = library.working[source.id] {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(working).font(FN.body).foregroundStyle(p.textSecondary)
                }
                .accessibilityElement(children: .combine)
            } else if let problem = document?.problem ?? source.problem {
                problemBox(problem)
            }
        }
    }

    private func meta(_ document: LibraryDocument?) -> String {
        var parts: [String] = []
        if let document {
            parts.append(LibraryFormat.summary(document))
            if source.kind == .folder { parts.append(document.path) }
        } else {
            parts.append(LibraryFormat.summary(source))
        }
        let pieces = document?.pieces ?? source.pieces
        if pieces > 0 { parts.append("\(pieces) \(pieces == 1 ? "passage" : "passages")") }
        if let read = source.indexedAt { parts.append("Read " + Fmt.relative(read)) }
        return parts.joined(separator: " · ")
    }

    private func problemBox(_ problem: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Icon("info", size: 14).foregroundStyle(p.warning)
            Text(problem).font(FN.small).foregroundStyle(p.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    // MARK: - A folder's files

    private var files: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Files").font(FN.sectionTitle).foregroundStyle(p.foreground)
            if source.documents.isEmpty {
                Text(library.working[source.id] == nil ? "Nothing in this folder can be read yet." : "Looking inside…")
                    .font(FN.body).foregroundStyle(p.textMuted)
            }
            LazyVStack(spacing: 2) {
                ForEach(source.documents) { doc in
                    FileRow(doc: doc) { nav.selectedDocumentId = doc.id }
                }
            }
        }
    }

    // MARK: - Actions

    private func showInFinder() {
        let url = URL(fileURLWithPath: source.location)
        if let document, source.kind == .folder {
            NSWorkspace.shared.activateFileViewerSelecting([url.appendingPathComponent(document.path)])
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    private func open(_ document: LibraryDocument) {
        let base = URL(fileURLWithPath: source.location)
        NSWorkspace.shared.open(source.kind == .folder ? base.appendingPathComponent(document.path) : base)
    }

    private func ask() {
        let name = document?.name ?? source.title
        nav.assistantDraft = "In “\(name)” in my library: "
    }

    private func remove() {
        let title = source.title
        library.remove(source.id)
        nav.selectedSourceId = nil
        AppModel.shared.toasts.push("Removed “\(title)” from the library")
    }
}

private struct FileRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let doc: LibraryDocument
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Icon(LibraryFormat.icon(doc), size: 14).foregroundStyle(p.textMuted)
                Text(doc.path).font(FN.body).foregroundStyle(p.foreground).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                if doc.problem != nil {
                    StatusPill(text: "Couldn't read", tone: .bad, dot: false).help(doc.problem ?? "")
                } else {
                    Text(LibraryFormat.summary(doc)).font(FN.small).foregroundStyle(p.textMuted).lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(hovering ? p.hover : .clear, in: RoundedRectangle(cornerRadius: FN.radiusSmall, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
    }
}

// MARK: - What was read

/// A PDF as itself, at the cited page with the passage selected; anything else as the
/// text that was read, the cited passage marked.
private struct DocumentPreview: View {
    @EnvironmentObject private var nav: Navigation
    @ObservedObject private var library = Knowledge.shared
    let source: LibrarySource
    let document: LibraryDocument

    @State private var pdf: PDFDocument?
    @State private var scoped: URL?

    private var passage: Navigation.LibraryPassage? {
        nav.libraryPassage.flatMap { $0.documentId == document.id ? $0 : nil }
    }

    var body: some View {
        Group {
            if let pdf {
                PDFPreview(document: pdf, page: passage?.page, selection: selection(in: pdf))
            } else if let text = library.text(document.id) {
                TextPreview(pages: text.pages, paged: document.kind == .pdf, passage: passage)
            }
        }
        .task(id: document.id) { load() }
        .onDisappear {
            scoped?.stopAccessingSecurityScopedResource()
            scoped = nil
        }
    }

    private func load() {
        guard document.kind == .pdf, source.kind != .web else { pdf = nil; return }
        var url = URL(fileURLWithPath: source.location)
        if source.kind == .folder {
            url = url.appendingPathComponent(document.path)
        } else if let bookmark = source.bookmark {
            var stale = false
            if let resolved = try? URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope], relativeTo: nil,
                                       bookmarkDataIsStale: &stale) {
                url = resolved
                if url.startAccessingSecurityScopedResource() { scoped = url }
            }
        }
        // Moved or gone: the text that was read still shows.
        pdf = PDFDocument(url: url)
    }

    /// The cited passage's first line or so, to select on its page.
    private func selection(in pdf: PDFDocument) -> PDFSelection? {
        guard let passage, let number = passage.page, let page = pdf.page(at: number - 1),
              let text = library.text(document.id), text.pages.indices.contains(number - 1) else { return nil }
        let pageText = text.pages[number - 1]
        guard let start = pageText.index(pageText.startIndex, offsetBy: passage.offset, limitedBy: pageText.endIndex) else { return nil }
        let location = start.utf16Offset(in: pageText)
        let length = min(160, ((page.string as NSString?)?.length ?? 0) - location)
        guard length > 0 else { return nil }
        return page.selection(for: NSRange(location: location, length: length))
    }
}

private struct PDFPreview: NSViewRepresentable {
    let document: PDFDocument
    let page: Int?
    let selection: PDFSelection?

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.backgroundColor = .clear
        view.document = document
        show(in: view)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
        show(in: view)
    }

    private func show(in view: PDFView) {
        if let selection {
            view.setCurrentSelection(selection, animate: false)
            view.go(to: selection)
        } else if let page, let target = document.page(at: page - 1), view.currentPage !== target {
            view.go(to: target)
        }
    }
}

/// The text as read, a paragraph at a time, the cited passage marked and scrolled to.
private struct TextPreview: View {
    @Environment(\.palette) private var p
    let pages: [String]
    let paged: Bool
    let passage: Navigation.LibraryPassage?

    private struct Block: Identifiable {
        var id: String
        var page: Int
        var text: String
        var offset: Int
        var isHeading: Bool
    }

    private var blocks: [Block] {
        var out: [Block] = []
        for (i, page) in pages.enumerated() {
            for (j, paragraph) in KnowledgeChunker.paragraphs(page).enumerated() {
                out.append(Block(id: "\(i)-\(j)", page: i + 1, text: paragraph.isHeading ? paragraph.headingText : paragraph.text,
                                 offset: paragraph.offset, isHeading: paragraph.isHeading))
            }
        }
        return out
    }

    /// The paragraphs the passage covers.
    private func marked(_ blocks: [Block]) -> Set<String> {
        guard let passage else { return [] }
        let page = passage.page ?? 1
        let end = passage.offset + KnowledgeChunker.target
        return Set(blocks.filter { $0.page == page && $0.offset + $0.text.count > passage.offset && $0.offset < end }.map(\.id))
    }

    var body: some View {
        let blocks = blocks
        let marked = marked(blocks)
        ScrollViewReader { scroller in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(blocks) { block in
                        if paged, block.offset == 0, block.page > 1 || blocks.first?.id == block.id {
                            Text("Page \(block.page)").font(FN.small).foregroundStyle(p.textMuted).padding(.top, 8)
                        }
                        Text(block.text)
                            .font(block.isHeading ? FN.font(17, .medium) : FN.font(15))
                            .lineSpacing(4)
                            .foregroundStyle(p.foreground)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, marked.contains(block.id) ? 10 : 0)
                            .padding(.vertical, marked.contains(block.id) ? 6 : 0)
                            .background(marked.contains(block.id) ? p.accentSubtle : .clear,
                                        in: RoundedRectangle(cornerRadius: FN.radiusSmall, style: .continuous))
                            .id(block.id)
                    }
                }
                .frame(maxWidth: 680, alignment: .leading)
                .padding(.horizontal, 40)
                .padding(.bottom, 90)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.automatic)
            .task(id: passage) {
                if let first = blocks.first(where: { marked.contains($0.id) }) {
                    try? await Task.sleep(for: .milliseconds(120))
                    withAnimation(Motion.standard) { scroller.scrollTo(first.id, anchor: .top) }
                }
            }
        }
    }
}
