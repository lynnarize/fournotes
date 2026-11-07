import AppKit
import SwiftUI

// Annual / tax report: month x category table, CSV for Excel, and a print view for PDF.
// Ported from src/components/ReportModal.tsx.

struct ReportView: View {
    @Environment(\.palette) private var p
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var toasts: ToastCenter

    @State private var year = String(Calendar.current.component(.year, from: Date()))

    private static let months = (1...12).map { String(format: "%02d", $0) }
    private static func monthName(_ m: String) -> String {
        MONTH_NAMES[(Int(m) ?? 1) - 1]
    }

    private var cur: String { store.settings.currency }
    private var live: [Transaction] { store.liveTransactions }

    private var years: [String] {
        var set = Set(live.map { String($0.date.prefix(4)) })
        set.insert(String(Calendar.current.component(.year, from: Date())))
        return set.sorted().reversed()
    }

    private struct ReportData {
        var txs: [Transaction] = []
        var grid: [String: [String: Double]] = [:]
        var income: [String: Double] = [:]
        var usedCats: [String] = []
        var catTotal: [String: Double] = [:]
        var monthSpend: [String: Double] = [:]
        var spent: Double = 0
        var earned: Double = 0
    }

    private var data: ReportData {
        var d = ReportData()
        d.txs = live.filter { $0.date.hasPrefix(year) }.sorted { $0.date < $1.date }
        let cats = store.categories.filter { $0 != "Income" }
        for m in Self.months { d.grid[m] = [:]; d.income[m] = 0 }
        for t in d.txs {
            let m = String(t.date.dropFirst(5).prefix(2))
            if t.amount < 0 {
                d.income[m, default: 0] += abs(Insights.baseAmount(t, cur))
            } else {
                d.grid[m, default: [:]][t.category, default: 0] += Insights.myShare(t, cur)
            }
        }
        d.usedCats = cats.filter { c in Self.months.contains { (d.grid[$0]?[c] ?? 0) != 0 } }
        for c in d.usedCats {
            d.catTotal[c] = Self.months.reduce(0) { $0 + (d.grid[$1]?[c] ?? 0) }
        }
        for m in Self.months {
            d.monthSpend[m] = (d.grid[m] ?? [:]).values.reduce(0, +)
        }
        d.spent = d.monthSpend.values.reduce(0, +)
        d.earned = d.income.values.reduce(0, +)
        return d
    }

    private var spaceName: String { store.spaceName ?? "Personal" }

