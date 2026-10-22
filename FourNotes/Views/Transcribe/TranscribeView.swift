import SwiftUI

// Transcribe: conversations you record, in person or on a call (Zoom, Google Meet,
// a WhatsApp call), transcribed with who said what, written up, and searchable by the
// assistant. A list of talks beside the open one, as Notes has it. Recording carries on
// while you use the rest of the app. As on the web (src/components/TranscribeView.tsx).

struct TranscribeView: View {
    /// `nav.selectedTalkId` for the new-recording page rather than a talk.
    static let newRecording = "new"

    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var assistant: Assistant
    @ObservedObject private var talks = TalkStore.shared
    @ObservedObject private var recorder = TalkRecorder.shared

    @State private var query = ""
    @FocusState private var searchFocused: Bool

    private var mine: [Talk] { talks.live(in: store.currentSpaceId) }
    private var list: [Talk] { mine.filter { TalkText.matches($0, query) } }

    private enum Detail: Equatable {
        case new, live(String), talk(String), empty
    }

    private var detail: Detail {
        let picked = nav.selectedTalkId
        if picked == Self.newRecording { return recorder.isActive ? recorder.talkId.map(Detail.live) ?? .empty : .new }
        if let id = picked ?? recorder.talkId, recorder.isActive, id == recorder.talkId { return .live(id) }
        if let id = picked, mine.contains(where: { $0.id == id }) { return .talk(id) }
        if let first = list.first { return .talk(first.id) }
        return .empty
    }

    var body: some View {
        let detail = detail
        HStack(alignment: .top, spacing: 0) {
            listColumn(selected: detail)
                .frame(width: 330)
                .background(p.background)
                .zIndex(1)
            Rectangle().fill(p.border).frame(width: 1).zIndex(1)
            Group {
                switch detail {
                case .new:
                    NewRecordingView(onStarted: { nav.selectedTalkId = $0 },
                                     onCancel: { nav.selectedTalkId = nil })
                case .live(let id):
                    if let talk = talks.talk(id) { LiveRecordingView(talk: talk) }
                case .talk(let id):
                    if let talk = talks.talk(id) {
                        TalkPage(talk: talk, onDeleted: { nav.selectedTalkId = nil }).id(id)
                    }
                case .empty:
                    emptyDetail
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.opacity.combined(with: .offset(x: 8)))
        }
        .frame(maxHeight: .infinity)
        .animation(Motion.screen, value: detail)
        .background(p.bg)
        .task { recorder.resumeInterrupted() }
        .task(id: nav.focus) {
            guard let link = nav.consumeFocus([.talks]) else { return }
            query = ""
            nav.selectedTalkId = link.id
        }
    }

    // MARK: - List

    private func listColumn(selected: Detail) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text("Transcribe")
                    .font(FN.display(28))
                    .tracking(FN.displayTracking(28))
                    .foregroundStyle(p.foreground)
                Spacer()
                if recorder.isActive {
                    Button { if let id = recorder.talkId { nav.selectedTalkId = id } } label: {
                        HStack(spacing: 7) {
                            RecordingDot(size: 8)
                            Text(recorder.status == .starting ? "Starting…" : "Recording")
                        }
                        .font(FN.bodyMedium)
                        .foregroundStyle(p.danger)
                        .padding(.leading, 10)
                        .padding(.trailing, 14)
                        .frame(height: 36)
                        .background(p.surface, in: Capsule())
                        .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))
                    }
                    .buttonStyle(.fn)
                    .help("Go to the recording")
                } else {
                    PrimaryButton(title: "Record", icon: "mic") { nav.selectedTalkId = Self.newRecording }
                        .help("Record a conversation")
                }
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
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
                .padding(.horizontal, 4)
                .padding(.top, -4)
                .padding(.bottom, 8)
                .transition(.opacity)
            }

            ScrollView {
                let rows = list
                LazyVStack(spacing: 4) {
                    ForEach(rows) { talk in
                        TalkRow(talk: talk, isSelected: selected == .talk(talk.id) || selected == .live(talk.id),
                                working: recorder.working[talk.id] != nil || talk.id == recorder.talkId) {
                            nav.selectedTalkId = talk.id
                        }
                        .contextMenu {
                            Button("Delete talk", role: .destructive) { delete(talk) }
                                .disabled(talk.id == recorder.talkId)
                        }
                    }
                    if mine.isEmpty {
                        VStack(spacing: 4) {
                            Text("No talks yet").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                            Text("Record a conversation in person, or a Zoom, Google Meet or WhatsApp call on this Mac. You get who said what, a summary, and a note if you want one.")
                                .font(FN.body).lineSpacing(3).foregroundStyle(p.textMuted)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 32)
                    } else if rows.isEmpty {
                        Text("No talk mentions that. Ask the assistant instead.")
                            .font(FN.body).foregroundStyle(p.textMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 32)
                    }
                }
                .animation(Motion.list, value: rows.map(\.id))
                .padding(.bottom, 90)
            }
            .scrollIndicators(.never)
        }
        .padding(.horizontal, 12)
        .animation(Motion.standard, value: query.isEmpty)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Icon("search", size: 16).foregroundStyle(p.textMuted)
            TextField("Search talks", text: $query)
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
            Icon("wave", size: 28).foregroundStyle(p.textMuted)
            Text("Record a conversation").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                .padding(.top, 12)
            Text("In person, or a call in another app on this Mac.")
                .font(FN.body).foregroundStyle(p.textMuted)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
            PrimaryButton(title: "Record", icon: "mic") { nav.selectedTalkId = Self.newRecording }
                .padding(.top, 16)
        }
        .frame(maxWidth: 384)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Actions

    /// Sending opens the assistant's panel, with the answer coming in.
    private func askAssistant(_ q: String) {
        let question = q.hasSuffix("?") || q.hasSuffix("？") ? "In my recorded talks: \(q)" : "What did my recorded talks say about \(q)?"
        Task { _ = await assistant.send(question) }
    }

    private func delete(_ talk: Talk) {
        talks.remove(talk.id)
        if nav.selectedTalkId == talk.id { nav.selectedTalkId = nil }
        AppModel.shared.toasts.push("Talk deleted", action: .init(label: "Undo") {
            TalkStore.shared.update(talk.id) { $0.deletedAt = nil }
        })
    }
}

