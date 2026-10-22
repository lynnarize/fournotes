import AppKit
import SwiftUI

// A chat about a talk: what you ask, answered from the conversation (so far, while it's
// being recorded) and what else you have on it, with where each answer came from. In
// the column beside your notes while recording (`compact`), and on the talk's page after,
// under its recipes. Kept on the talk (TalkChat).

struct TalkChatView<Header: View>: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var toasts: ToastCenter
    @ObservedObject private var chat = TalkChat.shared
    @ObservedObject private var recorder = TalkRecorder.shared
    let talk: Talk
    /// The narrow column while recording, rather than the talk's page.
    var compact = false
    @ViewBuilder var header: () -> Header

    @State private var text = ""
    @FocusState private var focused: Bool

    private var busy: Bool { chat.busy.contains(talk.id) }
    private var live: Bool { recorder.talkId == talk.id && recorder.isActive }

    private var quick: [String] {
        live ? ["What did I miss?", "Summarize so far", "What's been decided?"]
             : ["What was decided?", "What do I need to do?", "What did they ask for?"]
    }

    var body: some View {
        let messages = talk.chat ?? []
        VStack(spacing: 0) {
            ScrollViewReader { scroller in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header()
                        if messages.isEmpty {
                            Text(live ? "Ask about the meeting so far: what was said, what's been decided, what you missed. Answers come from the conversation and your notes and library."
                                      : "Ask anything about this talk. Answers come from the conversation, your notes and your library.")
                                .font(FN.body).foregroundStyle(p.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        ForEach(messages) { message in
                            if message.role == .user {
                                ChatQuestion(message: message)
                            } else {
                                ChatAnswer(message: message)
                            }
                        }
                        if busy {
                            HStack(spacing: 8) {
                                ProgressView().controlSize(.small)
                                Text(live ? "Reading the meeting so far…" : "Reading the talk…")
                            }
                            .font(FN.small).foregroundStyle(p.textSecondary)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(.horizontal, compact ? 14 : 0)
                    .padding(.bottom, 16)
                }
                .scrollIndicators(.never)
                .onAppear { scroller.scrollTo("end") }
                .onChange(of: messages.count) { _, _ in withAnimation(Motion.standard) { scroller.scrollTo("end") } }
                .onChange(of: busy) { _, _ in withAnimation(Motion.standard) { scroller.scrollTo("end") } }
            }
            composer
        }
    }

    private var composer: some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        let empty = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 8) {
            FlowLayout(spacing: 6, alignment: .leading) {
                ForEach(quick, id: \.self) { q in
                    PillButton(title: q) { send(q) }
                        .disabled(busy)
                }
            }
            HStack(alignment: .bottom, spacing: 6) {
                TextField(live ? "Ask about the meeting so far" : "Ask about this talk", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(FN.font(compact ? 14 : 15))
                    .lineSpacing(3)
                    .foregroundStyle(p.foreground)
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.leading, 8)
                    .padding(.vertical, 7)
                    .onSubmit { send(text) }
                    .accessibilityLabel(live ? "Ask about the meeting so far" : "Ask about this talk")
                Button { send(text) } label: {
                    ZStack {
                        Circle().fill(busy || empty ? p.surfaceMuted : p.accent)
                        if busy {
                            BusyRing(color: p.foreground)
                        } else {
                            Icon("arrowUp", size: 15).foregroundStyle(empty ? p.textMuted : p.accentForeground)
                        }
                    }
                    .frame(width: 30, height: 30)
                    .contentShape(Circle())
                }
                .buttonStyle(.fn)
                .disabled(busy || empty)
                .help("Ask")
                .accessibilityLabel(busy ? "Answering" : "Ask")
            }
            .padding(5)
            .background(compact ? p.bg : p.surface, in: shape)
            .overlay(shape.strokeBorder(focused ? p.borderStrong : p.border, lineWidth: 1))
            .motion(focused, Motion.quick)
        }
        .padding(.horizontal, compact ? 14 : 0)
        .padding(.top, 8)
        .padding(.bottom, compact ? 14 : 24)
    }

    private func send(_ question: String) {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        text = ""
        Task {
            do {
                try await chat.ask(q, talkId: talk.id)
            } catch {
                if text.isEmpty { text = q }
                toasts.push(AIEngine.reason(error), tone: .error)
            }
        }
    }
}

/// Your question, on the right, with when in the talk you asked it.
private struct ChatQuestion: View {
    @Environment(\.palette) private var p
    let message: TalkChatMessage

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(message.text)
                .font(FN.font(14))
                .lineSpacing(3)
                .foregroundStyle(p.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            if let at = message.at {
                Text("Asked at \(TalkText.clock(at))").font(FN.font(11)).monospacedDigit().foregroundStyle(p.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 32)
    }
}

/// An answer: the text, where it came from, who answered and where, and copying it.
private struct ChatAnswer: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var toasts: ToastCenter
    let message: TalkChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TalkRichText.text(message.text)
                .font(FN.font(14))
                .lineSpacing(3)
                .foregroundStyle(p.foreground)
                .tint(p.foreground)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            CitationRow(sources: message.sources)
            HStack(spacing: 6) {
                if let by = message.by {
                    if message.onThisMac ?? true {
                        OnDeviceMark(origin: .onDevice, name: by)
                    } else {
                        CloudMark(name: by)
                    }
                }
                Spacer(minLength: 0)
                IconButton("copy", size: 13, box: 24, help: "Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(message.text, forType: .string)
                    toasts.push("Copied")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A model's Markdown, with its inline marks (bold, links) drawn and its lines kept.
enum TalkRichText {
    static func text(_ markdown: String) -> Text {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard let parsed = try? AttributedString(markdown: markdown, options: options) else { return Text(markdown) }
        return Text(parsed)
    }
}
