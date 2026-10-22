import Foundation

// Talks live beside the rest of the data, not in it: an hour's transcript is tens of
// kilobytes and its recording tens of megabytes, which the notes file, synced to Google
// Drive, shouldn't carry. Nothing here is synced; "Save to Notes" is how a talk travels.
// As the web app keeps them in IndexedDB (src/lib/talks/db.ts).
//
//   Application Support/FourNotes/Talks/talks.json     every talk
//   Application Support/FourNotes/Talks/<id>/          its recording: mic.m4a, system.m4a, talk.m4a

@MainActor
final class TalkStore: ObservableObject {
    static let shared = TalkStore(root: AppModel.isTesting
        ? FileManager.default.temporaryDirectory.appendingPathComponent("fournotes-talks-\(UUID().uuidString)")
        : URL.applicationSupportDirectory.appendingPathComponent("FourNotes/Talks"))

    /// Deleted talks (and their recordings) are kept this long for Undo, then removed for good.
    nonisolated static let purgeAfter: TimeInterval = 7 * 86_400

    /// Every talk, newest first, deleted ones included (filter with `isAlive`).
    @Published private(set) var all: [Talk] = []

    let root: URL
    private var file: URL { root.appendingPathComponent("talks.json") }
    private var saving: Task<Void, Never>?

    init(root: URL) {
        self.root = root
        load()
    }

    // MARK: - Reading

    /// The talks in a space, newest first.
    func live(in space: String?) -> [Talk] {
        all.filter { $0.isAlive && $0.spaceId == space }
    }

    func talk(_ id: String) -> Talk? { all.first { $0.id == id } }

    func folder(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }

    /// The recording to play: the mixed one, or the only channel there is.
    func audio(_ id: String) -> URL? {
        ["talk.m4a", "mic.m4a", "system.m4a"].map { folder(id).appendingPathComponent($0) }
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }

    // MARK: - Writing

    func add(_ talk: Talk) {
        all.removeAll { $0.id == talk.id }
        all.insert(talk, at: 0)
        sort()
        save()
    }

    func update(_ id: String, _ patch: (inout Talk) -> Void) {
        guard let i = all.firstIndex(where: { $0.id == id }) else { return }
        var t = all[i]
        patch(&t)
        guard t != all[i] else { return }
        t.updatedAt = DateKit.nowIso()
        all[i] = t
        save()
    }

    /// Kept a week for Undo; `update(id) { $0.deletedAt = nil }` brings it back.
    func remove(_ id: String) {
        update(id) { $0.deletedAt = DateKit.nowIso() }
    }

    /// Gone for good, recording and all: a recording that never got going.
    func discard(_ id: String) {
        all.removeAll { $0.id == id }
        try? FileManager.default.removeItem(at: folder(id))
        save()
    }

    /// Writes now rather than after the pause: before quitting, and in tests.
    func flush() {
        saving?.cancel()
        saving = nil
        write(all)
    }

    // MARK: - Disk

    private func load() {
        guard let data = try? Data(contentsOf: file) else { return }
        do {
            let talks = try JSONDecoder().decode([Talk].self, from: data)
            let cutoff = Date().addingTimeInterval(-Self.purgeAfter)
            all = talks.filter { talk in
                guard let deleted = talk.deletedAt.flatMap(DateKit.date), deleted < cutoff else { return true }
                try? FileManager.default.removeItem(at: folder(talk.id))
                return false
            }
            sort()
        } catch {
            // Kept aside rather than overwritten by an empty list.
            let aside = root.appendingPathComponent("talks-\(Int(Date().timeIntervalSince1970)).corrupt.json")
            try? FileManager.default.copyItem(at: file, to: aside)
            print("[talks] couldn't read talks.json (\(error)); kept a copy at \(aside.path)")
        }
    }

    private func sort() { all.sort { $0.createdAt > $1.createdAt } }

    /// A recording updates its talk every few seconds: written after a short pause.
    private func save() {
        saving?.cancel()
        let snapshot = all
        saving = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            self?.write(snapshot)
        }
    }

    private func write(_ talks: [Talk]) {
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try encoder.encode(talks).write(to: file, options: .atomic)
        } catch {
            print("[talks] couldn't save: \(error.localizedDescription)")
        }
    }
}
