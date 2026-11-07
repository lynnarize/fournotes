import SwiftUI

// The spending chart, as on the web (TrendChart in src/components/finance/Dashboard.tsx).
// "line": a running total in the accent, with last month dashed and muted and today
// marked. "bars": one bar per day or month, with the average day dotted. Hover shows
// the values in a floating card. `values` may be shorter than `total`: the rest of the
// month hasn't happened yet.

struct TrendChart: View {
    enum Kind { case line, bars }

    @Environment(\.palette) private var p
    let kind: Kind
    let values: [Double]
    var previous: [Double]?
    let total: Int
    let currency: String
    /// The series' names in the card: this period, then the one it's set against.
    let names: [String]
    /// Today, on the running total.
    var marker: Int?
    /// The one bar in the accent; the others in the track colour.
    var highlight: Int?
    var average = false
    /// The card's caption for a point, e.g. "Today, Oct 22".
    let label: (Int) -> String
    let ticks: [(at: Int, text: String)]
    let summary: String

    @State private var hover: Int?
    @State private var width: CGFloat = 720

    private let padL: CGFloat = 2, padR: CGFloat = 46, padT: CGFloat = 14, padB: CGFloat = 26
    private var height: CGFloat { width < 480 ? 190 : 240 }

    var body: some View {
        let g = Geometry(chart: self)
        ZStack(alignment: .topLeading) {
            Canvas { context, _ in draw(context, g) }
            axisLabels(g)
            if let active = activeIndex, values.indices.contains(active) || prevAt(active) != nil {
                tooltip(active, g)
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = max(1, $0) }
        .contentShape(Rectangle())
        .onContinuousHover { phase in
            switch phase {
            case .active(let point): hover = g.index(at: point.x)
            case .ended: hover = nil
            }
        }
        .accessibilityElement()
        .accessibilityLabel(summary)
    }

    /// Today's values show without hovering where there's room.
    private var activeIndex: Int? { hover ?? (kind == .line && width >= 480 ? marker : nil) }

    private func prevAt(_ i: Int) -> Double? {
        guard let previous, previous.indices.contains(i) else { return nil }
        return previous[i]
    }

    private var avg: Double { values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count) }

    // MARK: - Geometry

    private struct Geometry {
        let x0, x1, y0, y1, slot, step, max: CGFloat
        let kind: Kind
        let total: Int
        let count: Int

        init(chart c: TrendChart) {
            x0 = c.padL
            x1 = c.width - c.padR
            y0 = c.padT
            y1 = c.height - c.padB
            total = c.total
            kind = c.kind
            count = Swift.max(c.values.count, c.previous?.count ?? 0)
            let top = Swift.max(1, (c.values + (c.previous ?? [])).max() ?? 1)
            step = CGFloat(TrendChart.niceStep(top * 1.08 / 4))
            max = step * 4
            slot = (x1 - x0) / CGFloat(Swift.max(1, c.total))
        }

        func x(_ i: Int) -> CGFloat {
            if kind == .bars { return x0 + slot * (CGFloat(i) + 0.5) }
            return total > 1 ? x0 + CGFloat(i) / CGFloat(total - 1) * (x1 - x0) : (x0 + x1) / 2
        }

        func y(_ v: Double) -> CGFloat { y1 - CGFloat(v) / max * (y1 - y0) }

        func index(at px: CGFloat) -> Int? {
            guard count > 0 else { return nil }
            let raw = kind == .bars
                ? Int(((px - x0) / slot).rounded(.down))
                : Int(((px - x0) / (x1 - x0) * CGFloat(total - 1)).rounded())
            return Swift.max(0, Swift.min(count - 1, raw))
        }
    }

    /// A round step for the axis: 1, 2, 2.5 or 5 times a power of ten.
    static func niceStep(_ raw: Double) -> Double {
        let power = pow(10, floor(log10(Swift.max(raw, 1e-9))))
        return [1, 2, 2.5, 5, 10].map { $0 * power }.first { $0 >= raw } ?? 10 * power
    }