/// A talk in the list: what it was, when, how long, who.
private struct TalkRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let talk: Talk
    let isSelected: Bool
    let working: Bool
    let action: () -> Void

    var body: some View {
        let people = TalkText.speakers(talk).map(\.name).filter { $0 != "You" }.prefix(3)
        let preview = talk.summary?.text
            ?? TalkText.turns(talk).prefix(2).map { "\($0.name): \($0.text)" }.joined(separator: " ")
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Icon(talk.mode == .call ? "monitor" : talk.mode == .upload ? "download" : "users", size: 14)
                        .foregroundStyle(p.textMuted)
                    Text(talk.title)
                        .font(FN.font(16, .medium))
                        .foregroundStyle(p.foreground)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(Self.date(talk.createdAt))
                        .font(FN.small).monospacedDigit()
                        .foregroundStyle(p.textMuted)
                }
                Text(preview.isEmpty ? "No words yet" : preview)
                    .font(FN.font(13))
                    .foregroundStyle(p.textSecondary)
                    .lineSpacing(3.5)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(TalkText.clock(talk.duration)).monospacedDigit()
                    if let app = talk.app { Text("·"); Text(app).lineLimit(1) }
                    if !people.isEmpty { Text("·"); Text(people.joined(separator: ", ")).lineLimit(1) }
                    Spacer(minLength: 4)
                    // The kit's `.badge`, in danger while recording, the accent while transcribing.
                    if talk.status == .recording {
                        StatusPill(text: "Recording", tone: .bad, dot: false)
                    } else if talk.status == .transcribing || working {
                        StatusPill(text: "Transcribing…", tone: .accent, dot: false)
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

    private static let short: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d"
        return f
    }()

    private static let withYear: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMM d, yyyy"
        return f
    }()

    static func date(_ iso: String) -> String {
        guard let d = DateKit.date(iso) else { return "" }
        return (Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year) ? short : withYear).string(from: d)
    }
}

/// The red dot of a recording in progress, breathing.
struct RecordingDot: View {
    @Environment(\.palette) private var p
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var size: CGFloat = 10
    @State private var dim = false

    var body: some View {
        Circle()
            .fill(p.danger)
            .frame(width: size, height: size)
            .opacity(dim ? 0.35 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
}
