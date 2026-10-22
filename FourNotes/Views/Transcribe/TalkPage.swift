import AppKit
import AVFoundation
import SwiftUI
import UniformTypeIdentifiers

// One talk: the recording, then three tabs. Notes: what you wrote, and Enhance's notes
// written out from it. Summary: who was in it (named by you or the conversation, each
// with a short profile) and the write-up. Transcript: who said what, where a time plays
// from that moment. As on the web (src/components/talks/TalkPage.tsx), with the notes.

struct TalkPage: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @ObservedObject private var recorder = TalkRecorder.shared
    @StateObject private var player = TalkPlayer()

    let talk: Talk
    let onDeleted: () -> Void

    @State private var renaming: String?
    @State private var newName = ""
    @State private var summarizing = false
    @State private var tab: Tab?
    /// The Notes tab shows your own notes rather than Enhance's.
    @State private var showsYours = false
    /// A moment to bring into view when the transcript next shows.
    @State private var jump: Double?

    private enum Tab: String, CaseIterable { case notes = "Notes", summary = "Summary", transcript = "Transcript" }

    /// Notes first when there are any (or there will be); else the summary.
    private var shownTab: Tab { tab ?? (talk.wantsNotes || talk.enhanced != nil ? .notes : .summary) }

    private var note: Note? { talk.noteId.flatMap { id in store.liveNotes.first { $0.id == id } } }
    private var working: String? { recorder.working[talk.id] }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(p.borderSubtle).frame(height: 1)
            top
            switch shownTab {
            case .notes: notesTab
            case .summary: scrolling { summaryTab }
            case .transcript: transcriptTab
            }
        }
        .background(p.bg)
        .onAppear {
            player.load(talk.hasAudio ? TalkStore.shared.audio(talk.id) : nil)
            takeMoment()
        }
        .onChange(of: nav.talkMoment) { _, _ in takeMoment() }
        .onChange(of: working) { _, now in
            // The mixed recording is made once transcribing starts.
            if now == nil || player.ready == false { player.load(talk.hasAudio ? TalkStore.shared.audio(talk.id) : nil) }
        }
        .onDisappear { player.stop() }
    }

    /// The title, what's happening, the player and the tabs: above every tab.
    private var top: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                CommittedField(placeholder: "Untitled talk", value: talk.title, font: FN.display(32), axis: .vertical) { title in
                    TalkStore.shared.update(talk.id) { $0.title = title.isEmpty ? TalkText.defaultTitle() : title }
                }
                .tracking(FN.displayTracking(32))
                Text(TalkText.meta(talk)).font(FN.small).monospacedDigit().foregroundStyle(p.textMuted)
            }

            if let working {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(working).font(FN.body).foregroundStyle(p.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            if let problem = talk.problem, working == nil { problemBox(problem) }

            if player.ready { playerBar }

            HStack(spacing: 8) {
                ForEach(Tab.allCases, id: \.self) { t in
                    PillButton(title: t.rawValue, selected: shownTab == t) { tab = t }
                }
                Spacer()
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Tabs")
        }
        .frame(maxWidth: 680, alignment: .leading)
        .padding(.horizontal, 40)
        .padding(.top, 26)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity)
    }

    /// A tab's content in the page's column, scrolling under the top.
    private func scrolling<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            content()
                .frame(maxWidth: 680, alignment: .leading)
                .padding(.horizontal, 40)
                .padding(.top, 14)
                .padding(.bottom, 90)
                .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
    }

    // MARK: - Notes

    private var notesTab: some View {
        VStack(spacing: 0) {
            notesBar
                .frame(maxWidth: 680, alignment: .leading)
                .padding(.horizontal, 40)
                .padding(.top, 4)
                .frame(maxWidth: .infinity)
            if let enhanced = talk.enhanced, !enhanced.sections.isEmpty, !showsYours {
                scrolling {
                    EnhancedNotesView(talk: talk, notes: enhanced,
                                      onPlay: player.ready ? { player.play(from: $0) } : nil,
                                      onShowInTranscript: { jump = $0; tab = .transcript })
                }
            } else {
                TalkNotesEditor(talkId: talk.id,
                                placeholder: talk.segments.isEmpty
                                    ? "Nothing written during it. Notes you add here stay with the talk."
                                    : "Nothing written during it. Add notes here, or use Enhance to write notes from the conversation.",
                                header: Color.clear.frame(height: 12))
            }
        }
    }

    /// Enhanced or yours; the kind of meeting; Enhance. A line when the notes are out of date.
    private var notesBar: some View {
        let enhanced = talk.enhanced.flatMap { $0.sections.isEmpty ? nil : $0 }
        let stale = enhanced.flatMap { e -> String? in
            if e.basedOn.trimmingCharacters(in: .whitespacesAndNewlines) != (talk.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines) {
                return "Your notes have changed since these were written. Enhance again to include them."
            }
            if let picked = talk.template, picked != e.template {
                return "Enhance again to write them as \(TalkTemplate.of(picked).label) notes."
            }
            return nil
        }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if enhanced != nil {
                    PillButton(icon: "sparkle", title: "Enhanced", selected: !showsYours) { showsYours = false }
                    PillButton(title: "Your notes", selected: showsYours) { showsYours = true }
                } else {
                    Text("Your notes").font(FN.bodyMedium).foregroundStyle(p.foreground)
                }
                Spacer(minLength: 8)
                TalkTemplateMenu(talkId: talk.id, template: talk.template ?? enhanced?.template)
                KitButton(kind: enhanced == nil ? .primary : .secondary, title: enhanced == nil ? "Enhance" : "Enhance again",
                          icon: "sparkle", small: true, disabled: talk.segments.isEmpty || working != nil) { enhance() }
                    .help(talk.segments.isEmpty ? "Enhance needs a transcript" : "Write your notes out in full from the conversation")
            }
            if let stale, !showsYours {
                Text(stale).font(FN.small).foregroundStyle(p.textMuted)
            }
        }
        .padding(.bottom, 6)
    }

    // MARK: - Summary tab

    @ViewBuilder
    private var summaryTab: some View {
        VStack(alignment: .leading, spacing: 28) {
            let people = TalkText.speakers(talk)
            if !people.isEmpty { peopleSection(people) }

            if let summary = talk.summary {
                summaryCard(summary)
            } else if working == nil, talk.status == .done, !talk.segments.isEmpty {
                SecondaryButton(title: summarizing ? "Writing…" : "Write a summary", icon: "sparkle") { writeUp() }
                    .fixedSize()
                    .disabled(summarizing)
            } else if talk.segments.isEmpty {
                Text("Nothing to sum up yet.").font(FN.body).foregroundStyle(p.textMuted)
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Spacer()
            if let note {
                SecondaryButton(title: "Open note", icon: "note") { nav.open(ChangeLink(kind: .notes, id: note.id)) }
                    .fixedSize()
            } else {
                SecondaryButton(title: "Save to Notes", icon: "noteAdd") { saveToNotes() }
                    .fixedSize()
                    .disabled(talk.segments.isEmpty)
            }
            IconMenu("more", size: 20, help: "More actions", align: .trailing) {
                var entries: [MenuEntry] = []
                if note != nil { entries.append(.item("Update the note") { saveToNotes() }) }
                if talk.enhanced != nil || talk.wantsNotes {
                    entries.append(.item("Copy notes") { copyNotes() })
                }
                entries += [
                    .item("Copy transcript") { copyTranscript() },
                    .item("Export notes…") { exportNotes() },
                    .item("Export transcript…") { exportTranscript() },
                    .item(talk.summary == nil ? "Write a summary" : "Write the summary again", enabled: !talk.segments.isEmpty && working == nil) { writeUp() },
                ]
                if talk.hasAudio {
                    entries.append(.item("Transcribe again with Whisper", enabled: TalkRecorder.whisperReady && working == nil) {
                        Task { await recorder.transcribeAgain(talk.id) }
                    })
                    entries.append(.item("Show recording in Finder") {
                        if let url = TalkStore.shared.audio(talk.id) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                    })
                }
                entries += [.divider, .item("Delete talk", destructive: true) { delete() }]
                return entries
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 60)
    }

    private func problemBox(_ problem: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Icon("info", size: 14).foregroundStyle(p.warning)
            Text(problem).font(FN.small).foregroundStyle(p.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if !TalkRecorder.whisperReady {
                SecondaryButton(title: "Get Whisper") { nav.openSettings(section: "api/speech") }.fixedSize()
            } else if talk.hasAudio {
                SecondaryButton(title: "Transcribe again") { Task { await recorder.transcribeAgain(talk.id) } }.fixedSize()
            }
        }
        .padding(14)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    // MARK: - Playback

    private var playerBar: some View {
        HStack(spacing: 12) {
            Button { player.toggle() } label: {
                Icon(player.playing ? "pause" : "play", size: 16)
                    .foregroundStyle(p.accentForeground)
                    .frame(width: 34, height: 34)
                    .background(p.accent, in: Circle())
            }
            .buttonStyle(.fn)
            .help(player.playing ? "Pause" : "Play")
            .accessibilityLabel(player.playing ? "Pause" : "Play")

            Text(TalkText.clock(player.time)).font(FN.small).monospacedDigit().foregroundStyle(p.textSecondary)
            Slider(value: Binding(get: { player.time }, set: { player.seek($0) }), in: 0...max(1, player.duration))
                .controlSize(.small)
                .tint(p.accent)
                .accessibilityLabel("Position")
            Text(TalkText.clock(player.duration)).font(FN.small).monospacedDigit().foregroundStyle(p.textMuted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(p.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))
    }

    // MARK: - People

    private func peopleSection(_ people: [TalkText.Speaker]) -> some View {
        let total = max(1, people.reduce(0) { $0 + $1.seconds })
        return VStack(alignment: .leading, spacing: 10) {
            SectionTitle("People · click a name to change it")
            VStack(spacing: 8) {
                ForEach(people, id: \.name) { person in
                    let profile = talk.summary?.people.first { person.ids.contains($0.speaker) }?.profile
                    HStack(alignment: .top, spacing: 12) {
                        Text(String(person.name.prefix(1)).uppercased())
                            .font(FN.bodyMedium)
                            .foregroundStyle(p.foreground)
                            .frame(width: 34, height: 34)
                            .background(p.surfaceMuted, in: Circle())
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                if renaming == person.name {
                                    TextField(person.name, text: $newName)
                                        .textFieldStyle(.plain)
                                        .font(FN.bodyMedium)
                                        .padding(.horizontal, 8)
                                        .frame(width: 200, height: 28)
                                        .background(p.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(p.borderStrong, lineWidth: 1))
                                        .onSubmit { rename(person.ids) }
                                        .onExitCommand { renaming = nil }
                                } else {
                                    Button {
                                        newName = person.name == "You" ? "" : person.name
                                        renaming = person.name
                                    } label: {
                                        Text(person.name).font(FN.bodyMedium).foregroundStyle(p.foreground)
                                    }
                                    .buttonStyle(.fn)
                                    .help("Change the name (the same name as another speaker merges them)")
                                }
                                Text("\(Int((person.seconds / total * 100).rounded()))% of the talking · \(person.lines) \(person.lines == 1 ? "line" : "lines")")
                                    .font(FN.small).monospacedDigit().foregroundStyle(p.textMuted)
                            }
                            if let profile {
                                Text(profile).font(FN.small).foregroundStyle(p.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                }
            }
        }
    }

    // MARK: - Summary

    private func summaryCard(_ s: TalkSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Icon("sparkle", size: 15).foregroundStyle(p.accent)
                Text("Summary").font(FN.bodyMedium).foregroundStyle(p.foreground)
            }
            Text(s.text).font(FN.font(15)).foregroundStyle(p.foreground).lineSpacing(4)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if !s.keyPoints.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    SectionTitle("Key points")
                    ForEach(s.keyPoints, id: \.self) { point in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(p.textMuted)
                            Text(point).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        }
                        .font(FN.body).foregroundStyle(p.foreground)
                    }
                }
            }
            if !s.actionItems.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        SectionTitle("Action items")
                        Spacer()
                        GhostButton(action: addAllTasks) {
                            HStack(spacing: 4) { Icon("plus", size: 12); Text("Add all to To-Do") }.font(FN.small)
                        }
                    }
                    ForEach(s.actionItems, id: \.self) { item in
                        HStack(alignment: .center, spacing: 8) {
                            Text("☐").foregroundStyle(p.textMuted)
                            Text(item).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                            Spacer(minLength: 8)
                            IconButton("plus", size: 13, box: 26, help: "Add “\(item)” to To-Do") {
                                addTask(item)
                                toasts.push("✅ To-do: \(item)")
                            }
                        }
                        .font(FN.body).foregroundStyle(p.foreground)
                    }
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.cardRadius, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    // MARK: - Transcript

    private var transcriptTab: some View {
        let lines = TalkText.turns(talk)
        let by: String
        switch talk.engine {
        case .whisper: by = " · Transcribed on this Mac by Whisper"
        case .apple: by = " · Transcribed on this Mac by Apple's speech model"
        case nil: by = ""
        }
        // The turn a jump lands on: the one it's in, or the last to start before it.
        let landing = jump.flatMap { at in lines.lastIndex { $0.start <= at + 1 } ?? 0 }
        return ScrollViewReader { scroller in
            scrolling {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle("Transcript" + (talk.status == .done ? by : ""))
                    if lines.isEmpty {
                        Text(talk.status == .done ? "Nothing was transcribed." : "Nothing yet.")
                            .font(FN.body).foregroundStyle(p.textMuted)
                    }
                    ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                        TranscriptLine(time: line.start, name: line.name, text: line.text,
                                       onPlay: player.ready ? { player.play(from: line.start) } : nil)
                            .padding(.vertical, 4)
                            .padding(.horizontal, 8)
                            .background(i == landing ? p.accentSubtle : .clear,
                                        in: RoundedRectangle(cornerRadius: FN.radius, style: .continuous))
                            .padding(.horizontal, -8)
                            .id(i)
                    }
                }
            }
            .onAppear {
                guard let landing else { return }
                Task { @MainActor in scroller.scrollTo(landing, anchor: .center) }
            }
            .onChange(of: jump) { _, _ in
                guard let landing else { return }
                withAnimation(Motion.standard) { scroller.scrollTo(landing, anchor: .center) }
            }
        }
    }

    // MARK: - Actions

    /// A moment the assistant cited: the transcript there, the player ready to play it.
    private func takeMoment() {
        guard let moment = nav.talkMoment, nav.selectedTalkId == talk.id else { return }
        nav.talkMoment = nil
        jump = moment
        tab = .transcript
        player.seek(moment)
    }

    private func rename(_ ids: [String]) {
        let clean = String(newName.trimmingCharacters(in: .whitespaces).prefix(60))
        renaming = nil
        guard !clean.isEmpty else { return }
        TalkStore.shared.update(talk.id) { t in for id in ids { t.names[id] = clean } }
    }

    private func saveToNotes() {
        let content = TalkText.note(talk)
        if let note {
            store.updateNote(note.id) { $0.content = content; $0.richText = nil; $0.html = nil }
            toasts.push("Updated the note with the latest transcript.", action: .init(label: "Open") {
                AppModel.shared.nav.open(ChangeLink(kind: .notes, id: note.id))
            })
            return
        }
        let n = store.addNote {
            $0.title = talk.title
            $0.content = content
            $0.source = .recording
            $0.tags = ["talk"]
        }
        TalkStore.shared.update(talk.id) { $0.noteId = n.id }
        toasts.push("📝 Saved to Notes", action: .init(label: "Open") {
            AppModel.shared.nav.open(ChangeLink(kind: .notes, id: n.id))
        })
    }

    private func addTask(_ title: String) {
        let clean = title.replacingOccurrences(of: #"^(?i)(you|me|saya)\s*:\s*"#, with: "", options: .regularExpression)
        _ = store.addTodo {
            $0.title = clean
            $0.noteId = talk.noteId
        }
    }

    private func addAllTasks() {
        let items = talk.summary?.actionItems ?? []
        for item in items { addTask(item) }
        toasts.push("✅ Added \(items.count == 1 ? "1 task" : "\(items.count) tasks") to To-Do")
    }

    private func writeUp() {
        summarizing = true
        Task {
            defer { summarizing = false }
            do { try await recorder.writeUp(talk.id) } catch {
                toasts.push(AIEngine.reason(error), tone: .error)
            }
        }
    }

    private func enhance() {
        showsYours = false
        Task {
            do { try await recorder.enhance(talk.id) } catch {
                toasts.push(AIEngine.reason(error), tone: .error)
            }
        }
    }

    /// Enhance's notes as Markdown, else yours as written.
    private var notesMarkdown: String {
        if let e = talk.enhanced, !e.sections.isEmpty { return e.markdown }
        return talk.notes ?? ""
    }

    private func copyNotes() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(notesMarkdown, forType: .string)
        toasts.push("Notes copied")
    }

    /// Everything as one Markdown file: the notes, the summary, the transcript.
    private func exportNotes() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        panel.nameFieldStringValue = fileName + ".md"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try ("# \(talk.title)\n\n" + TalkText.note(talk) + "\n").write(to: url, atomically: true, encoding: .utf8) } catch {
            toasts.push("Couldn't save it: \(error.localizedDescription)", tone: .error)
        }
    }

    private var fileName: String {
        let safe = talk.title.replacingOccurrences(of: #"[^\w\- ]+"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return safe.isEmpty ? "Talk" : safe
    }

    private func copyTranscript() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(TalkText.transcript(talk), forType: .string)
        toasts.push("Transcript copied")
    }

    private func exportTranscript() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        panel.nameFieldStringValue = fileName + ".txt"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let text = "\(talk.title)\n\(TalkText.meta(talk))\n\n\(TalkText.transcript(talk))\n"
        do { try text.write(to: url, atomically: true, encoding: .utf8) } catch {
            toasts.push("Couldn't save it: \(error.localizedDescription)", tone: .error)
        }
    }

    private func delete() {
        let id = talk.id
        player.stop()
        TalkStore.shared.remove(id)
        onDeleted()
        toasts.push("Talk deleted", action: .init(label: "Undo") { TalkStore.shared.update(id) { $0.deletedAt = nil } })
    }
}