    /// "100K", "1.5M": the axis's numbers.
    static func compact(_ v: Double) -> String {
        let units: [(Double, String)] = [(1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")]
        for (size, suffix) in units where abs(v) >= size {
            let n = v / size
            let text = n.rounded() == n ? String(Int(n)) : String(format: "%.1f", n)
            return text + suffix
        }
        return v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
    }

    // MARK: - Drawing

    private func path(_ v: [Double], _ g: Geometry) -> Path {
        var path = Path()
        for (i, value) in v.enumerated() {
            let point = CGPoint(x: g.x(i), y: g.y(value))
            if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }

    private func draw(_ context: GraphicsContext, _ g: Geometry) {
        // Hairline grid, and the baseline.
        for k in 1...4 {
            var line = Path()
            line.move(to: CGPoint(x: g.x0, y: g.y(Double(g.step) * Double(k))))
            line.addLine(to: CGPoint(x: g.x1, y: g.y(Double(g.step) * Double(k))))
            context.stroke(line, with: .color(p.borderSubtle), lineWidth: 1)
        }
        var base = Path()
        base.move(to: CGPoint(x: g.x0, y: g.y1))
        base.addLine(to: CGPoint(x: g.x1, y: g.y1))
        context.stroke(base, with: .color(p.border), lineWidth: 1)

        switch kind {
        case .line:
            if let previous, previous.count > 1 {
                context.stroke(path(previous, g), with: .color(p.borderStrong),
                               style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [4, 5]))
            }
            if values.count > 1 {
                var area = path(values, g)
                area.addLine(to: CGPoint(x: g.x(values.count - 1), y: g.y1))
                area.addLine(to: CGPoint(x: g.x(0), y: g.y1))
                area.closeSubpath()
                context.fill(area, with: .color(p.accent.opacity(0.07)))
                context.stroke(path(values, g), with: .color(p.accent),
                               style: StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
            }
            if let at = hover ?? marker {
                let current = values.indices.contains(at) ? values[at] : nil
                let before = prevAt(at)
                var rule = Path()
                rule.move(to: CGPoint(x: g.x(at), y: g.y(Swift.max(current ?? 0, before ?? 0))))
                rule.addLine(to: CGPoint(x: g.x(at), y: g.y1))
                context.stroke(rule, with: .color(p.borderStrong), lineWidth: 1)
                if let before {
                    context.fill(Path(ellipseIn: CGRect(x: g.x(at) - 3.5, y: g.y(before) - 3.5, width: 7, height: 7)),
                                 with: .color(p.borderStrong))
                }
                if let current {
                    let dot = Path(ellipseIn: CGRect(x: g.x(at) - 5, y: g.y(current) - 5, width: 10, height: 10))
                    context.fill(dot, with: .color(p.surface))
                    context.stroke(dot, with: .color(p.accent), lineWidth: 2.25)
                }
            }
        case .bars:
            let bw = Swift.min(28, Swift.max(3, g.slot * 0.62))
            for (i, v) in values.enumerated() {
                let h = Swift.max(v > 0 ? 2 : 0, g.y1 - g.y(v))
                let on = highlight == nil || highlight == i
                let rect = CGRect(x: g.x(i) - bw / 2, y: g.y1 - h, width: bw, height: h)
                context.fill(Path(roundedRect: rect, cornerRadius: Swift.min(4, bw / 2)),
                             with: .color((on ? p.accent : p.finRest).opacity(hover != nil && hover != i ? 0.45 : 1)))
            }
            if average, !values.isEmpty {
                var line = Path()
                line.move(to: CGPoint(x: g.x0, y: g.y(avg)))
                line.addLine(to: CGPoint(x: g.x1, y: g.y(avg)))
                context.stroke(line, with: .color(p.textMuted),
                               style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [2, 5]))
            }
        }
    }

    /// The axis numbers on the right, the ticks along the foot: 11pt muted, as `.fin-chart text`.
    private func axisLabels(_ g: Geometry) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<5, id: \.self) { k in
                // A zero-width frame at the point, the text hanging off its leading edge.
                Text(k == 0 ? "0" : Self.compact(Double(g.step) * Double(k)))
                    .fixedSize()
                    .frame(width: 0, height: 0, alignment: .leading)
                    .position(x: g.x1 + 10, y: g.y(Double(g.step) * Double(k)))
            }
            // Twelve months don't fit a narrow chart: every other one there.
            ForEach(Array(ticks.enumerated()).filter { !(total == 12 && width < 480 && $0.offset % 2 == 1) },
                    id: \.element.at) { _, tick in
                let leading = kind == .line && tick.at == 0
                Text(tick.text)
                    .fixedSize()
                    .frame(width: 0, height: 0, alignment: leading ? .leading : .center)
                    .position(x: g.x(tick.at), y: height - 10)
            }
        }
        .font(FN.font(11))
        .tracking(0)
        .monospacedDigit()
        .foregroundStyle(p.textMuted)
        .allowsHitTesting(false)
    }

    private func tooltip(_ i: Int, _ g: Geometry) -> some View {
        let left = g.x(i)
        let onRight = left > width - 230
        return VStack(alignment: .leading, spacing: 6) {
            Text(label(i)).foregroundStyle(p.textMuted)
            if values.indices.contains(i) {
                HStack(spacing: 8) {
                    Circle().fill(p.accent).frame(width: 8, height: 8)
                    Text(names.first ?? "").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    Text(Money.format(values[i], currency)).font(FN.font(12, .medium)).monospacedDigit()
                }
                .foregroundStyle(p.foreground)
            }
            if let before = prevAt(i) {
                HStack(spacing: 8) {
                    Circle().fill(p.borderStrong).frame(width: 8, height: 8)
                    Text(names.count > 1 ? names[1] : "").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    Text(Money.format(before, currency)).monospacedDigit()
                }
                .foregroundStyle(p.textSecondary)
            }
            if average {
                HStack(spacing: 8) {
                    Rectangle().fill(p.textMuted).frame(width: 8, height: 2)
                    Text("Average day").frame(maxWidth: .infinity, alignment: .leading)
                    Text(Money.format(avg, currency)).monospacedDigit()
                }
                .foregroundStyle(p.textSecondary)
            }
        }
        .font(FN.small)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: 196, alignment: .leading)
        .floating(p, radius: FN.radiusControl)
        .offset(x: onRight ? left - 12 - 196 : Swift.min(left + 12, width - 196))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
