import AppKit
import SwiftUI

// Transcribe's meetings, from the calendar, above the talks: today's, with a Now line
// through them (the ones under way just above it), then tomorrow's. A meeting records
// in one click, joins its call first when it has a link, and opens its talk once it's
// been recorded. Without the calendar, a quiet row offers to connect it.

struct MeetingsSection: View {
    @Environment(\.palette) private var p
    @ObservedObject private var calendar = MeetingCalendar.shared
    @ObservedObject private var talks = TalkStore.shared
    @ObservedObject private var recorder = TalkRecorder.shared
    @AppStorage(MeetingCalendar.connectDismissedKey) private var connectDismissed = false
    /// The meeting being started, while its call opens.
    @State private var starting: String?

    let selectedTalkId: String?
    /// A meeting's talk.
    let onOpen: (String) -> Void
    /// A meeting not recorded yet: the new-recording page, with it filled in.
    let onPick: (Meeting) -> Void

    var body: some View {
        if calendar.access == .allowed {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                days(now: context.date)
            }
        } else if !connectDismissed {
            connectRow
        }
    }

    // MARK: - The list

    private func days(now: Date) -> some View {
        let cal = Calendar.current
        let today = calendar.meetings.filter { cal.isDate($0.start, inSameDayAs: now) }
        let next = cal.date(byAdding: .day, value: 1, to: now) ?? now
        let tomorrow = calendar.meetings.filter { cal.isDate($0.start, inSameDayAs: next) }
        let line = MeetingRules.nowLine(today, now: now)
        return VStack(alignment: .leading, spacing: 4) {
            heading("Today")
            if today.isEmpty {
                Text("Nothing on your calendar today.")
                    .font(FN.font(13)).foregroundStyle(p.textMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
            } else {
                ForEach(Array(today.enumerated()), id: \.element.id) { i, meeting in
                    if i == line { NowLine(now: now) }
                    row(meeting, now: now)
                }
                if line == today.count { NowLine(now: now) }
            }
            if !tomorrow.isEmpty {
                heading("Tomorrow")
                ForEach(tomorrow) { row($0, now: now) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(Motion.list, value: calendar.meetings.map(\.id))
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(FN.small)
            .foregroundStyle(p.textMuted)
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 2)
    }

    private func row(_ meeting: Meeting, now: Date) -> some View {
        let talk = talks.all.first { $0.isAlive && meeting.matches($0.event) }
        return MeetingRow(meeting: meeting, now: now, talk: talk,
                          recording: talk != nil && talk?.id == recorder.talkId,
                          isSelected: talk.map { $0.id == selectedTalkId } ?? false,
                          busy: starting == meeting.id,
                          canRecord: !recorder.isActive && starting == nil,
                          open: { if let talk { onOpen(talk.id) } else { onPick(meeting) } },
                          record: { join in record(meeting, join: join) })
    }

    private func record(_ meeting: Meeting, join: Bool) {
        starting = meeting.id
        Task {
            defer { starting = nil }
            do {
                onOpen(try await MeetingRecording.record(meeting, join: join))
            } catch {
                AppModel.shared.toasts.push(error.localizedDescription, tone: .error)
            }
        }
    }

    // MARK: - Connecting

    private var connectRow: some View {
        let denied = calendar.access == .denied
        return HStack(alignment: .top, spacing: 10) {
            Icon("calendar", size: 16).foregroundStyle(p.textSecondary)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(denied ? "Calendar access is off" : "See your meetings here")
                        .font(FN.font(13, .medium)).foregroundStyle(p.foreground)
                    Text(denied
                         ? "Turn on Calendar for Four Notes in System Settings to record a meeting with its name and who's invited."
                         : "Record one with its name and who's invited, and get a nudge a couple of minutes before it starts.")
                        .font(FN.font(13)).lineSpacing(2).foregroundStyle(p.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                SecondaryButton(title: denied ? "Open System Settings" : "Connect calendar", small: true) {
                    Task { await calendar.requestAccess() }
                }
                .fixedSize()
            }
            Spacer(minLength: 0)
            IconButton("x", size: 12, box: 22, help: "Not now") {
                withAnimation(Motion.standard) { connectDismissed = true }
            }
        }
        .padding(12)
        .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }
}

/// A meeting: when, what, who, and its buttons.
private struct MeetingRow: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let meeting: Meeting
    let now: Date
    let talk: Talk?
    let recording: Bool
    let isSelected: Bool
    let busy: Bool
    let canRecord: Bool
    let open: () -> Void
    /// True joins the call first.
    let record: (Bool) -> Void

    var body: some View {
        let on = meeting.isOn(at: now)
        let over = meeting.end <= now
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(MeetingRules.time.string(from: meeting.start))
                            .foregroundStyle(on ? p.accent : p.foreground)
                        Text(MeetingRules.time.string(from: meeting.end))
                            .foregroundStyle(p.textMuted)
                    }
                    .font(FN.small).monospacedDigit()
                    .frame(width: 62, alignment: .leading)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(meeting.title)
                            .font(FN.font(14, .medium))
                            .foregroundStyle(over && talk == nil ? p.textSecondary : p.foreground)
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            if recording {
                                RecordingDot(size: 6)
                                Text("Recording").foregroundStyle(p.danger)
                            } else if talk != nil {
                                Icon("check", size: 12).foregroundStyle(p.success)
                                Text("Recorded")
                            }
                            if !meeting.detail.isEmpty {
                                if recording || talk != nil { Text("·") }
                                Text(meeting.detail).lineLimit(1)
                            }
                        }
                        .font(FN.font(12))
                        .foregroundStyle(p.textMuted)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            .help(talk != nil ? "Open the talk" : "Record it, with its name and who's invited")

            if busy {
                ProgressView().controlSize(.small).frame(width: 30, height: 30)
            } else if talk == nil, !over {
                HStack(spacing: 4) {
                    if meeting.link != nil {
                        roundButton("arrowUpRight", help: "Join the \(meeting.link?.service ?? "call") and record it") { record(true) }
                    }
                    roundButton("mic", help: "Record it now") { record(false) }
                }
                .disabled(!canRecord)
                .opacity(canRecord ? 1 : 0.45)
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(isSelected ? p.accentSubtle : (hovering ? p.hover : (on ? p.surface : .clear)),
                    in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
        .opacity(over && talk == nil ? 0.7 : 1)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(meeting.title), \(MeetingRules.when(meeting, now: now))")
    }

    private func roundButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Icon(icon, size: 14)
                .foregroundStyle(p.accent)
                .frame(width: 30, height: 30)
                .background(p.surface, in: Circle())
                .overlay(Circle().strokeBorder(p.border, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.fn)
        .help(help)
        .accessibilityLabel(help)
    }
}

/// The line across the day where it's now.
private struct NowLine: View {
    @Environment(\.palette) private var p
    let now: Date

    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(p.accent.opacity(0.35)).frame(height: 1)
            HStack(spacing: 6) {
                Circle().fill(p.accent).frame(width: 6, height: 6)
                Text("Now · \(MeetingRules.time.string(from: now))").monospacedDigit()
            }
            .font(FN.font(12, .medium))
            .foregroundStyle(p.accent)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(p.accentSubtle, in: Capsule())
            .fixedSize()
            Rectangle().fill(p.accent.opacity(0.35)).frame(height: 1)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Now, \(MeetingRules.time.string(from: now))")
    }
}
