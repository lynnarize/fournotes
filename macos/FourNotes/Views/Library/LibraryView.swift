import AppKit
import SwiftUI

// Library: files, folders and web pages the assistant answers from, as Foresight's
// Sources. A list of them beside the open one, as Transcribe has it. Everything is read
// and kept on this Mac; a folder is read again when it changes.

struct LibraryView: View {
    /// `nav.selectedSourceId` for the "add a web page" panel rather than a source.
    static let newPage = "new-page"

    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var assistant: Assistant
    @ObservedObject private var library = Knowledge.shared

    @State private var query = ""
    @FocusState private var searchFocused: Bool

    private var mine: [LibrarySource] { library.sources(in: store.currentSpaceId) }
    private var list: [LibrarySource] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return mine }
        return mine.filter { s in
            ([s.title, s.location] + s.documents.map(\.path)).joined(separator: " ").lowercased().contains(q)
        }
    }

    private enum Detail: Equatable { case newPage, source(String), empty }

    private var detail: Detail {
        if nav.selectedSourceId == Self.newPage { return .newPage }
        if let id = nav.selectedSourceId, mine.contains(where: { $0.id == id }) { return .source(id) }
        if let first = list.first { return .source(first.id) }
        return .empty
    }

    var body: some View {
        let detail = detail
        HStack(alignment: .top, spacing: 12) {
            Group {
                switch detail {
                case .newPage:
                    NewPagePanel { id in nav.selectedSourceId = id } onCancel: { nav.selectedSourceId = nil }
                case .source(let id):
                    if let source = library.source(id) { SourcePage(source: source).id(id) }
                case .empty:
                    emptyDetail
                }
            }
            .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
            .paper(p)
            .transition(.opacity.combined(with: .offset(x: -8)))
            listColumn(selected: detail)
                .frame(width: 360)
                .frame(maxHeight: .infinity)
                .paper(p)
                .zIndex(1)
        }
        .frame(maxHeight: .infinity)
        .animation(Motion.screen, value: detail)
        .task { library.refreshFolders() }
        .task(id: nav.focus) {
            guard let link = nav.consumeFocus([.library]) else { return }
            query = ""
            nav.selectedSourceId = link.id
        }
    }

    // MARK: - List

    private func listColumn(selected: Detail) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text("Library")
                    .font(FN.font(24, .bold))
                    .tracking(-0.6)
                    .foregroundStyle(p.foreground)
                Spacer()
                MenuButton(help: "Add to the library", align: .trailing, entries: { addEntries }) {
                    HStack(spacing: 8) {
                        Icon("plus", size: 16)
                        Text("Add")
                    }
                    .font(FN.font(14, .medium))
                    .foregroundStyle(p.accentForeground)
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .background(p.accent, in: Capsule(style: .circular))
                    .contentShape(Capsule(style: .circular))
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 12)

            searchField

            let ask = query.trimmingCharacters(in: .whitespaces)
            if ask.count > 1 {
                Button { askAssistant(ask) } label: {
                    HoverRow(cornerRadius: FN.radiusControl) { _ in
                        HStack(spacing: 8) {
                            Icon("sparkle", size: 14).foregroundStyle(p.accent)
                            Text("Ask the assistant about “\(ask)”")
                                .font(FN.font(13))
                                .foregroundStyle(p.textSecondary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                }
                .buttonStyle(.fn)
                .padding(.top, -4)
                .padding(.bottom, 8)
                .transition(.opacity)
            }

            ScrollView {
                let rows = list
                LazyVStack(spacing: 4) {
                    ForEach(rows) { source in
                        SourceRow(source: source, isSelected: selected == .source(source.id),
                                  working: library.working[source.id]) {
                            nav.selectedSourceId = source.id
                            nav.selectedDocumentId = nil
                        }
                        .contextMenu {
                            Button("Read again") { library.read(source.id) }
                            Button("Remove from library", role: .destructive) { remove(source) }
                        }
                    }
                    if mine.isEmpty {
                        VStack(spacing: 4) {
                            Text("Nothing here yet").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                            Text("Add files, a folder or a web page, and the assistant answers from them too.")
                                .font(FN.body).lineSpacing(3).foregroundStyle(p.textMuted)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 32)
                    } else if rows.isEmpty {
                        Text("Nothing in the library is called that. Ask the assistant instead.")
                            .font(FN.body).foregroundStyle(p.textMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 32)
                    }
                }
                .animation(Motion.list, value: rows.map(\.id))
                .padding(.bottom, 24)
            }
            .scrollIndicators(.never)

            indexLine
                .padding(.horizontal, 8)
                .padding(.bottom, 24)
        }
        .padding(.horizontal, 22)
        .animation(Motion.standard, value: query.isEmpty)
    }

    private var addEntries: [MenuEntry] {
        [
            .item("Files…", icon: "fileText") { library.pickFiles(); nav.selectedSourceId = nil },
            .item("A folder…", icon: "folder") { library.pickFolder(); nav.selectedSourceId = nil },
            .item("A web page…", icon: "link") { nav.selectedSourceId = Self.newPage },
        ]
    }

    /// How search stands: by meaning and words, or words only, and why.
    private var indexLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Icon(library.meaning == .ready ? "shield" : "info", size: 12)
            Group {
                switch library.meaning {
                case .ready where library.pending > 0:
                    Text("Reading \(library.pending) \(library.pending == 1 ? "item" : "items") for search, on this Mac…")
                case .ready:
                    Text("Searched by meaning and words, on this Mac.")
                case .preparing:
                    Text("Getting search ready on this Mac…")
                case .unavailable(let why):
                    Text(why)
                case .unknown:
                    Text("Read and kept on this Mac.")
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .font(FN.small)
        .foregroundStyle(p.textMuted)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Icon("search", size: 16).foregroundStyle(p.textMuted)
            TextField("Search the library", text: $query)
                .textFieldStyle(.plain)
                .font(FN.body)
                .foregroundStyle(p.foreground)
                .focused($searchFocused)
                .onExitCommand { query = ""; searchFocused = false }
                .onSubmit {
                    let q = query.trimmingCharacters(in: .whitespaces)
                    if !q.isEmpty, list.isEmpty { askAssistant(q) }
                }
            if !query.isEmpty {
                IconButton("x", size: 12, box: 22, help: "Clear") { query = "" }
                    .transition(.opacity)
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .frame(height: 36)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
            .strokeBorder(searchFocused ? p.borderStrong : p.border, lineWidth: 1))
        .motion(searchFocused, Motion.quick)
        .padding(.horizontal, 4)
        .padding(.bottom, 12)
    }

    private var emptyDetail: some View {
        VStack(spacing: 0) {
            Icon("book", size: 28).foregroundStyle(p.textMuted)
            Text("Your library").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                .padding(.top, 12)
            Text("Add PDFs, Word and text files, folders and web pages. They're read on this Mac, and the assistant answers from them, saying where each answer came from.")
                .font(FN.body).lineSpacing(3).foregroundStyle(p.textMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            HStack(spacing: 8) {
                PrimaryButton(title: "Add files", icon: "fileText") { library.pickFiles() }
                SecondaryButton(title: "Add a folder", icon: "folder") { library.pickFolder() }
                SecondaryButton(title: "Web page", icon: "link") { nav.selectedSourceId = Self.newPage }
            }
            .fixedSize()
            .padding(.top, 16)
            Text("Using Google Drive for desktop? Add its folder (in Finder, under Locations). Google Docs there are links to the web rather than files, so export the ones you need as Word or PDF.")
                .font(FN.small).lineSpacing(2).foregroundStyle(p.textMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 20)
        }
        .frame(maxWidth: 440)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Actions

    private func askAssistant(_ q: String) {
        let question = q.hasSuffix("?") || q.hasSuffix("？") ? "In my library: \(q)" : "What does my library say about \(q)?"
        Task { _ = await assistant.send(question) }
    }

    private func remove(_ source: LibrarySource) {
        library.remove(source.id)
        if nav.selectedSourceId == source.id { nav.selectedSourceId = nil }
        AppModel.shared.toasts.push("Removed “\(source.title)” from the library")
    }
}

// MARK: - A source in the list

private struct SourceRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let source: LibrarySource
    let isSelected: Bool
    let working: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Icon(LibraryFormat.icon(source), size: 14).foregroundStyle(p.textMuted)
                    Text(source.title)
                        .font(FN.font(16, .medium))
                        .foregroundStyle(p.foreground)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(LibraryFormat.date(source.addedAt))
                        .font(FN.small).monospacedDigit()
                        .foregroundStyle(p.textMuted)
                }
                HStack(spacing: 6) {
                    Text(LibraryFormat.summary(source)).lineLimit(1)
                    Spacer(minLength: 4)
                    if let working {
                        StatusPill(text: working, tone: .accent, dot: false)
                    } else if source.status == .failed {
                        StatusPill(text: "Couldn't read", tone: .bad, dot: false)
                    }
                }
                .font(FN.small)
                .foregroundStyle(p.textMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(isSelected ? p.accentSubtle : (hovering ? p.hover : .clear),
                        in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(isSelected, Motion.quick)
        .motion(hovering, Motion.quick)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Adding a web page

private struct NewPagePanel: View {
    @Environment(\.palette) private var p
    @ObservedObject private var library = Knowledge.shared
    let onAdded: (String) -> Void
    let onCancel: () -> Void

    @State private var address = ""
    @FocusState private var focused: Bool

    private var url: URL? { Knowledge.webURL(address) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Add a web page")
                    .font(FN.display(28))
                    .tracking(FN.displayTracking(28))
                    .foregroundStyle(p.foreground)
                Text("Its text is read once and kept on this Mac, without the menus and ads. Read it again any time from its page here.")
                    .font(FN.body).lineSpacing(3).foregroundStyle(p.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Icon("link", size: 16).foregroundStyle(p.textMuted)
                TextField("https://", text: $address)
                    .textFieldStyle(.plain)
                    .font(FN.body)
                    .focused($focused)
                    .onSubmit(add)
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous)
                .strokeBorder(focused ? p.borderStrong : p.border, lineWidth: 1))
            HStack(spacing: 8) {
                PrimaryButton(title: "Add", icon: "plus", disabled: url == nil, action: add)
                SecondaryButton(title: "Cancel", action: onCancel)
            }
            .fixedSize()
        }
        .frame(maxWidth: 520, alignment: .leading)
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 24)
        .onAppear {
            focused = true
            // A copied address is the likeliest one.
            if let copied = NSPasteboard.general.string(forType: .string), Knowledge.webURL(copied) != nil,
               copied.lowercased().hasPrefix("http") {
                address = copied.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
    }

    private func add() {
        guard let url else { return }
        onAdded(library.add(web: url))
    }
}

// MARK: - Words for sources

enum LibraryFormat {
    static func icon(_ source: LibrarySource) -> String {
        switch source.kind {
        case .folder: return "folder"
        case .web: return "link"
        case .file: return source.documents.first.map(icon) ?? "fileText"
        }
    }

    static func icon(_ doc: LibraryDocument) -> String {
        switch doc.kind {
        case .image: return "image"
        case .web, .html: return "link"
        default: return "fileText"
        }
    }

    /// "PDF · 12 pages · 1.2 MB", "Folder · 34 files · 20 MB", "Web page · example.com".
    static func summary(_ source: LibrarySource) -> String {
        switch source.kind {
        case .folder:
            let n = source.documents.count
            return ["Folder", "\(n) \(n == 1 ? "file" : "files")", n > 0 ? size(source.bytes) : nil].compactMap { $0 }.joined(separator: " · ")
        case .web:
            return ["Web page", URL(string: source.location)?.host()].compactMap { $0 }.joined(separator: " · ")
        case .file:
            guard let doc = source.documents.first else { return "File" }
            return summary(doc)
        }
    }

    static func summary(_ doc: LibraryDocument) -> String {
        var parts = [doc.kindName]
        if let pages = doc.pages { parts.append("\(pages) \(pages == 1 ? "page" : "pages")") }
        if doc.bytes > 0 { parts.append(size(doc.bytes)) }
        return parts.joined(separator: " · ")
    }

    static func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private static let short: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d"
        return f
    }()

    static func date(_ iso: String) -> String {
        DateKit.date(iso).map { short.string(from: $0) } ?? ""
    }
}
