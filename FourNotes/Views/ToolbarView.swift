import SwiftUI

// The toolbar on the frame, as on the web (src/components/Toolbar.tsx): the mark, the sidebar
// toggle and New beside the traffic lights, and the omnibar in the middle. The omnibar is the
// one way in: it searches, asks and captures (⌘K), and Scan and Record live inside it.

struct ToolbarView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var assistant: Assistant
    @Binding var sidebarOpen: Bool

    var body: some View {
        ZStack {
            HStack(spacing: 8) {
                // The traffic lights.
                Color.clear.frame(width: 70, height: 1)
                Logo(size: 30).padding(.trailing, 4)
                RoundFrameButton(icon: "sidebar", help: sidebarOpen ? "Hide sidebar" : "Show sidebar") {
                    sidebarOpen.toggle()
                }
                RoundFrameButton(icon: "compose", help: "New") { nav.present(.palette) }
                Spacer()
            }
            omnibar.frame(maxWidth: 600)
        }
        .padding(.horizontal, 16)
        .frame(height: 66)
        // The title bar is hidden, so the strip that dragged the window is this one.
        .background(WindowDragArea())
    }

    private var omnibar: some View {
        HStack(spacing: 10) {
            Button { nav.present(.palette) } label: {
                HStack(spacing: 10) {
                    Icon("search", size: 18)
                    Text("Search, ask or capture anything…").font(FN.font(15)).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            .accessibilityLabel("Search, ask or capture anything")

            OmniMini(icon: "scan", help: "Scan a receipt, note or e-wallet screenshot", disabled: assistant.busy != nil) {
                assistant.pickAndScan()
            }
            OmniMini(icon: assistant.recording ? "stop" : "mic",
                     help: assistant.recording ? "Stop recording" : "Record a voice note",
                     tone: assistant.recording ? p.spark : nil,
                     disabled: assistant.busy != nil && !assistant.recording) {
                assistant.recording ? assistant.stopRecording() : assistant.startRecording()
            }
            Text("⌘K")
                .font(FN.font(12, .semibold))
                .foregroundStyle(p.textSecondary)
                .padding(.horizontal, 7)
                .frame(height: 22)
                .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .padding(.trailing, 4)
        }
        .foregroundStyle(p.textSecondary)
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .frame(height: 42)
        .background(p.surface, in: Capsule(style: .circular))
    }
}

/// A 38pt round button on the frame.
private struct RoundFrameButton: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let icon: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(icon, size: 18)
                .foregroundStyle(p.foreground)
                .frame(width: 38, height: 38)
                .background(hovering ? p.surfaceMuted : p.surface, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .motion(hovering, Motion.quick)
        .help(help)
        .accessibilityLabel(help)
    }
}

/// A round button inside the omnibar.
private struct OmniMini: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let icon: String
    let help: String
    var tone: Color?
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(icon, size: 18)
                .foregroundStyle(tone ?? p.foreground)
                .frame(width: 30, height: 30)
                .background(hovering && !disabled ? p.surfaceMuted : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.fn)
        .disabled(disabled)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// Drags the window from the empty parts of the toolbar.
private struct WindowDragArea: View {
    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(WindowDragGesture())
            .allowsWindowActivationEvents(true)
    }
}
