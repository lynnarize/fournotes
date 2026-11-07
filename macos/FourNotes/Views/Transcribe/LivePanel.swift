import SwiftUI

// The column beside your notes while a talk is recorded: the words as they're heard,
// the questions Live Q&A answered from your notes and library, and a chat about the
// meeting so far. As Foresight lays it out.

enum LivePanelTab: String, CaseIterable {
    case transcript = "Transcript", answers = "Live Q&A", chat = "Chat"
}

struct LivePanel: View {
    @Environment(\.palette) private var p
    @ObservedObject private var live = LiveQA.shared
    @AppStorage("fournotes.talk.panel") private var tab = LivePanelTab.transcript
    let talk: Talk

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                ForEach(LivePanelTab.allCases, id: \.self) { t in
                    PanelTab(title: t.rawValue, selected: tab == t, badge: t == .answers && tab != .answers ? live.unseen : 0) { tab = t }
                }
                Spacer(minLength: 0)
                IconMenu("more", size: 17, box: 28, help: "Live Q&A", align: .trailing) {
                    [.item("Answer questions as they're asked", checked: live.isOn) { live.isOn.toggle() }]
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 10)

            switch tab {
            case .transcript: LiveTranscript(talk: talk)
            case .answers: LiveAnswersList(talk: talk)
            case .chat: TalkChatView(talk: talk, compact: true) { EmptyView() }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(p.surface)
        .onAppear { live.viewing = tab == .answers }
        .onChange(of: tab) { _, now in live.viewing = now == .answers }
        .onDisappear { live.viewing = false }
    }
}

/// A tab at the top of the column: small, with a count of what's new.
private struct PanelTab: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let title: String
    let selected: Bool
    let badge: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title).lineLimit(1)
                if badge > 0 {
                    Text("\(badge)")
                        .font(FN.font(10.5, .semibold)).monospacedDigit()
                        .foregroundStyle(p.accentForeground)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 17, minHeight: 17)
                        .background(p.accent, in: Capsule(style: .circular))
                }
            }
            .font(FN.font(13, selected ? .medium : .regular))
            .foregroundStyle(selected || hovering ? p.foreground : p.textSecondary)
            .padding(.horizontal, 11)
            .frame(height: 30)
            .background(selected ? p.accentSubtle : (hovering ? p.hover : .clear), in: Capsule(style: .circular))
            .contentShape(Capsule(style: .circular))
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .accessibilityLabel(badge > 0 ? "\(title), \(badge) new" : title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Live Q&A

/// What Live Q&A answered, newest first, under a line saying where it's answered and
/// what it's doing.
struct LiveAnswersList: View {
    @Environment(\.palette) private var p
    @ObservedObject private var live = LiveQA.shared
    let talk: Talk

    var body: some View {
        let answers = (talk.answers ?? []).reversed()
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                status
                if live.isOn, answers.isEmpty, live.working == nil {
                    Text("When someone asks something your notes, talks or library answer, the answer shows here.")
                        .font(FN.body).foregroundStyle(p.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(answers)) { answer in
                    LiveAnswerCard(talk: talk, answer: answer, live: true)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.never)
    }

    @ViewBuilder
    private var status: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !live.isOn {
                Text("Live Q&A is off.").font(FN.body).foregroundStyle(p.textSecondary)
                KitButton(kind: .secondary, title: "Turn it on", small: true) { live.isOn = true }
                    .fixedSize()
            } else {
                AnsweredWhere()
                if let working = live.working {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text("Looking up “\(working)”").lineLimit(2)
                    }
                    .font(FN.small).foregroundStyle(p.textSecondary)
                } else if let problem = live.problem {
                    Text(problem).font(FN.small).foregroundStyle(p.warning)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let missed = live.missed {
                    Text("Nothing in your notes on “\(missed)”").font(FN.small).foregroundStyle(p.textMuted).lineLimit(2)
                }
            }
        }
        .padding(.bottom, 4)
    }
}

/// "Answered on this Mac by Apple Intelligence" — or in the cloud, by whom. The order
/// is Settings' (This Mac first, or the cloud).
struct AnsweredWhere: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var engine: AIEngine

    var body: some View {
        let name = engine.chatAnswererName
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Icon(engine.chatRunsOnDevice ? "monitor" : "cloud", size: 11)
            Text(name.map { engine.chatRunsOnDevice ? "Answered on this Mac by \($0), from your notes and library"
                                                    : "Answered in the cloud by \($0), from your notes and library" }
                 ?? "Needs Apple Intelligence or an AI model (Settings → AI & API keys)")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(FN.font(11.5))
        .foregroundStyle(p.textMuted)
    }
}

/// One question and its answer: who asked and when, where it came from, and keeping it.
struct LiveAnswerCard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var toasts: ToastCenter
    let talk: Talk
    let answer: TalkAnswer
    /// While recording: "Add to my notes". After, the notes are Enhance's to write.
    var live = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("\(TalkText.name(talk, answer.speaker)) · \(TalkText.clock(answer.at))")
                    .font(FN.small).monospacedDigit().foregroundStyle(p.textMuted)
                Spacer(minLength: 4)
                IconButton("x", size: 12, box: 22, help: "Dismiss") { LiveQA.shared.dismiss(answer.id, talkId: talk.id) }
            }
            Text(answer.question)
                .font(FN.bodyMedium).foregroundStyle(p.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Text(answer.answer)
                .font(FN.font(14)).lineSpacing(3).foregroundStyle(p.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            CitationRow(sources: answer.sources)
            HStack(spacing: 6) {
                if answer.onThisMac {
                    OnDeviceMark(origin: .onDevice, name: answer.by)
                } else {
                    CloudMark(name: answer.by)
                }
                Spacer(minLength: 4)
                if live {
                    GhostButton(action: add) {
                        HStack(spacing: 4) { Icon("plus", size: 12); Text("Add to my notes") }.font(FN.small)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.bg, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    private func add() {
        LiveQA.shared.addToNotes(answer, talkId: talk.id)
        toasts.push("Added to your notes")
    }
}

/// The chips under an answer; each opens where it came from.
struct CitationRow: View {
    @EnvironmentObject private var nav: Navigation
    let sources: [TalkCitation]

    var body: some View {
        if !sources.isEmpty {
            FlowLayout(spacing: 6, alignment: .leading) {
                ForEach(sources, id: \.self) { source in
                    CitationChip(citation: source.citation) { nav.open(source.citation) }
                }
            }
        }
    }
}

extension Navigation {
    /// Opens where a cited passage is: the note, the talk at that moment, the file there.
    func open(_ citation: KnowledgeCitation) {
        switch citation.origin {
        case .note(let id): open(ChangeLink(kind: .notes, id: id))
        case .talk(let id, let at): open(talk: id, at: at)
        case .library(let source, let document, let page, let offset):
            open(source: source, document: document, page: page, offset: offset)
        }
    }
}
