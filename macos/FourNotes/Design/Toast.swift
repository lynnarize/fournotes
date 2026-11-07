import SwiftUI

// Transient status messages, ported from the ToastProvider in ui.tsx.

struct Toast: Identifiable, Equatable {
    enum Tone { case ok, error }
    struct Action: Equatable {
        static func == (a: Action, b: Action) -> Bool { a.label == b.label }
        var label: String
        var run: () -> Void
    }
    let id = UUID()
    var text: String
    var tone: Tone = .ok
    var action: Action?
}

@MainActor
final class ToastCenter: ObservableObject {
    @Published private(set) var toasts: [Toast] = []

    func push(_ text: String, tone: Toast.Tone = .ok, action: Toast.Action? = nil) {
        let toast = Toast(text: text, tone: tone, action: action)
        toasts.append(toast)
        // An actionable toast stays long enough to be used.
        let life: TimeInterval = action != nil ? 8 : 4.5
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(life * 1_000_000_000))
            self?.dismiss(toast.id)
        }
    }

    func dismiss(_ id: Toast.ID) {
        toasts.removeAll { $0.id == id }
    }
}

struct ToastStack: View {
    @Environment(\.palette) private var p
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @EnvironmentObject private var toasts: ToastCenter

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(toasts.toasts) { toast in
                HStack(alignment: .top, spacing: 12) {
                    // As on the web: a small status mark instead of a coloured edge.
                    Icon(toast.tone == .error ? "warning" : "check", size: 18)
                        .foregroundStyle(toast.tone == .error ? p.danger : p.success)
                        .padding(.top, 1)
                    Text(toast.text)
                        .font(FN.body)
                        .lineSpacing(3)
                        .foregroundStyle(p.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 1)
                        .padding(.trailing, toast.action == nil ? 6 : 0)
                    if let action = toast.action {
                        // `.btn .btn-sm` on the muted surface.
                        Button {
                            action.run()
                            toasts.dismiss(toast.id)
                        } label: {
                            Text(action.label)
                                .font(FN.font(13, .medium))
                                .foregroundStyle(p.foreground)
                                .padding(.horizontal, 12)
                                .frame(height: 32)
                                .background(p.surfaceMuted, in: Capsule(style: .circular))
                                .contentShape(Capsule(style: .circular))
                        }
                        .buttonStyle(.fn)
                        .padding(.vertical, -4)
                    }
                }
                .padding(.leading, 16)
                .padding(.trailing, 10)
                .padding(.vertical, 10)
                .frame(maxWidth: 384, alignment: .leading)
                .floating(p, radius: 22)
                .transition(.offset(x: 18).combined(with: .opacity))
                .entrance()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .allowsHitTesting(!toasts.toasts.isEmpty)
        .animation(reduceMotion ? Motion.instant : Motion.standard, value: toasts.toasts)
    }
}
