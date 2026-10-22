import SwiftUI

// Enhance's notes on a talk: your own lines in full ink, what it added in a lighter
// one, so you can see what you wrote and what was filled in. A line that knows where it
// came from shows its time when the pointer is on it (a time on every line was too much
// to read past); a click shows that part of the conversation, to play from there or
// find in the transcript.

struct EnhancedNotesView: View {
    @Environment(\.palette) private var p
    let talk: Talk
    let notes: TalkNotes
    /// Plays the recording from a moment; nil when there's no recording.
    var onPlay: ((Double) -> Void)?
    var onShowInTranscript: (Double) -> Void

    /// The line whose part of the conversation is showing.
    @State private var open: String?
    /// The line under the pointer.
    @State private var hovered: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(Array(notes.sections.enumerated()), id: \.offset) { s, section in
                VStack(alignment: .leading, spacing: 9) {
                    Text(section.heading)
                        .font(FN.font(17, .semibold))
                        .foregroundStyle(p.foreground)
                        .textSelection(.enabled)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(Array(section.lines.enumerated()), id: \.offset) { l, line in
                        row(line, id: "\(s)-\(l)")
                    }
                }
            }
            legend
        }
        .animation(Motion.quick, value: open)
    }

    private func row(_ line: TalkNotes.Line, id: String) -> some View {
        let indent = CGFloat(line.depth) * 22
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Text(line.depth > 0 ? "◦" : "•").foregroundStyle(p.textMuted)
                Text(line.text)
                    .font(FN.font(15))
                    .foregroundStyle(line.mine ? p.foreground : p.textSecondary)
                    .lineSpacing(4)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if let at = line.at {
                    Button { open = open == id ? nil : id } label: {
                        Text(TalkText.clock(at))
                            .font(FN.small).monospacedDigit()
                            .foregroundStyle(open == id ? p.accent : p.textMuted)
                            .padding(.horizontal, 7)
                            .frame(height: 22)
                            .background(open == id ? p.accentSubtle : p.surfaceMuted, in: Capsule())
                    }
                    .buttonStyle(.fn)
                    .opacity(hovered == id || open == id ? 1 : 0)
                    .help("Where this came from in the conversation")
                    .accessibilityLabel("From \(TalkText.clock(at)) in the conversation")
                }
            }
            .padding(.leading, indent)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { hovered = id } else if hovered == id { hovered = nil }
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint(line.mine ? "Your note" : "Added from the conversation")

            if open == id, let at = line.at {
                source(at)
                    .padding(.leading, indent + 18)
                    .transition(.opacity)
            }
        }
    }

    /// The part of the conversation a line came from: the turn it's in, and the turns either side.
    private func source(_ at: Double) -> some View {
        let turns = TalkText.turns(talk)
        let i = turns.lastIndex { $0.start <= at + 1 } ?? 0
        let shown = turns.isEmpty ? [] : Array(turns[max(0, i - 1)...min(turns.count - 1, i + 1)])
        return VStack(alignment: .leading, spacing: 10) {
            if shown.isEmpty {
                Text("The transcript has nothing at \(TalkText.clock(at)).").font(FN.small).foregroundStyle(p.textMuted)
            }
            ForEach(shown, id: \.start) { turn in
                TranscriptLine(time: turn.start, name: turn.name,
                               text: turn.text.count > 320 ? String(turn.text.prefix(320)) + "…" : turn.text,
                               onPlay: onPlay.map { play in { play(turn.start) } })
            }
            HStack(spacing: 4) {
                if let onPlay {
                    GhostButton(action: { onPlay(at) }) {
                        HStack(spacing: 5) { Icon("play", size: 12); Text("Play from \(TalkText.clock(at))") }.font(FN.small)
                    }
                }
                GhostButton(action: { onShowInTranscript(at) }) {
                    HStack(spacing: 5) { Icon("lines", size: 12); Text("Show in transcript") }.font(FN.small)
                }
            }
            .padding(.leading, -10)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
    }

    private var legend: some View {
        HStack(spacing: 14) {
            HStack(spacing: 6) { Circle().fill(p.foreground).frame(width: 7, height: 7); Text("Your notes") }
            HStack(spacing: 6) { Circle().fill(p.textSecondary.opacity(0.6)).frame(width: 7, height: 7); Text("Added from the conversation") }
            Spacer()
        }
        .font(FN.small)
        .foregroundStyle(p.textMuted)
        .accessibilityElement(children: .combine)
    }
}
