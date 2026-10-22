import SwiftUI

// While recording: the time, a meter for each side, and the words as they're heard.

struct LiveRecordingView: View {
    @Environment(\.palette) private var p
    @ObservedObject private var recorder = TalkRecorder.shared
    let talk: Talk

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
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
            .padding(.horizontal, 20)
            .frame(height: 60)
            Rectangle().fill(p.borderSubtle).frame(height: 1)

            ScrollViewReader { scroller in
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        HStack(spacing: 12) {
                            RecordingDot(size: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                CommittedField(placeholder: "Untitled talk", value: talk.title, font: FN.display(28)) { title in
                                    TalkStore.shared.update(talk.id) { $0.title = title.isEmpty ? TalkText.defaultTitle() : title }
                                }
                                .tracking(FN.displayTracking(28))
                                TimelineView(.periodic(from: .now, by: 1)) { context in
                                    let seconds = recorder.startedAt.map { context.date.timeIntervalSince($0) } ?? 0
                                    Text(TalkText.clock(seconds) + (talk.app.map { " · \($0)" } ?? ""))
                                        .font(FN.small).monospacedDigit()
                                        .foregroundStyle(p.textMuted)
                                        .accessibilityLabel("Recording for \(TalkText.clock(seconds))")
                                }
                            }
                        }

                        VStack(spacing: 8) {
                            if talk.mode == .call {
                                meter("You", recorder.levels.me)
                                meter("Them", recorder.levels.them)
                            } else {
                                meter("Room", recorder.levels.me)
                            }
                        }

                        if let warning = recorder.warning {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Icon("info", size: 14)
                                Text(warning).fixedSize(horizontal: false, vertical: true)
                            }
                            .font(FN.small)
                            .foregroundStyle(p.textSecondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                        }

                        let lines = Array(TalkText.turns(talk).suffix(12))
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
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel("Transcript so far")
                    }
                    .frame(maxWidth: 680, alignment: .leading)
                    .padding(.horizontal, 40)
                    .padding(.top, 32)
                    .padding(.bottom, 90)
                    .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.never)
                .onChange(of: talk.segments.count) { _, _ in withAnimation(Motion.standard) { scroller.scrollTo("end") } }
                .onChange(of: recorder.caption) { _, _ in scroller.scrollTo("end") }
            }
        }
        .background(p.bg)
    }

    private func meter(_ label: String, _ level: Float) -> some View {
        HStack(spacing: 12) {
            Text(label).font(FN.small).foregroundStyle(p.textMuted).frame(width: 44, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(p.surfaceMuted)
                    Capsule().fill(p.accent).frame(width: max(4, geo.size.width * CGFloat(level)))
                        .animation(.linear(duration: 0.1), value: level)
                }
            }
            .frame(height: 6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label) level")
        .accessibilityValue("\(Int(level * 100)) percent")
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
