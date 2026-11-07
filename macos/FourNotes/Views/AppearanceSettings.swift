import SwiftUI

// Settings → Appearance, as on the web (src/components/AppearanceSection.tsx): the theme
// as four cards with a small preview each (System, Light, Paper, Dark), and the accent
// as six round swatches. The cards and swatches are also used in first-run setup.

/// Fixed colours on purpose: each card previews its theme whatever the current one is.
private struct MiniLook {
    let bg, edge, title, line: Color
    static let light = MiniLook(bg: .hex(0xFFFFFF), edge: .hex(0xECECEC), title: .hex(0x222222), line: .hex(0xD9D9D9))
    static let paper = MiniLook(bg: .hex(0xFBF6E8), edge: .hex(0xECE3CB), title: .hex(0x3A3326), line: .hex(0xE2D7BB))
    static let dark = MiniLook(bg: .hex(0x232323), edge: .hex(0x333333), title: .hex(0xF2F2F2), line: .hex(0x4A4A4A))
}

/// A page in miniature: a heading bar and one or two lines of text.
private struct Mini: View {
    let look: MiniLook
    var lines = 2

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width - 20
            VStack(alignment: .leading, spacing: 0) {
                RoundedRectangle(cornerRadius: 3).fill(look.title).frame(width: w / 2, height: 6)
                RoundedRectangle(cornerRadius: 2).fill(look.line).frame(width: w * 0.75, height: 4).padding(.top, 6)
                if lines == 2 {
                    RoundedRectangle(cornerRadius: 2).fill(look.line).frame(width: w * 0.6, height: 4).padding(.top, 4)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(look.bg)
    }
}

/// The four looks as radio cards, each with a small preview.
struct ThemeCards: View {
    @Environment(\.palette) private var p
    @AppStorage("fournotes.theme") private var themeRaw = ThemeChoice.system.rawValue
    var columns = 4

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), spacing: 12) {
            ForEach(ThemeChoice.allCases, id: \.self) { choice in
                ThemeCard(choice: choice, active: themeRaw == choice.rawValue) {
                    withAnimation(Motion.standard) { themeRaw = choice.rawValue }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Theme")
    }
}

private struct ThemeCard: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let choice: ThemeChoice
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                // Corners: 22 outside, 6 padding, so 16 inside.
                preview
                    .frame(height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(edge, lineWidth: 1))
                HStack(spacing: 6) {
                    Text(choice.label)
                        .font(FN.font(14, active ? .medium : .regular))
                        .foregroundStyle(p.foreground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if active { Icon("check", size: 16).foregroundStyle(p.accent) }
                }
                .frame(height: 21)
                .padding(.horizontal, 6)
            }
            .padding([.top, .horizontal], 6)
            .padding(.bottom, 10)
            .background(p.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(active ? p.accent : (hovering ? p.borderStrong : p.border), lineWidth: 1))
            .background(RoundedRectangle(cornerRadius: 25, style: .continuous)
                .fill(active ? p.accentSubtle : .clear)
                .padding(-3))
            .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .motion(hovering, Motion.quick)
            .motion(active, Motion.quick)
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .accessibilityLabel(choice.label)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    @ViewBuilder
    private var preview: some View {
        switch choice {
        case .system:
            HStack(spacing: 0) {
                Mini(look: .light, lines: 1)
                Mini(look: .dark, lines: 1)
            }
        case .light: Mini(look: .light)
        case .paper: Mini(look: .paper)
        case .dark: Mini(look: .dark)
        }
    }

    private var edge: Color {
        switch choice {
        case .system: return p.borderSubtle
        case .light: return MiniLook.light.edge
        case .paper: return MiniLook.paper.edge
        case .dark: return MiniLook.dark.edge
        }
    }
}

/// Six round swatches, one per accent, each in its hue as the current theme draws it;
/// "neutral" is the theme's own ink.
struct AccentSwatches: View {
    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @AppStorage("fournotes.theme") private var themeRaw = ThemeChoice.system.rawValue
    @AppStorage(AccentChoice.storageKey) private var accentRaw = AccentChoice.neutral.rawValue

    private func swatch(_ choice: AccentChoice) -> Color {
        let dark = scheme == .dark
        switch choice {
        case .neutral:
            return dark ? .hex(0xE4E4E4) : (themeRaw == ThemeChoice.paper.rawValue ? .hex(0x443428) : .hex(0x2E2E2E))
        case .blue: return dark ? .hex(0x6BA3FF) : .hex(0x0562EF)
        case .violet: return dark ? .hex(0xA78BFF) : .hex(0x7747FF)
        case .green: return dark ? .hex(0x53DCA6) : .hex(0x0DB879)
        case .coral: return dark ? .hex(0xFF9386) : .hex(0xF15F55)
        case .rose: return dark ? .hex(0xFF8BC5) : .hex(0xED4E9D)
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(AccentChoice.allCases, id: \.self) { choice in
                let on = accentRaw == choice.rawValue
                Button { withAnimation(Motion.standard) { accentRaw = choice.rawValue } } label: {
                    Circle()
                        .fill(swatch(choice))
                        .overlay(Circle().strokeBorder(Color.black.opacity(on ? 0 : 0.08), lineWidth: 1))
                        .frame(width: 28, height: 28)
                        // On: a 2pt gap in the surface, then a 2pt ring in ink.
                        .background(Circle().fill(on ? p.surface : .clear).frame(width: 32, height: 32))
                        .background(Circle().fill(on ? p.foreground : .clear).frame(width: 36, height: 36))
                        .frame(width: 32, height: 32)
                        .contentShape(Circle())
                }
                .buttonStyle(.fn)
                .help(choice.label)
                .accessibilityLabel(choice.label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}