    var body: some View {
        let data = data
        // The web Modal's wide size (max-w-3xl).
        SheetFrame(title: "Annual report", width: 768, maxHeight: 720) {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 8) {
                    SelectMenu(options: years.map { ($0, $0) }, selection: $year)
                        .fixedSize()

                    Spacer()

                    SecondaryButton(title: "Transactions (Excel CSV)", icon: "download", small: true) {
                        exportTransactions(data)
                    }
                    .disabled(data.txs.isEmpty)
                    SecondaryButton(title: "Summary (Excel CSV)", icon: "download", small: true) {
                        exportSummary(data)
                    }
                    .disabled(data.txs.isEmpty)
                    PrimaryButton(title: "Save as PDF", icon: "print", disabled: data.txs.isEmpty, small: true) {
                        exportPDF(data)
                    }
                }

                report(data)
                    .id(year)
                    .transition(.opacity.combined(with: .offset(y: 8)))
                    .animation(Motion.screen, value: year)
            }
        }
    }

    // MARK: - The report itself

    @ViewBuilder
    private func report(_ data: ReportData) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Four Notes, \(year) financial report")
                .font(FN.font(24, .medium))
                .tracking(-0.02 * 24)
                .foregroundStyle(p.text)
            Text("\(spaceName), amounts in \(cur), made \(generatedDate)")
                .font(FN.body)
                .foregroundStyle(p.muted)
                .padding(.top, 4)
                .padding(.bottom, 20)

            HStack(spacing: 0) {
                summaryTile("Spent (your share)", data.spent)
                Rectangle().fill(p.line).frame(width: 1)
                summaryTile("Income", data.earned)
                Rectangle().fill(p.line).frame(width: 1)
                summaryTile("Net", data.earned - data.spent)
            }
            .fixedSize(horizontal: false, vertical: true)
            .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.line, lineWidth: 1))
            .padding(.bottom, 20)

            table(data)

            Text("\(data.txs.count) transactions. Shares of split bills paid by others are left out of spending.")
                .font(FN.small)
                .foregroundStyle(p.faint)
                .padding(.top, 16)
        }
    }

    private var generatedDate: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateStyle = .medium
        return f.string(from: Date())
    }

    private func summaryTile(_ label: String, _ amount: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(FN.small).foregroundStyle(p.faint)
            Text(Money.format(amount, cur))
                .font(FN.font(18, .medium)).monospacedDigit()
                .foregroundStyle(p.text)
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func table(_ data: ReportData) -> some View {
        VStack(spacing: 0) {
            row(cells: ["Category"] + Self.months.map(Self.monthName) + ["Total"],
                bold: true, divider: true)
            ForEach(data.usedCats, id: \.self) { c in
                row(cells: [c] + Self.months.map { m in
                    let v = data.grid[m]?[c] ?? 0
                    return v != 0 ? Money.format(v, cur, compact: true) : ""
                } + [Money.format(data.catTotal[c] ?? 0, cur, compact: true)],
                    bold: false, divider: true)
            }
            row(cells: ["Total spent"] + Self.months.map { m in
                let v = data.monthSpend[m] ?? 0
                return v != 0 ? Money.format(v, cur, compact: true) : ""
            } + [Money.format(data.spent, cur, compact: true)],
                bold: true, divider: true)
            row(cells: ["Income"] + Self.months.map { m in
                let v = data.income[m] ?? 0
                return v != 0 ? Money.format(v, cur, compact: true) : ""
            } + [Money.format(data.earned, cur, compact: true)],
                bold: false, divider: false)
        }
    }

    private func row(cells: [String], bold: Bool, divider: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                    Text(cell)
                        .font(FN.font(12, bold ? .medium : .regular))
                        .monospacedDigit()
                        .foregroundStyle(p.text)
                        .frame(maxWidth: .infinity,
                               alignment: index == 0 ? .leading : .trailing)
                        .padding(.horizontal, 3)
                }
            }
            .padding(.vertical, 4)
            if divider { Divider().overlay(p.line) }
        }
    }

    // MARK: - Export

    /// CSV with a BOM so Excel opens UTF-8 (Rupiah signs, Indonesian names) correctly.
    private func csv(_ rows: [[String]]) -> String {
        func cell(_ s: String) -> String {
            s.rangeOfCharacter(from: CharacterSet(charactersIn: "\",\n;")) != nil
                ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
                : s
        }
        return "\u{FEFF}" + rows.map { $0.map(cell).joined(separator: ",") }.joined(separator: "\r\n")
    }

    private func save(_ name: String, _ contents: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = [.commaSeparatedText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try contents.write(to: url, atomically: true, encoding: .utf8)
            toasts.push("Saved \(url.lastPathComponent)")
        } catch {
            toasts.push("Could not save: \(error.localizedDescription)", tone: .error)
        }
    }

    private func exportTransactions(_ data: ReportData) {
        let header: [String] = [
            "Date", "Merchant", "Category", "Amount", "Currency", "FX rate",
            "Amount (\(cur))", "Your share (\(cur))", "Split with", "Items", "Source",
        ]
        var rows: [[String]] = [header]
        for t in data.txs {
            let rate: String = t.currency == cur ? "" : (t.fxRate.map { String($0) } ?? "")
            let base: Double = (Insights.baseAmount(t, cur) * 100).rounded() / 100
            let share: Double = (Insights.myShare(t, cur) * 100).rounded() / 100
            let splits: String = (t.splits ?? [])
                .map { split -> String in
                    let paid = split.settled ? " (paid)" : ""
                    return "\(split.name) \(split.amount)\(paid)"
                }
                .joined(separator: "; ")
            let items: String = t.items.map(\.name).joined(separator: "; ")
            let row: [String] = [
                t.date, t.merchant, t.category, String(t.amount), t.currency, rate,
                String(base), String(share), splits, items, t.source.rawValue,
            ]
            rows.append(row)
        }
        save("four-notes-transactions-\(year).csv", csv(rows))
    }

    private func exportSummary(_ data: ReportData) {
        func whole(_ v: Double) -> String { v.isFinite ? String(Int(safe: v.rounded())) : "" }
        let months = Self.months
        var rows: [[String]] = [["Category"] + months.map(Self.monthName) + ["Total"]]
        for c in data.usedCats {
            let cells: [String] = months.map { whole(data.grid[$0]?[c] ?? 0) }
            rows.append([c] + cells + [whole(data.catTotal[c] ?? 0)])
        }
        let spendCells: [String] = months.map { whole(data.monthSpend[$0] ?? 0) }
        rows.append(["Total spent"] + spendCells + [whole(data.spent)])
        let incomeCells: [String] = months.map { whole(data.income[$0] ?? 0) }
        rows.append(["Income"] + incomeCells + [whole(data.earned)])
        let netCells: [String] = months.map { whole((data.income[$0] ?? 0) - (data.monthSpend[$0] ?? 0)) }
        rows.append(["Net"] + netCells + [whole(data.earned - data.spent)])
        save("four-notes-summary-\(year).csv", csv(rows))
    }

    /// Renders the same report view into a PDF, the native stand-in for the web print view.
    private func exportPDF(_ data: ReportData) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "four-notes-report-\(year).pdf"
        panel.allowedContentTypes = [.pdf]
        guard panel.runModal() == .OK, let url = panel.url else { return }

        let page = CGRect(x: 0, y: 0, width: 842, height: 595)   // A4 landscape
        let content = report(data)
            .environment(\.palette, .light)
            .environmentObject(store)
            .padding(32)
            .frame(width: page.width)
            .background(Color.white)

        let renderer = ImageRenderer(content: content)
        renderer.proposedSize = ProposedViewSize(width: page.width, height: nil)

        var box = page
        guard let consumer = CGDataConsumer(url: url as CFURL),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil) else {
            toasts.push("Could not create the PDF.", tone: .error)
            return
        }
        renderer.render { size, draw in
            var mediaBox = CGRect(origin: .zero, size: CGSize(width: max(size.width, page.width),
                                                             height: max(size.height, 200)))
            context.beginPage(mediaBox: &mediaBox)
            draw(context)
            context.endPage()
            context.closePDF()
        }
        toasts.push("Saved \(url.lastPathComponent)")
    }
}
