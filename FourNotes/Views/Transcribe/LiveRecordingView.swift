import SwiftUI

// While recording: your notes in the middle, the words as they're heard beside them
// (hide them to just write), the time and a meter for each side above. What you write
// is kept on the talk with when you wrote it; Enhance writes it out in full afterwards.

struct LiveRecordingView: View {
    @Environment(\.palette) private var p
    @AppStorage("fournotes.talk.showsTranscript") private var showsTranscript = true
    let talk: Talk

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                LiveStatus(app: talk.app, call: talk.mode == .call)
                Spacer(minLength: 8)
                TalkTemplateMenu(talkId: talk.id, template: talk.template)
                IconButton(showsTranscript ? "collapseRight" : "collapseLeft", size: 17,
                           help: showsTranscript ? "Hide the transcript" : "Show the transcript") {
                    showsTranscript.toggle()
                }
                StopButton()
            }
            .padding(.horizontal, 20)
            .frame(height: 60)
            Rectangle().fill(p.borderSubtle).frame(height: 1)
            LiveWarning()

            HStack(spacing: 0) {
                TalkNotesEditor(talkId: talk.id, recording: true,
                                placeholder: "Write notes as it goes: a few words is enough. When it ends, Enhance writes them out in full from the conversation. Type / for lists, checkboxes and tasks.",
                                header: LiveTitle(talkId: talk.id, title: talk.title))
                if showsTranscript {
                    Rectangle().fill(p.borderSubtle).frame(width: 1)
                    LiveTranscript(talk: talk)
                        .frame(width: 300)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .animation(Motion.standard, value: showsTranscript)
        }
        .background(p.bg)
    }
}

/// The talk's name above the notes, in the editor's scroll.
private struct LiveTitle: View {
    let talkId: String
    let title: String

    var body: some View {
        CommittedField(placeholder: "Untitled talk", value: title, font: FN.display(28)) { title in
            TalkStore.shared.update(talkId) { $0.title = title.isEmpty ? TalkText.defaultTitle() : title }
        }
        .tracking(FN.displayTracking(28))
        .frame(maxWidth: TalkNotesEditor<EmptyView>.column.maxWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, TalkNotesEditor<EmptyView>.column.padding)
        .padding(.top, 28)
        .padding(.bottom, 14)
    }
}

/// The dot, the time and a level for each side.
private struct LiveStatus: View {
    @Environment(\.palette) private var p
    @ObservedObject private var recorder = TalkRecorder.shared
    let app: String?
    let call: Bool

    var body: some View {
        HStack(spacing: 12) {
            RecordingDot(size: 10)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let seconds = recorder.startedAt.map { context.date.timeIntervalSince($0) } ?? 0
                Text(TalkText.clock(seconds) + (app.map { " · \($0)" } ?? ""))
                    .font(FN.bodyMedium).monospacedDigit()
                    .foregroundStyle(p.foreground)
                    .lineLimit(1)
                    .accessibilityLabel("Recording for \(TalkText.clock(seconds))")
            }
            if call {
                meter("You", recorder.levels.me)
                meter("Them", recorder.levels.them)
            } else {
                meter("Room", recorder.levels.me)
            }
        }
    }

    private func meter(_ label: String, _ level: Float) -> some View {
        HStack(spacing: 6) {
            Text(label).font(FN.small).foregroundStyle(p.textMuted)
            ZStack(alignment: .leading) {
                Capsule().fill(p.surfaceMuted)
                Capsule().fill(p.accent).frame(width: max(3, 56 * CGFloat(level)))
                    .animation(.linear(duration: 0.1), value: level)
            }
            .frame(width: 56, height: 5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) level")
        .accessibilityValue("\(Int(level * 100)) percent")
    }
}

private struct StopButton: View {
    @Environment(\.palette) private var p
    @ObservedObject private var recorder = TalkRecorder.shared

    var body: some View {
        Button { Task { await recorder.stop() } } label: {
            HStack(spacing: 6) {
                Icon("stop", size: 14)
                Text(recorder.status == .stopping ? "Finishing…" : "Stop")
            }
            .font(FN.bodyMedium)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .background(p.danger, in: Capsule())
        }
        .buttonStyle(.fn)
        .disabled(recorder.status != .recording)
        .keyboardShortcut(".", modifiers: .command)
        .help("Stop recording (⌘.)")
    }
}

/// What the recorder warns about ("Only your microphone is being heard"), under the bar.
private struct LiveWarning: View {
    @Environment(\.palette) private var p
    @ObservedObject private var recorder = TalkRecorder.shared

    var body: some View {
        if let warning = recorder.warning {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Icon("info", size: 14)
                Text(warning).fixedSize(horizontal: false, vertical: true)
            }
            .font(FN.small)
            .foregroundStyle(p.textSecondary)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(p.surfaceMuted)
        }
    }
}

/// The words as they're heard, newest at the bottom.
private struct LiveTranscript: View {
    @Environment(\.palette) private var p
    @ObservedObject private var recorder = TalkRecorder.shared
    let talk: Talk

    var body: some View {
        let lines = Array(TalkText.turns(talk).suffix(30))
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle("Transcript")
                .padding(.horizontal, 20)
                .padding(.top, 18)
            ScrollViewReader { scroller in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if lines.isEmpty && recorder.caption.isEmpty {
                            Text("Listening. Words appear here as they're spoken.")
                                .font(FN.body).foregroundStyle(p.textMuted)
                        }
                        ForEach(lines, id: \.start) { line in
                            TranscriptLine(time: line.start, name: line.name, text: line.text)
                        }
                        if !recorder.caption.isEmpty {
                            Text(recorder.caption)
                                .font(FN.font(15)).italic()
                                .foregroundStyle(p.textMuted)
                                .lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Transcript so far")
                }
                .scrollIndicators(.never)
                .onAppear { scroller.scrollTo("end") }
                .onChange(of: talk.segments.count) { _, _ in withAnimation(Motion.standard) { scroller.scrollTo("end") } }
                .onChange(of: recorder.caption) { _, _ in scroller.scrollTo("end") }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(p.surface)
    }
}

/// Which kind of meeting the notes are for: Enhance writes them in its sections.
struct TalkTemplateMenu: View {
    let talkId: String
    let template: String?

    var body: some View {
        let current = TalkTemplate.of(template)
        TextMenu(title: "\(current.label) notes", help: "The kind of meeting: Enhance writes your notes in its sections") {
            [.header("Write the notes for")] + TalkTemplate.allCases.map { t in
                .item(t.label, checked: current == t) {
                    TalkStore.shared.update(talkId) { $0.template = t.rawValue }
                }
            }
        }
    }
}

/// "0:42  Andi: …", the time playing from there when there's a recording.
struct TranscriptLine: View {
    @Environment(\.palette) private var p
    let time: Double
    let name: String
    let text: String
    var onPlay: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Group {
                if let onPlay {
                    Button(action: onPlay) {
                        Text(TalkText.clock(time))
                    }
                    .buttonStyle(.fn)
                    .help("Play from here")
                } else {
                    Text(TalkText.clock(time))
                }
            }
            .font(FN.small).monospacedDigit()
            .foregroundStyle(p.textMuted)
            .frame(minWidth: 38, alignment: .leading)

            Text("\(Text(name + ": ").font(FN.font(15, .medium)))\(Text(text))")
                .font(FN.font(15))
                .foregroundStyle(p.foreground)
                .lineSpacing(4)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