/// Plays a talk's recording, from any moment.
@MainActor
final class TalkPlayer: ObservableObject {
    @Published private(set) var ready = false
    @Published private(set) var playing = false
    @Published private(set) var time: Double = 0
    @Published private(set) var duration: Double = 0

    private var player: AVPlayer?
    private var observer: Any?
    private var url: URL?
    private var ended: NSObjectProtocol?

    func load(_ url: URL?) {
        guard url != self.url else { return }
        stop()
        self.url = url
        guard let url else { ready = false; return }
        let player = AVPlayer(url: url)
        self.player = player
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] t in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.time = t.seconds.isFinite ? t.seconds : 0
                self.playing = (self.player?.rate ?? 0) > 0
            }
        }
        ended = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                       object: player.currentItem, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.playing = false }
        }
        Task { [weak self] in
            let seconds = (try? await AVURLAsset(url: url).load(.duration).seconds) ?? 0
            self?.duration = seconds.isFinite ? seconds : 0
            self?.ready = seconds > 0
        }
    }

    func toggle() {
        guard let player else { return }
        if player.rate > 0 { player.pause(); playing = false } else {
            if duration > 0, time >= duration - 0.25 { seek(0) }
            player.play()
            playing = true
        }
    }

    func play(from seconds: Double) {
        seek(seconds)
        player?.play()
        playing = true
    }

    func seek(_ seconds: Double) {
        time = seconds
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func stop() {
        player?.pause()
        if let observer { player?.removeTimeObserver(observer) }
        if let ended { NotificationCenter.default.removeObserver(ended) }
        observer = nil
        ended = nil
        player = nil
        playing = false
        ready = false
        url = nil
    }
}
