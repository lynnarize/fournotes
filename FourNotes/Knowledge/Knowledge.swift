import AppKit
import Combine
import CoreServices
import Foundation

// What the assistant knows from: your notes, your recorded talks, and the library of
// files, folders and pages you add. Each is cut into pieces (KnowledgePieces), given a
// vector on this Mac (Embedder) in the background, and searched by keywords and meaning
// together (HybridRanking). Nothing here leaves the Mac; only the pieces a question
// needs go to the model that answers it.

/// One place an answer may be: part of a note, about a minute of a talk, or a passage of
/// something in the library. What `Knowledge.search` returns.
struct KnowledgeHit: Identifiable, Equatable, Sendable {
    enum Origin: Equatable, Hashable, Sendable {
        case note(id: String)
        /// `at`: seconds from the start of the talk.
        case talk(id: String, at: Double)
        /// `page`: 1-based, for PDFs. `offset`: where the passage starts in its page's text.
        case library(sourceId: String, documentId: String, page: Int?, offset: Int)
    }

    var origin: Origin
    /// What it is, for the model and a tooltip: "From “Q3 plan.pdf”, page 4".
    var title: String
    /// A few words for a chip: "Q3 plan.pdf · p. 4".
    var label: String
    var text: String
    var score: Double
    /// When what it's part of last changed, or (for the library) was read.
    var updatedAt: String

    var id: String {
        switch origin {
        case .note(let id): return "note-\(id)-\(text.hashValue)"
        case .talk(let id, let at): return "talk-\(id)-\(Int(at))"
        case .library(_, let doc, let page, let offset): return "lib-\(doc)-\(page ?? 0)-\(offset)"
        }
    }
}

@MainActor
final class Knowledge: ObservableObject {
    static let shared = Knowledge(root: AppModel.isTesting
        ? FileManager.default.temporaryDirectory.appendingPathComponent("fournotes-library-\(UUID().uuidString)")
        : URL.applicationSupportDirectory.appendingPathComponent("FourNotes/Library"))

    /// Every source, newest first.
    @Published private(set) var sources: [LibrarySource] = []
    /// What's being read now, by source id: "Reading 3 of 12…".
    @Published private(set) var working: [String: String] = [:]
    /// Whether search can go by meaning as well as words.
    @Published private(set) var meaning: Embedder.State = .unknown
    /// Pieces still to be given vectors, for the line under the list.
    @Published private(set) var pending = 0

    let root: URL
    private var texts: [String: LibraryDocumentText] = [:]
    private var notesIndex: [String: IndexedItem] = [:]
    private var talksIndex: [String: IndexedItem] = [:]
    /// The average of every vector, taken away before comparing (see VectorMath.mean).
    private var center: [Float]?
    private var watchers: [String: FolderWatcher] = [:]
    /// Folders being looked at for changes, quietly.
    private var checking: Set<String> = []
    /// Folders being read, kept open for their watchers.
    private var opened: [String: URL] = [:]
    private var indexing: Task<Void, Never>?
    private var indexAgain = false
    /// What the pass still has to do; `pending` follows it.
    private var left = 0
    private var started = false
    private var cancellables: Set<AnyCancellable> = []
    private weak var store: Store?

    private var sourcesFile: URL { root.appendingPathComponent("library.json") }
    private var docsFolder: URL { root.appendingPathComponent("Docs", isDirectory: true) }
    private var indexFolder: URL { root.appendingPathComponent("Index", isDirectory: true) }

    init(root: URL) {
        self.root = root
        if let data = try? Data(contentsOf: root.appendingPathComponent("library.json")),
           let saved = try? JSONDecoder().decode([LibrarySource].self, from: data) {
            // A read cut short by quitting is read again on start.
            sources = saved.map { var s = $0; if s.status == .indexing { s.status = .ready }; return s }
        }
    }

    // MARK: - Starting

    /// Loads what was read before, opens folders to watch, and keeps notes and talks
    /// indexed as they change. Once, from the window.
    func start(store: Store) {
        guard !started else { return }
        started = true
        self.store = store
        Task {
            await loadSaved()
            for s in sources where s.kind == .folder { watch(s) }
            refreshFolders()
            scheduleIndexing()
        }
        store.$all.dropFirst()
            .debounce(for: .seconds(4), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.scheduleIndexing() }
            .store(in: &cancellables)
        TalkStore.shared.$all.dropFirst()
            .debounce(for: .seconds(6), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.scheduleIndexing() }
            .store(in: &cancellables)
        // A folder changed while the app was in the background.
        NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            .debounce(for: .seconds(2), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.refreshFolders() }
            .store(in: &cancellables)
    }

