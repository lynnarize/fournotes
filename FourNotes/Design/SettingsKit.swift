import SwiftUI

// Settings building blocks, after Arc, as on the web (src/components/SettingsSection.tsx):
// a section with its heading, and inside it bordered groups of rows. Each row has its
// label and description on the left and its control on the right, with a hairline
// between rows.

/// A section: its heading (and a line under it), then its groups.
struct SettingsSection<Content: View>: View {
    @Environment(\.palette) private var p
    let title: String
    var description: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(FN.font(22, .medium))
                    .tracking(-0.02 * 22)
                    .foregroundStyle(p.foreground)
                    .accessibilityAddTraits(.isHeader)
                if let description {
                    Text(description)
                        .font(FN.body)
                        .foregroundStyle(p.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One bordered group of rows, a hairline between them.
struct SettingsGroup<Content: View>: View {
    @Environment(\.palette) private var p
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content()) { rows in
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    row
                    if index < rows.count - 1 {
                        Rectangle().fill(p.borderSubtle).frame(height: 1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }
}

/// A setting: label and description on the left, the control on the right.
struct SettingsRow<Leading: View, Control: View>: View {
    @Environment(\.palette) private var p
    let label: String
    var description: String?
    @ViewBuilder var control: () -> Control
    /// A small tile (or a dot) before the label.
    @ViewBuilder var leading: () -> Leading

    /// The control is the trailing closure; a tile goes in `leading:`.
    init(_ label: String, description: String? = nil,
         @ViewBuilder control: @escaping () -> Control = { EmptyView() },
         @ViewBuilder leading: @escaping () -> Leading = { EmptyView() }) {
        self.label = label
        self.description = description
        self.leading = leading
        self.control = control
    }

    var body: some View {
        HStack(spacing: 16) {
            leading()
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(FN.body)
                    .foregroundStyle(p.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                if let description {
                    SettingsHint(description)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) { control() }
                .fixedSize()
        }
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 64)
    }
}

/// Free-form content inside a group (forms, explanations), with a row's edges.
struct SettingsBlock<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
    }
}

/// A row's description, or a hint in a block: 13pt muted text, leading-snug.
struct SettingsHint: View {
    @Environment(\.palette) private var p
    let text: String
    var tone: Color?
    init(_ text: String, tone: Color? = nil) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .font(FN.font(13))
            .lineSpacing(2)
            .foregroundStyle(tone ?? p.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The square tile before a row's label.
struct SettingsTile: View {
    @Environment(\.palette) private var p
    let icon: String

    var body: some View {
        Icon(icon, size: 18)
            .foregroundStyle(p.textSecondary)
            .frame(width: 40, height: 40)
            .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Switch

/// The kit's `.switch`: a 44×26 track with a round knob, on the accent when on.
struct FNSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        FNSwitch(configuration: configuration)
    }
}

private struct FNSwitch: View {
    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    let configuration: ToggleStyleConfiguration

    var body: some View {
        let on = configuration.isOn
        Button { withAnimation(Motion.standard) { configuration.isOn.toggle() } } label: {
            Capsule()
                .fill(on ? p.accent : p.controlTrack)
                .frame(width: 44, height: 26)
                .overlay(alignment: on ? .trailing : .leading) {
                    Circle()
                        .fill(on && scheme == .dark ? p.accentForeground : .white)
                        .shadow(color: .black.opacity(0.14), radius: 1, y: 1)
                        .shadow(color: .black.opacity(0.06), radius: 3, y: 2)
                        .overlay(Circle().strokeBorder(.black.opacity(0.07), lineWidth: 0.5))
                        .frame(width: 20, height: 20)
                        .padding(3)
                }
                .opacity(enabled ? 1 : 0.45)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }
        }
    }
}

extension ToggleStyle where Self == FNSwitchStyle {
    static var fnSwitch: FNSwitchStyle { FNSwitchStyle() }
}

// MARK: - Google

/// Google's "G" mark, per Google's sign-in branding guidelines.
struct GoogleG: View {
    var size: CGFloat = 18

    private static let parts: [(String, UInt32)] = [
        ("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z", 0xEA4335),
        ("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z", 0x4285F4),
        ("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z", 0xFBBC05),
        ("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z", 0x34A853),
    ]

    var body: some View {
        Canvas { context, canvas in
            for (d, color) in Self.parts {
                context.fill(SVGPath.path(from: d, in: CGRect(origin: .zero, size: canvas),
                                          viewBox: CGSize(width: 48, height: 48)),
                             with: .color(.hex(color)))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// "Continue with Google", in Google's sign-in branding: a neutral fill and the "G".
struct GoogleButton: View {
    @Environment(\.colorScheme) private var scheme
    @State private var hovering = false
    var label = "Continue with Google"
    var disabled = false
    let action: () -> Void

    var body: some View {
        let dark = scheme == .dark
        Button(action: action) {
            HStack(spacing: 10) {
                GoogleG()
                Text(label).font(FN.font(14, .medium))
            }
            .foregroundStyle(dark ? Color.hex(0xE3E3E3) : Color.hex(0x1F1F1F))
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .frame(height: 40)
            .background(dark ? (hovering ? Color.hex(0x202124) : Color.hex(0x131314))
                             : (hovering ? Color.hex(0xF2F2F2) : .white),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(dark ? Color.hex(0x8E918F) : Color.hex(0x747775), lineWidth: 1))
            .opacity(disabled ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .disabled(disabled)
        .onHover { hovering = $0 }
    }
}
