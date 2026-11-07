import Combine
import SwiftUI

// Cross-view navigation: which tab is showing, which sheet is open, and the
// "jump to the thing the assistant just filed" plumbing.
// Replaces src/lib/nav.ts and src/lib/highlight.ts.

@MainActor
final class Navigation: ObservableObject {
    /// Opening a tab clears its "something new" dot.
    @Published var tab: Tab = .today {
        didSet {
            pulsing.remove(tab)
            guard tab != oldValue, !walking else { return }
            past.append(oldValue)
            ahead.removeAll()
        }
    }
    /// The tabs behind and ahead of this one, for the toolbar's back and forward.
    @Published private(set) var past: [Tab] = []
    @Published private(set) var ahead: [Tab] = []
    private var walking = false

    func goBack() {
        guard let previous = past.popLast() else { return }
        ahead.append(tab)
        walking = true
        tab = previous
        walking = false
    }

    func goForward() {
        guard let next = ahead.popLast() else { return }
        past.append(tab)
        walking = true
        tab = next
        walking = false
    }
    /// A window shows one sheet at a time, so there is one place that says
    /// which. Three independent booleans meant ⌘, over an open palette silently
    /// did nothing and could not be reopened.
    enum Sheet: String, Identifiable, Equatable {
        case settings, palette, onboarding, update
        var id: String { rawValue }
    }

    @Published var sheet: Sheet?
    @Published var settingsSection: String?

    var showSettings: Bool { sheet == .settings }

    /// The row a view should reveal, once.
    ///
    /// Carries its own identity so two requests for the same row are still two
    /// requests. Views consume it with `.task(id:)` rather than `.onChange`,
    /// because switching tabs *creates* the destination view — and `.onChange`
    /// never fires on a value that was already set when the view appeared,
    /// which left every "Show" button in the app doing nothing.
    struct FocusRequest: Equatable, Identifiable {
        let id = UUID()
        var link: ChangeLink
    }

    @Published var focus: FocusRequest?
    /// Rows filed in the last few seconds, so they can flash.
    @Published private(set) var flashing: Set<String> = []
    /// Tabs with something new in them, so their sidebar row can pulse.
    @Published private(set) var pulsing: Set<Tab> = []

    /// Notes: which note the editor has open.
    @Published var selectedNoteId: String?
    /// Transcribe: which talk is open.
    @Published var selectedTalkId: String?
    /// Where to play the open talk from, once: a cited moment. The talk's page takes it.
    @Published var talkMoment: Double?
    /// Library: which source is open, and which of its documents.
    @Published var selectedSourceId: String?
    @Published var selectedDocumentId: String?
    /// The passage of the open document to show, once: a cited one.
    @Published var libraryPassage: LibraryPassage?

    struct LibraryPassage: Equatable {
        var documentId: String
        var page: Int?
        var offset: Int
    }

    /// The note editor fills the window: no sidebar, no note list, no title.
    /// Lives here because RootView owns the sidebar it has to hide.
    @Published var focusMode = false

    /// Text to put in the assistant's input and open it with — filled in, not
    /// sent, so the request can be reviewed first.
    @Published var assistantDraft: String?
    /// Today's conversation is open as a card under the greeting, in place of the
    /// composer and the brief. "Open on Today" in the corner panel opens it too.
    @Published var todayChat = false

    /// The day a brief has already been requested for. Lives here rather than
    /// on TodayView, which is destroyed and rebuilt on every tab switch — so
    /// the flag reset and another model call went out each time.
    var briefRequestedFor: String?

    func open(_ link: ChangeLink) {
        focusMode = false
        switch link.kind {
        case .notes:
            tab = .notes
            selectedNoteId = link.id
        case .todos: tab = .todo
        case .transactions, .budget: tab = .finance
        case .stickies: tab = .today
        case .talks:
            tab = .transcribe
            selectedTalkId = link.id
        case .library:
            tab = .library
            selectedSourceId = link.id
        }
        focus = FocusRequest(link: link)
    }

    /// Opens a talk to play from a moment in it.
    func open(talk id: String, at seconds: Double) {
        talkMoment = seconds > 0 ? seconds : nil
        open(ChangeLink(kind: .talks, id: id))
    }

    /// Opens a document in the library at a passage.
    func open(source: String, document: String, page: Int?, offset: Int) {
        selectedDocumentId = document
        libraryPassage = LibraryPassage(documentId: document, page: page, offset: offset)
        open(ChangeLink(kind: .library, id: source))
    }

    /// Takes the pending request when it is meant for one of `kinds`, and clears
    /// it so it cannot be delivered twice.
    func consumeFocus(_ kinds: Set<ChangeLink.Kind>) -> ChangeLink? {
        guard let focus, kinds.contains(focus.link.kind) else { return nil }
        self.focus = nil
        return focus.link
    }

    func openSettings(section: String? = nil) {
        settingsSection = section
        present(.settings)
    }

    /// Shows a sheet, swapping out whatever is already up.
    ///
    /// Assigning over a presented sheet does nothing on macOS, and dismissing
    /// and presenting in the same runloop turn drops the new one — so a swap
    /// has to wait a turn. Every caller goes through here so neither mistake
    /// can come back.
    func present(_ next: Sheet) {
        guard sheet != nil else { sheet = next; return }
        sheet = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            sheet = next
        }
    }

    /// Flash the rows the assistant just created, and pulse the tabs they landed in.
    func markFiled(_ links: [ChangeLink]) {
        guard !links.isEmpty else { return }
        let ids = Set(links.map(\.id))
        flashing.formUnion(ids)

        let tabs = Set(links.compactMap { link -> Tab? in
            switch link.kind {
            case .notes: return .notes
            case .todos: return .todo
            case .transactions, .budget: return .finance
            case .stickies: return .today
            case .talks: return .transcribe
            case .library: return .library
            }
        })
        pulsing.formUnion(tabs.subtracting([tab]))

        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            self?.flashing.subtract(ids)
        }
    }

    func clearPulse(_ tab: Tab) { pulsing.remove(tab) }

    /// The user went to look at what was filed: nothing there is news any more.
    func clearPulses(for links: [ChangeLink]) {
        for link in links {
            switch link.kind {
            case .notes: pulsing.remove(.notes)
            case .todos: pulsing.remove(.todo)
            case .transactions, .budget: pulsing.remove(.finance)
            case .stickies: pulsing.remove(.today)
            case .talks: pulsing.remove(.transcribe)
            case .library: pulsing.remove(.library)
            }
        }
    }

    func isFlashing(_ id: String) -> Bool { flashing.contains(id) }
}