    private func loadSaved() async {
        let docs = docsFolder, index = indexFolder
        let loaded = await Task.detached(priority: .utility) { () -> ([String: LibraryDocumentText], [String: IndexedItem], [String: IndexedItem]) in
            var texts: [String: LibraryDocumentText] = [:]
            let files = (try? FileManager.default.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil)) ?? []
            for file in files where file.pathExtension == "json" {
                if let data = try? Data(contentsOf: file), let text = try? JSONDecoder().decode(LibraryDocumentText.self, from: data) {
                    texts[text.documentId] = text
                }
            }
            func items(_ name: String) -> [String: IndexedItem] {
                guard let data = try? Data(contentsOf: index.appendingPathComponent(name)) else { return [:] }
                return (try? JSONDecoder().decode([String: IndexedItem].self, from: data)) ?? [:]
            }
            return (texts, items("notes.json"), items("talks.json"))
        }.value
        // Anything read since launch wins over what was on disk.
        texts.merge(loaded.0) { now, _ in now }
        notesIndex.merge(loaded.1) { now, _ in now }
        talksIndex.merge(loaded.2) { now, _ in now }
        center = nil
    }

    // MARK: - Adding

    func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = LibraryText.fileTypes
        panel.allowsMultipleSelection = true
        panel.message = "Pick PDFs, Word or text files, web pages saved as HTML, or images."
        panel.prompt = "Add to Library"
        guard panel.runModal() == .OK else { return }
        add(files: panel.urls)
    }

    func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Pick a folder. What's in it is read, and read again when it changes. Google Drive for desktop's folder works too."
        panel.prompt = "Add Folder"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        add(folder: url)
    }

    @discardableResult
    func add(files urls: [URL]) -> [String] {
        var ids: [String] = []
        for url in urls {
            if let existing = sources.first(where: { $0.kind == .file && $0.location == url.path }) {
                ids.append(existing.id)
                read(existing.id)
                continue
            }
            let source = LibrarySource(id: DateKit.uid(), kind: .file, title: url.lastPathComponent, location: url.path,
                                       bookmark: Self.bookmark(url), spaceId: store?.currentSpaceId, addedAt: DateKit.nowIso(),
                                       indexedAt: nil, status: .indexing, problem: nil, documents: [])
            sources.insert(source, at: 0)
            ids.append(source.id)
            read(source.id)
        }
        saveSources()
        return ids
    }

    @discardableResult
    func add(folder url: URL) -> String {
        if let existing = sources.first(where: { $0.kind == .folder && $0.location == url.path }) {
            read(existing.id)
            return existing.id
        }
        let source = LibrarySource(id: DateKit.uid(), kind: .folder, title: url.lastPathComponent, location: url.path,
                                   bookmark: Self.bookmark(url), spaceId: store?.currentSpaceId, addedAt: DateKit.nowIso(),
                                   indexedAt: nil, status: .indexing, problem: nil, documents: [])
        sources.insert(source, at: 0)
        saveSources()
        watch(source)
        read(source.id)
        return source.id
    }

    /// A web address as typed: "example.com/post" gets its https.
    static func webURL(_ typed: String) -> URL? {
        var text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") { text = "https://" + text }
        guard let url = URL(string: text), let host = url.host(), host.contains(".") else { return nil }
        return url
    }

    @discardableResult
    func add(web url: URL) -> String {
        if let existing = sources.first(where: { $0.kind == .web && $0.location == url.absoluteString }) {
            read(existing.id)
            return existing.id
        }
        let source = LibrarySource(id: DateKit.uid(), kind: .web, title: url.host() ?? url.absoluteString,
                                   location: url.absoluteString, bookmark: nil, spaceId: store?.currentSpaceId,
                                   addedAt: DateKit.nowIso(), indexedAt: nil, status: .indexing, problem: nil, documents: [])
        sources.insert(source, at: 0)
        saveSources()
        read(source.id)
        return source.id
    }

    func remove(_ id: String) {
        guard let source = sources.first(where: { $0.id == id }) else { return }
        for doc in source.documents { forget(doc.id) }
        watchers[id] = nil
        if let url = opened.removeValue(forKey: id) { url.stopAccessingSecurityScopedResource() }
        sources.removeAll { $0.id == id }
        working[id] = nil
        center = nil
        saveSources()
    }

    // MARK: - Reading

    /// Reads a source (again): a file, each changed file in a folder, or the page.
    func read(_ id: String) {
        guard working[id] == nil, !checking.contains(id), let source = sources.first(where: { $0.id == id }) else { return }
        working[id] = "Reading…"
        update(id) { $0.status = .indexing; $0.problem = nil }
        Task {
            switch source.kind {
            case .file: await readFile(source)
            case .folder: await readFolder(source, force: true)
            case .web: await readPage(source)
            }
            working[id] = nil
            update(id) { s in
                s.indexedAt = DateKit.nowIso()
                if s.status == .indexing { s.status = s.problem == nil ? .ready : .failed }
            }
            saveSources()
            scheduleIndexing()
        }
    }

    /// Folders are looked at again when the app comes back and when they say they changed;
    /// only files that changed are read.
    func refreshFolders() {
        for s in sources where s.kind == .folder { check(s.id) }
    }

    /// Looks for changes in a folder quietly: the list says "Reading…" only once a
    /// changed file is being read.
    private func check(_ id: String) {
        guard working[id] == nil, checking.insert(id).inserted else { return }
        Task {
            if let s = sources.first(where: { $0.id == id }) { await readFolder(s, force: false) }
            checking.remove(id)
            working[id] = nil
            update(id) { if $0.status == .indexing { $0.status = $0.problem == nil ? .ready : .failed } }
            saveSources()
            scheduleIndexing()
        }
    }

    private func readFile(_ source: LibrarySource) async {
        let url = resolve(source)
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let docId = source.documents.first?.id ?? Fingerprint.of(source.id + "/" + url.lastPathComponent)
        let doc = await readDocument(url, id: docId, path: url.lastPathComponent, source: source.id)
        update(source.id) { s in
            s.documents = [doc]
            s.location = url.path
            if let problem = doc.problem { s.problem = problem; s.status = .failed }
        }
    }

    private func readFolder(_ source: LibrarySource, force: Bool) async {
        let folder = opened[source.id] ?? resolve(source)
        let scoped = opened[source.id] == nil && folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        guard FileManager.default.fileExists(atPath: folder.path) else {
            update(source.id) { $0.problem = "The folder isn't where it was. Add it again from its new place."; $0.status = .failed }
            return
        }
        let files = await Task.detached(priority: .utility) { Self.files(in: folder) }.value
        let byPath = Dictionary(source.documents.map { ($0.path, $0) }, uniquingKeysWith: { a, _ in a })
        var docs: [LibraryDocument] = []
        var changed: [(URL, String)] = []
        for (url, path, modified, size) in files {
            if !force, let old = byPath[path], old.modified == modified, old.bytes == size, old.problem == nil, texts[old.id] != nil {
                docs.append(old)
            } else {
                changed.append((url, path))
            }
        }
        for (n, (url, path)) in changed.enumerated() {
            working[source.id] = changed.count > 1 ? "Reading \(n + 1) of \(changed.count)…" : "Reading…"
            docs.append(await readDocument(url, id: Fingerprint.of(source.id + "/" + path), path: path, source: source.id))
        }
        // Files no longer in the folder go from the library too.
        let kept = Set(docs.map(\.id))
        for old in source.documents where !kept.contains(old.id) { forget(old.id) }
        docs.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        update(source.id) { s in
            s.documents = docs
            if files.isEmpty { s.problem = "There's nothing in it Four Notes can read: PDFs, Word, text, Markdown, HTML or images." }
        }
    }

    private func readPage(_ source: LibrarySource) async {
        guard let url = URL(string: source.location) else {
            update(source.id) { $0.problem = "That isn't a web address."; $0.status = .failed }
            return
        }
        let docId = source.documents.first?.id ?? Fingerprint.of(source.id + "/page")
        do {
            let extracted = try await LibraryText.fetch(url)
            let chunks = KnowledgeChunker.chunks(pages: extracted.pages, paged: extracted.pages.count > 1)
            keep(LibraryDocumentText(documentId: docId, pages: extracted.pages, chunks: chunks, vectors: nil))
            let bytes = extracted.pages.reduce(0) { $0 + $1.utf8.count }
            let doc = LibraryDocument(id: docId, name: extracted.title ?? url.host() ?? source.location, path: url.absoluteString,
                                      kind: .web, bytes: bytes, modified: DateKit.nowIso(),
                                      pages: extracted.pages.count > 1 ? extracted.pages.count : nil, pieces: chunks.count, problem: nil)
            update(source.id) { s in
                s.documents = [doc]
                if let title = extracted.title { s.title = title }
            }
        } catch {
            update(source.id) { $0.problem = error.localizedDescription; $0.status = .failed }
        }
    }

    /// Reads one file into the library, and says how it went.
    private func readDocument(_ url: URL, id: String, path: String, source: String) async -> LibraryDocument {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let kind = LibraryText.kind(of: url) ?? .text
        var doc = LibraryDocument(id: id, name: url.lastPathComponent, path: path, kind: kind, bytes: values?.fileSize ?? 0,
                                  modified: values?.contentModificationDate.map(DateKit.iso), pages: nil, pieces: 0, problem: nil)
        do {
            let extracted = try await LibraryText.extract(url)
            let paged = kind == .pdf
            let chunks = KnowledgeChunker.chunks(pages: extracted.pages, paged: paged)
            // Unchanged text keeps its vectors.
            let old = texts[id]
            let vectors = old?.chunks == chunks ? old?.vectors : nil
            keep(LibraryDocumentText(documentId: id, pages: extracted.pages, chunks: chunks, vectors: vectors))
            doc.pages = paged ? extracted.pages.count : nil
            doc.pieces = chunks.count
        } catch {
            doc.problem = error.localizedDescription
            forget(id)
        }
        return doc
    }

    /// The files a folder holds that can be read, with their place in it, date and size.
    /// Hidden files and packages are skipped, and a Google Doc in Drive's folder (a link
    /// to the web, not a document) is too.
    nonisolated static func files(in folder: URL, limit: Int = 2_000) -> [(URL, String, String?, Int)] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys,
                                                          options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var out: [(URL, String, String?, Int)] = []
        let base = folder.standardizedFileURL.path
        while let url = walker.nextObject() as? URL, out.count < limit {
            guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true,
                  LibraryText.kind(of: url) != nil, (values.fileSize ?? 0) <= LibraryText.maxBytes else { continue }
            var path = url.standardizedFileURL.path
            if path.hasPrefix(base) { path = String(path.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
            out.append((url, path, values.contentModificationDate.map { DateKit.iso($0) }, values.fileSize ?? 0))
        }
        return out
    }

    // MARK: - Folders and files across launches

    nonisolated static func bookmark(_ url: URL) -> Data? {
        try? url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    /// Where a file or folder is now: its bookmark follows it when it's moved or renamed.
    private func resolve(_ source: LibrarySource) -> URL {
        if let bookmark = source.bookmark {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale) {
                if stale || url.path != source.location {
                    let fresh = stale ? Self.bookmark(url) : nil
                    update(source.id) { s in
                        s.location = url.path
                        if let fresh { s.bookmark = fresh }
                    }
                }
                return url
            }
        }
        return URL(fileURLWithPath: source.location)
    }

    private func watch(_ source: LibrarySource) {
        guard watchers[source.id] == nil else { return }
        let url = resolve(source)
        if opened[source.id] == nil, url.startAccessingSecurityScopedResource() { opened[source.id] = url }
        let id = source.id
        watchers[id] = FolderWatcher(path: url.path) { [weak self] in self?.check(id) }
    }

    // MARK: - Reading back

    func text(_ documentId: String) -> LibraryDocumentText? { texts[documentId] }

    /// Reading or looking at anything right now.
    var isBusy: Bool { !working.isEmpty || !checking.isEmpty }

    func source(_ id: String) -> LibrarySource? { sources.first { $0.id == id } }

    func sources(in space: String?) -> [LibrarySource] { sources.filter { $0.spaceId == space } }

    // MARK: - Vectors

    /// Gives vectors to whatever has none: the library's pieces, then notes, then talks.
    /// One pass at a time; a change during one runs another after it.
    func scheduleIndexing() {
        guard started else { return }
        if indexing != nil { indexAgain = true; return }
        indexing = Task(priority: .utility) { [weak self] in
            repeat {
                self?.indexAgain = false
                await self?.indexPass()
            } while self?.indexAgain == true
            self?.indexing = nil
        }
    }

    private func indexPass() async {
        meaning = .preparing
        guard await Embedder.shared.prepare() else {
            meaning = await Embedder.shared.state
            pending = 0
            return
        }
        meaning = .ready
        let model = await Embedder.shared.identifier
        let dimension = await Embedder.shared.dimension

        // Library documents.
        let names = Dictionary(sources.flatMap { s in s.documents.map { ($0.id, $0.name) } }, uniquingKeysWith: { a, _ in a })
        let docs = texts.values.filter { $0.vectors?.model != model && !$0.chunks.isEmpty && names[$0.documentId] != nil }
        let notes = (store?.all.notes ?? []).filter { $0.deletedAt == nil && $0.sample != true }
        let talks = TalkStore.shared.all.filter { $0.isAlive && $0.status == .done }
        let staleNotes = notes.filter { notesIndex[$0.id]?.version != $0.updatedAt || notesIndex[$0.id]?.vectors?.model != model }
        let staleTalks = talks.filter { talksIndex[$0.id]?.version != $0.updatedAt || talksIndex[$0.id]?.vectors?.model != model }
        left = docs.reduce(0) { $0 + $1.chunks.count } + staleNotes.count + staleTalks.count
        pending = left

        for doc in docs {
            let title = names[doc.documentId] ?? ""
            guard let vectors = await embed(doc.chunks.map { KnowledgePieces.embedding($0, in: title) }, dimension: dimension) else { return }
            // Read again while this ran: those pieces aren't these.
            guard texts[doc.documentId]?.chunks == doc.chunks else { continue }
            texts[doc.documentId]?.vectors = VectorSet(model: model, dimension: dimension, vectors: vectors)
            if let text = texts[doc.documentId] { save(text) }
            progress(doc.chunks.count)
        }

        var notesChanged = false
        for note in staleNotes {
            let chunks = KnowledgePieces.note(note)
            let title = note.title.isEmpty ? "Untitled" : note.title
            guard let vectors = await embed(chunks.map { KnowledgePieces.embedding($0, in: title) }, dimension: dimension) else { return }
            notesIndex[note.id] = IndexedItem(version: note.updatedAt, chunks: chunks,
                                              vectors: VectorSet(model: model, dimension: dimension, vectors: vectors))
            notesChanged = true
            progress(1)
        }
        let liveNotes = Set(notes.map(\.id))
        if notesIndex.keys.contains(where: { !liveNotes.contains($0) }) {
            notesIndex = notesIndex.filter { liveNotes.contains($0.key) }
            notesChanged = true
        }

        var talksChanged = false
        for talk in staleTalks {
            let chunks = KnowledgePieces.talk(talk)
            guard let vectors = await embed(chunks.map { KnowledgePieces.embedding($0, in: talk.title) }, dimension: dimension) else { return }
            talksIndex[talk.id] = IndexedItem(version: talk.updatedAt, chunks: chunks,
                                              vectors: VectorSet(model: model, dimension: dimension, vectors: vectors))
            talksChanged = true
            progress(1)
        }
        let liveTalks = Set(talks.map(\.id))
        if talksIndex.keys.contains(where: { !liveTalks.contains($0) }) {
            talksIndex = talksIndex.filter { liveTalks.contains($0.key) }
            talksChanged = true
        }

        if notesChanged { saveIndex(notesIndex, "notes.json") }
        if talksChanged { saveIndex(talksIndex, "talks.json") }
        if !docs.isEmpty || notesChanged || talksChanged { center = nil }
        pending = 0
    }

    /// Counts down what's left, saying so every ten items rather than every one: the
    /// sidebar and the library list redraw each time.
    private func progress(_ done: Int) {
        left = max(0, left - done)
        if done > 1 || left % 10 == 0 { pending = left }
    }

    /// Vectors for many texts, a few at a time so the rest of the app isn't kept waiting.
    /// Nil when the pass should stop.
    private func embed(_ texts: [String], dimension: Int) async -> [[Float]]? {
        var out: [[Float]] = []
        for start in stride(from: 0, to: texts.count, by: 8) {
            if Task.isCancelled { return nil }
            let batch = Array(texts[start..<min(texts.count, start + 8)])
            let vectors = await Embedder.shared.vectors(batch)
            out += vectors.map { $0 ?? [Float](repeating: 0, count: dimension) }
            await Task.yield()
        }
        return out
    }

    // MARK: - Search

    /// The pieces of notes, talks and the library that best answer `query`, best first,
    /// at most `limit`. Ranked by keywords and, once vectors are ready, meaning too
    /// (HybridRanking); works on keywords alone before then, or without the model.
    /// Searches the space showing. A question that names a time ("yesterday's call",
    /// "last month's meetings") looks only at talks from then, and a talk from then counts
    /// even if no word matches. A question with nothing to match ("hi") finds nothing.
    ///
    /// For the assistant's context (Assistant.send) and Live Q&A. `store` is the app's
    /// unless another is given (tests).
    func search(_ query: String, limit: Int = 6, in store: Store? = nil) async -> [KnowledgeHit] {
        let store = store ?? self.store ?? AppModel.shared.store
        let space = store.currentSpaceId
        return await search(query, notes: store.liveNotes, talks: TalkStore.shared.live(in: space), space: space, limit: limit)
    }

    /// The same, over the notes and talks given (and the space's library).
    func search(_ query: String, notes: [Note], talks: [Talk], space: String?, limit: Int) async -> [KnowledgeHit] {
        let queryText = query
        let range = KnowledgeQuery.range(in: query)
        let terms = KnowledgeQuery.terms(query)
        let pieces = gather(notes: notes, talks: talks, sources: sources(in: space), range: range, pinTalks: range != nil)
        guard !pieces.isEmpty, !terms.isEmpty || pieces.contains(where: \.candidate.pinned)
                || query.split(whereSeparator: \.isWhitespace).count >= 4 else { return [] }

        var queryVector: [Float]?
        if meaning == .ready, pieces.contains(where: { $0.candidate.vector != nil }) {
            queryVector = await Embedder.shared.vector(query)
        }
        let center = centerVector()
        let candidates = pieces.map(\.candidate)
        // Off the main thread: every piece is compared, and a library can have thousands.
        let ranked = await Task.detached(priority: .userInitiated) { [candidates, queryVector] in
            var candidates = candidates
            var query = queryVector
            if let center {
                for i in candidates.indices { candidates[i].vector = candidates[i].vector.map { VectorMath.centered($0, center) } }
                query = query.map { VectorMath.centered($0, center) }
            } else {
                query = nil
            }
            return HybridRanking.rank(candidates, query: queryText, queryVector: query, limit: limit)
        }.value
        return ranked.map { r in
            var hit = pieces[r.index].hit
            hit.score = r.score
            return hit
        }
    }

    struct Piece {
        var candidate: HybridRanking.Candidate
        var hit: KnowledgeHit
    }

    /// Every piece there is to search, with its vector when it has one.
    func gather(notes: [Note], talks: [Talk], sources: [LibrarySource], range: DateInterval?, pinTalks: Bool) -> [Piece] {
        var out: [Piece] = []
        for note in notes where !note.title.isEmpty || !note.content.isEmpty {
            let title = note.title.isEmpty ? "Untitled" : note.title
            let indexed = notesIndex[note.id].flatMap { $0.version == note.updatedAt ? $0 : nil }
            var chunks = indexed?.chunks ?? KnowledgePieces.note(note)
            // A note that's only a title is found by it.
            if chunks.isEmpty { chunks = [KnowledgeChunk(text: title, page: nil, heading: nil, offset: 0)] }
            let vectors = indexed?.vectors?.vectors
            for (i, chunk) in chunks.enumerated() {
                out.append(Piece(
                    candidate: .init(text: KnowledgePieces.keywords(chunk, in: title), vector: vectors?[safe: i]),
                    hit: KnowledgeHit(origin: .note(id: note.id), title: title, label: title, text: chunk.text,
                                      score: 0, updatedAt: note.updatedAt)))
            }
        }
        for talk in talks {
            let when = DateKit.date(talk.createdAt)
            let inRange = range.map { r in when.map { r.contains($0) } ?? false }
            if inRange == false { continue }
            let indexed = talksIndex[talk.id].flatMap { $0.version == talk.updatedAt ? $0 : nil }
            let chunks = indexed?.chunks ?? KnowledgePieces.talk(talk)
            let vectors = indexed?.vectors?.vectors
            let about = ([talk.title, talk.app ?? ""] + Array(talk.names.values)).joined(separator: " ")
            for (i, chunk) in chunks.enumerated() {
                let at = chunk.at ?? 0
                out.append(Piece(
                    candidate: .init(text: KnowledgePieces.keywords(chunk, in: about), vector: vectors?[safe: i],
                                     // The talks on the day asked about count, by their write-up or their start.
                                     pinned: pinTalks && inRange == true && i == 0),
                    hit: KnowledgeHit(origin: .talk(id: talk.id, at: at),
                                      title: "Recorded talk “\(talk.title)”, \(TalkText.meta(talk)), from \(TalkText.clock(at))",
                                      label: "\(talk.title) · \(TalkText.clock(at))", text: chunk.text,
                                      score: 0, updatedAt: talk.createdAt)))
            }
        }
        for source in sources {
            for doc in source.documents {
                guard let text = texts[doc.id] else { continue }
                let vectors = text.vectors?.vectors
                let name = source.kind == .folder ? doc.path : doc.name
                for (i, chunk) in text.chunks.enumerated() {
                    let page = chunk.page.map { ", page \($0)" } ?? ""
                    out.append(Piece(
                        candidate: .init(text: KnowledgePieces.keywords(chunk, in: doc.name), vector: vectors?[safe: i]),
                        hit: KnowledgeHit(origin: .library(sourceId: source.id, documentId: doc.id, page: chunk.page, offset: chunk.offset),
                                          title: "From “\(name)”\(page)" + (chunk.heading.map { ", under “\($0)”" } ?? ""),
                                          label: doc.name + (chunk.page.map { " · p. \($0)" } ?? ""), text: chunk.text,
                                          score: 0, updatedAt: source.indexedAt ?? source.addedAt)))
                }
            }
        }
        return out
    }

    private func centerVector() -> [Float]? {
        if let center { return center }
        var all: [[Float]] = []
        for item in notesIndex.values { all += item.vectors?.vectors ?? [] }
        for item in talksIndex.values { all += item.vectors?.vectors ?? [] }
        for text in texts.values { all += text.vectors?.vectors ?? [] }
        guard let dimension = all.first?.count, all.count >= 2 else { return nil }
        center = VectorMath.mean(all, dimension: dimension)
        return center
    }

    // MARK: - Saving

    private func update(_ id: String, _ patch: (inout LibrarySource) -> Void) {
        guard let i = sources.firstIndex(where: { $0.id == id }) else { return }
        patch(&sources[i])
    }

    private func keep(_ text: LibraryDocumentText) {
        texts[text.documentId] = text
        center = nil
        save(text)
    }

    private func forget(_ documentId: String) {
        guard texts.removeValue(forKey: documentId) != nil else { return }
        try? FileManager.default.removeItem(at: docsFolder.appendingPathComponent(documentId + ".json"))
        center = nil
    }

    private func saveSources() {
        write(sources, to: sourcesFile)
    }

    private func save(_ text: LibraryDocumentText) {
        write(text, to: docsFolder.appendingPathComponent(text.documentId + ".json"))
    }

    private func saveIndex(_ index: [String: IndexedItem], _ name: String) {
        write(index, to: indexFolder.appendingPathComponent(name))
    }

    /// One write at a time, in order, so an older save never lands on a newer one.
    private static let writes = DispatchQueue(label: "fournotes.library.save", qos: .utility)

    private func write<T: Encodable & Sendable>(_ value: T, to url: URL) {
        Self.writes.async {
            guard let data = try? JSONEncoder().encode(value) else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
        }
    }

    /// Waits for the saves queued so far: in tests.
    func flush() {
        Self.writes.sync {}
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

/// Says when anything inside a folder changes (FSEvents), a couple of seconds after, on
/// the main thread. The folder has to stay open (security-scoped) while it's watched.
final class FolderWatcher {
    private final class Callback: Sendable {
        let run: @MainActor @Sendable () -> Void
        init(_ run: @escaping @MainActor @Sendable () -> Void) { self.run = run }
    }

    private let callback: Callback
    private var stream: FSEventStreamRef?

    init(path: String, onChange: @escaping @MainActor @Sendable () -> Void) {
        callback = Callback(onChange)
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(callback).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let handler: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let callback = Unmanaged<Callback>.fromOpaque(info).takeUnretainedValue()
            MainActor.assumeIsolated { callback.run() }
        }
        stream = FSEventStreamCreate(nil, handler, &context, [path] as CFArray,
                                     FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 2.0,
                                     FSEventStreamCreateFlags(kFSEventStreamCreateFlagNone))
        if let stream {
            FSEventStreamSetDispatchQueue(stream, .main)
            FSEventStreamStart(stream)
        }
    }

    deinit {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }
}
