import SwiftUI

// Finance overview, as on the web (src/components/finance/Dashboard.tsx): the month in
// four numbers (one bordered strip), a line on what stands out, the spending trend
// against last month beside the split by category, then budgets, payments coming up
// and split bills. Everything but the review is computed on the device.

/// Chart series, darkest first; the rest of the categories share the track colour.
func financeSeries(_ p: Palette) -> [Color] { Array(p.series.prefix(5)) }

/// The colour each category takes this month: by rank, the same in the donut and the table.
func categoryColors(_ byCat: [(String, Double)], _ p: Palette) -> [String: Color] {
    let series = financeSeries(p)
    return Dictionary(byCat.enumerated().map { i, entry in (entry.0, i < series.count ? series[i] : p.finRest) },
                      uniquingKeysWith: { a, _ in a })
}

struct FinanceDashboard: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var toasts: ToastCenter

    let month: String
    let summary: MonthlySummary?
    let summarizing: Bool
    let onSummarize: () -> Void
    let onBudgets: () -> Void
    let onOpenTransactions: () -> Void
    let onOpenTransaction: (String) -> Void
    let onAddIncome: () -> Void

    @AppStorage("fournotes.financeChart") private var view = "running"
    @AppStorage("fournotes.financeDismissed") private var dismissedRaw = ""
    @State private var reviewOpen = false
    @State private var gridWidth: CGFloat = 900

    private var cur: String { store.settings.currency }
    private var live: [Transaction] { store.liveTransactions }
    private var today: String { DateKit.localDate() }
    private var isCurrent: Bool { month == DateKit.localMonth() }
    private var year: Int { Int(month.prefix(4)) ?? 2026 }
    private var monthNumber: Int { Int(month.suffix(2)) ?? 1 }

    private var days: Int { Self.daysIn(month) }
    private var dayOfMonth: Int { isCurrent ? Calendar.current.component(.day, from: Date()) : days }
    private var lastMonth: String { FinanceMath.shiftMonth(month, by: -1) }
    private var monthName: String { Self.monthName(month) }
    private var lastMonthName: String { Self.monthName(lastMonth) }

    private var monthTxs: [Transaction] { live.filter { $0.date.hasPrefix(month) } }
    private var lastMonthTxs: [Transaction] { live.filter { $0.date.hasPrefix(lastMonth) } }
    /// Compare like with like: this month so far against the same days of last month.
    private var prevTxs: [Transaction] { lastMonthTxs.filter { (Int($0.date.suffix(2)) ?? 99) <= dayOfMonth } }

    static func daysIn(_ month: String) -> Int {
        guard let start = DateKit.startOfMonth(month),
              let range = Calendar.current.range(of: .day, in: .month, for: start) else { return 30 }
        return range.count
    }

    /// "October".
    static func monthName(_ month: String) -> String {
        Fmt.monthYear(month).components(separatedBy: " ").first ?? month
    }

    private static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

    /// Spending (your share) on each day of a month.
    private func perDay(_ txs: [Transaction], _ n: Int) -> [Double] {
        var out = [Double](repeating: 0, count: n)
        for t in txs where t.amount > 0 {
            let day = (Int(t.date.suffix(2)) ?? 1) - 1
            if out.indices.contains(day) { out[day] += Insights.myShare(t, cur) }
        }
        return out
    }

    private func running(_ v: [Double]) -> [Double] {
        var sum = 0.0
        return v.map { sum += $0; return sum }
    }

    var body: some View {
        let spent = FinanceMath.spend(monthTxs, cur)
        VStack(alignment: .leading, spacing: 24) {
            kpis(spent)
            review
                .padding(.top, -4)
            HStack(alignment: .top, spacing: 16) {
                trendCard(spent)
                    .frame(maxWidth: .infinity)
                categoryCard(spent)
                    .frame(width: 320)
            }
            .fixedSize(horizontal: false, vertical: true)
            cardsGrid
        }
    }

    // MARK: - The month in four numbers

    private func kpis(_ spent: Double) -> some View {
        let prevSpent = FinanceMath.spend(prevTxs, cur)
        let income = FinanceMath.income(monthTxs, cur)
        // Today's pace: the budget left spread over the days left, or your usual day.
        let budgetTotal = store.settings.budgets.values.reduce(0, +)
        let spentToday = FinanceMath.spend(live.filter { $0.date == today }, cur)
        let before = FinanceMath.spend(monthTxs.filter { $0.date < today }, cur)
        let daysLeft = days - dayOfMonth + 1
        let allowance = budgetTotal > 0
            ? max(0, (budgetTotal - before) / Double(daysLeft))
            : before / Double(max(1, dayOfMonth - 1))
        let left = allowance - spentToday
        let hasPace = allowance > 0 || budgetTotal > 0
        let openThisMonth = monthTxs.filter { ($0.splits ?? []).contains { !$0.settled } }.count

        return HStack(spacing: 0) {
            kpi(isCurrent ? "Spent so far" : "Spent", Money.format(spent, cur)) {
                let text = deltaText(spent, prevSpent)
                if !text.isEmpty {
                    HStack(alignment: .top, spacing: 4) {
                        if prevSpent > 0 {
                            Icon("arrowUpRight", size: 14).rotationEffect(.degrees(spent < prevSpent ? 90 : 0))
                        }
                        Text(text)
                    }
                }
            }
            divider
            if isCurrent {
                if hasPace {
                    kpi("Left for today", Money.format(max(0, left), cur)) {
                        if left >= 0 {
                            Text("Of a \(Money.format(allowance, cur)) daily pace")
                        } else {
                            Text("\(Money.format(-left, cur)) over today's pace").foregroundStyle(p.danger)
                        }
                    }
                } else {
                    kpi("Spent today", Money.format(spentToday, cur)) {
                        InlineLink(title: "Set a budget for a daily pace", action: onBudgets)
                    }
                }
            } else {
                kpi("Daily average", Money.format(spent / Double(max(1, dayOfMonth)), cur)) {
                    Text("Over \(Self.plural(dayOfMonth, "day"))")
                }
            }
            divider
            kpi("Income", Money.format(income, cur)) {
                if income == 0 {
                    InlineLink(title: "Add income to see what you save", action: onAddIncome)
                } else if income >= spent {
                    Text("You kept \(Money.format(income - spent, cur))")
                } else {
                    Text("\(Money.format(spent - income, cur)) more out than in")
                }
            }
            divider
            kpi("Transactions", "\(monthTxs.count)") {
                if openThisMonth > 0 {
                    Button("\(Self.plural(openThisMonth, "split bill")) still open", action: onOpenTransactions)
                        .buttonStyle(.fn)
                } else if !prevTxs.isEmpty {
                    Text("\(prevTxs.count) by \(isCurrent ? "this point in " : "")\(lastMonthName)")
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(monthName) in numbers")
    }

    private var divider: some View { Rectangle().fill(p.borderSubtle).frame(width: 1) }

    private func deltaText(_ spent: Double, _ prevSpent: Double) -> String {
        let than = isCurrent ? "this point in \(lastMonthName)" : lastMonthName
        guard let pct = FinanceMath.pct(spent, prevSpent) else {
            return spent > 0 ? "Nothing logged by \(than)" : ""
        }
        if abs(pct) < 0.005 { return "The same as \(than)" }
        let n = abs(pct * 100)
        return "\(n >= 10 ? String(Int(n.rounded())) : String(format: "%.1f", n))% \(pct > 0 ? "more" : "less") than \(than)"
    }

    /// One number in the strip.
    private func kpi<Sub: View>(_ label: String, _ value: String, @ViewBuilder sub: () -> Sub) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(FN.font(13)).foregroundStyle(p.textSecondary).lineLimit(1)
            Text(value)
                .font(FN.display(28))
                .tracking(FN.displayTracking(28))
                .monospacedDigit()
                .foregroundStyle(p.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
                .padding(.vertical, 1)
            sub()
                .font(FN.small)
                .foregroundStyle(p.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - The review: one line here, the rest on request

    private var reviewLines: [BriefText.Line] {
        guard let text = summary?.text else { return [] }
        return BriefText.lines(text, currency: cur).filter { $0.label?.lowercased() != "total" }
    }

    private static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "\\*\\*(.+?)\\*\\*", with: "$1", options: .regularExpression)
    }

    private var review: some View {
        let lines = reviewLines
        let lead = lines.first {
            ($0.label ?? "").range(of: "unusual|watch|notable|alert|insight", options: [.regularExpression, .caseInsensitive]) != nil
        } ?? lines.first
        let spentToday = FinanceMath.spend(live.filter { $0.date == today }, cur)
        let usualDay = FinanceMath.spend(monthTxs.filter { $0.date < today }, cur) / Double(max(1, dayOfMonth - 1))
        let spike = isCurrent && usualDay > 0 && spentToday > usualDay * 2 && !dismissed.contains("\(month):spike:\(today)")

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Icon("sparkle", size: 16).foregroundStyle(p.accent)
                Group {
                    if let lead {
                        Text(lead.label.map { "\($0): \(Self.clean(lead.body))" } ?? Self.clean(lead.body))
                    } else if summarizing {
                        Text("Reading this month's spending…")
                    } else if !monthTxs.isEmpty {
                        Text("A short review of the month, with a tip, is written here as you spend.")
                    } else {
                        Text("Log some spending first; the review is written from it.")
                    }
                }
                .font(FN.font(16))
                .foregroundStyle(p.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                if lines.count > 1 {
                    KitButton(kind: .plain, title: reviewOpen ? "Hide the review" : "Read the review", small: true) {
                        withAnimation(Motion.standard) { reviewOpen.toggle() }
                    }
                }
                if !monthTxs.isEmpty {
                    PlainForegroundButton(title: summarizing ? "Writing…"
                                          : summary != nil ? "Refresh the review" : "Write the \(monthName) review",
                                          action: onSummarize)
                        .disabled(summarizing)
                }
            }
            if reviewOpen && lines.count > 1 {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(lines) { line in
                        HStack(alignment: .top, spacing: 12) {
                            Icon(BriefText.icon(for: line.label ?? line.body), size: 16)
                                .foregroundStyle(p.textSecondary)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 0) {
                                if let label = line.label {
                                    Text(label).font(FN.small).foregroundStyle(p.textMuted)
                                }
                                Text(Self.clean(line.body))
                                    .font(FN.body)
                                    .lineSpacing(2)
                                    .foregroundStyle(p.foreground)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                .transition(.opacity.combined(with: .offset(y: 8)))
            }
            if spike {
                HStack(spacing: 10) {
                    Icon("warning", size: 16).foregroundStyle(p.warning)
                    Text("Spending spike today: \(Text(Money.format(spentToday, cur)).foregroundStyle(p.foreground)), against a usual day of \(Money.format(usualDay, cur)).")
                        .font(FN.font(16))
                        .monospacedDigit()
                        .foregroundStyle(p.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    KitButton(kind: .plain, title: "See transactions", small: true, action: onOpenTransactions)
                    IconButton("x", size: 15, box: 32, help: "Dismiss for this month") { dismiss("spike:\(today)") }
                }
            }
        }
    }

    private var dismissed: [String] {
        dismissedRaw.components(separatedBy: "\u{1F}").filter { !$0.isEmpty }
    }

    private func dismiss(_ id: String) {
        var next = dismissed + ["\(month):\(id)"]
        if next.count > 100 { next = Array(next.suffix(100)) }
        dismissedRaw = next.joined(separator: "\u{1F}")
    }

    // MARK: - The trend

    private func ticks() -> [(at: Int, text: String)] {
        [1, 8, 15, 22, 29].filter { $0 <= days }.map { (at: $0 - 1, text: "\(MONTH_NAMES[monthNumber - 1]) \($0)") }
    }

    private func trendCard(_ spent: Double) -> some View {
        let daily = Array(perDay(monthTxs, days).prefix(dayOfMonth))
        let prevDaily = Array(perDay(lastMonthTxs, Self.daysIn(lastMonth)).prefix(days))
        let prevSpent = FinanceMath.spend(prevTxs, cur)
        let title = view == "year" ? "Spending in \(year)" : isCurrent ? "Spending this month" : "Spending in \(monthName)"
        let short = MONTH_NAMES[monthNumber - 1]

        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text(title).font(FN.font(16, .medium)).foregroundStyle(p.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ChartSwitch(selection: $view)
            }
            Group {
                switch view {
                case "daily":
                    VStack(alignment: .leading, spacing: 16) {
                        Legend(items: [("Spent that day", .bar), ("Average day", .dotted)])
                        TrendChart(kind: .bars, values: daily, total: days, currency: cur, names: [monthName],
                                   average: true,
                                   label: { "\(short) \($0 + 1)" },
                                   ticks: ticks(),
                                   summary: "Spending per day in \(monthName), \(Money.format(daily.isEmpty ? 0 : spent / Double(daily.count), cur)) on an average day.")
                    }
                case "year":
                    yearView
                default:
                    VStack(alignment: .leading, spacing: 16) {
                        Legend(items: [(monthName, .line), (lastMonthName, .dashed)])
                        TrendChart(kind: .line, values: running(daily), previous: running(prevDaily), total: days,
                                   currency: cur, names: [monthName, lastMonthName],
                                   marker: isCurrent ? dayOfMonth - 1 : nil,
                                   label: { "\(isCurrent && $0 == dayOfMonth - 1 ? "Today, " : "")\(short) \($0 + 1)" },
                                   ticks: ticks(),
                                   summary: "Running total for \(monthName) reaches \(Money.format(spent, cur))"
                                       + (prevSpent > 0 || spent > 0 ? ", against \(Money.format(prevSpent, cur)) at the same point in \(lastMonthName)." : "."))
                    }
                }
            }
            .id(view)
            .transition(.opacity)
        }
        .padding(24)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
        .animation(Motion.standard, value: view)
    }

    private var yearView: some View {
        var yearly = [Double](repeating: 0, count: 12)
        for t in live where t.amount > 0 && t.date.hasPrefix(String(year)) {
            let m = (Int(t.date.dropFirst(5).prefix(2)) ?? 1) - 1
            if yearly.indices.contains(m) { yearly[m] += Insights.myShare(t, cur) }
        }
        let yearToDate = yearly.prefix(monthNumber).reduce(0, +)
        let cutoff = String(format: "%02d", monthNumber)
        let lastYear = FinanceMath.spend(live.filter {
            $0.date.hasPrefix(String(year - 1)) && $0.date.dropFirst(5).prefix(2) <= cutoff
        }, cur)
        let shown = year == Calendar.current.component(.year, from: Date())
            ? Calendar.current.component(.month, from: Date()) : 12
        var versus = ""
        if lastYear > 0, let pct = FinanceMath.pct(yearToDate, lastYear) {
            versus = ", \(Int((abs(pct) * 100).rounded()))% \(pct >= 0 ? "more" : "less") than by then in \(year - 1)"
        }
        return VStack(alignment: .leading, spacing: 16) {
            Text("\(Text(Money.format(yearToDate, cur)).foregroundStyle(p.foreground)) by the end of \(monthName)\(versus)")
                .font(FN.font(13))
                .monospacedDigit()
                .foregroundStyle(p.textSecondary)
            TrendChart(kind: .bars, values: Array(yearly.prefix(shown)), total: 12, currency: cur, names: [String(year)],
                       highlight: monthNumber - 1,
                       label: { "\(MONTH_NAMES[$0]) \(year)" },
                       ticks: MONTH_NAMES.enumerated().map { (at: $0.offset, text: $0.element) },
                       summary: "Spending per month in \(year), \(Money.format(yearToDate, cur)) by the end of \(monthName).")
        }
    }

    // MARK: - By category

    private func categoryCard(_ spent: Double) -> some View {
        let byCat = Insights.spendByCategory(monthTxs, cur).filter { $0.value > 0 }
            .sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
        return VStack(alignment: .leading, spacing: 16) {
            Text("By category").font(FN.font(16, .medium)).foregroundStyle(p.foreground)
            if byCat.isEmpty {
                Text("No spending this month.")
                    .font(FN.body).foregroundStyle(p.textMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else {
                CategoryDonut(byCat: byCat, total: spent, currency: cur)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    // MARK: - Budgets, upcoming payments, split bills

    /// Three cards side by side, each at least 300pt; fewer to a row when they don't fit.
    private var cardsGrid: some View {
        let columns = max(1, min(3, Int((gridWidth + 16) / (300 + 16))))
        let cards: [AnyView] = [AnyView(budgetsCard), AnyView(upcomingCard), AnyView(splitsCard)]
        let rows = stride(from: 0, to: cards.count, by: columns).map { Array(cards[$0..<min($0 + columns, cards.count)]) }
        return VStack(spacing: 16) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(alignment: .top, spacing: 16) {
                    ForEach(rows[r].indices, id: \.self) { c in
                        rows[r][c].frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    }
                    ForEach(0..<(columns - rows[r].count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
    }

    private func card<Content: View>(_ padding: EdgeInsets, spacing: CGFloat, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: spacing) { content() }
            .padding(padding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    private func cardTitle(_ title: String) -> some View {
        Text(title).font(FN.font(16, .medium)).foregroundStyle(p.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var budgetsCard: some View {
        let budgets = Insights.budgetStatus(monthTxs, store.settings)
        let daysLeft = days - dayOfMonth + 1
        return card(EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24), spacing: 18) {
            HStack {
                cardTitle("Budgets")
                if !budgets.isEmpty {
                    KitButton(kind: .plain, title: "Edit", small: true, action: onBudgets).padding(.trailing, -8)
                }
            }
            if budgets.isEmpty {
                Text("No budgets yet. Give a category a monthly limit and see how it's going here.")
                    .font(FN.body).foregroundStyle(p.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(budgets, id: \.category) { b in
                let tone: Color? = b.ratio >= 1 ? p.danger : b.ratio >= 0.8 ? p.warning : nil
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(b.category).font(FN.font(16)).foregroundStyle(p.foreground).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(Money.format(b.spent, cur)) \(Text("of \(b.limit.formatted(.number))").foregroundStyle(p.textMuted))")
                            .font(FN.font(13)).monospacedDigit()
                            .foregroundStyle(p.textSecondary)
                    }
                    ProgressBar(ratio: min(1, b.ratio), tone: tone ?? p.accent)
                        .accessibilityLabel("\(b.category) budget used")
                    Text(b.ratio >= 1 ? "\(Money.format(b.spent - b.limit, cur)) over budget"
                         : "\(tone != nil ? "Almost used, " : "")\(Money.format(b.limit - b.spent, cur)) left\(isCurrent ? ", \(Self.plural(daysLeft, "day")) to go" : "")")
                        .font(FN.small).monospacedDigit()
                        .foregroundStyle(tone ?? p.textMuted)
                }
            }
            Spacer(minLength: 0)
            KitButton(kind: .plain, title: "Add a budget", icon: "plus", small: true, action: onBudgets)
                .padding(.leading, -8)
        }
    }

    private var upcomingCard: some View {
        let upcoming = Glance.upcoming(todos: store.liveTodos, transactions: live, currency: cur)
        let total: Double? = upcoming.allSatisfy { $0.currency == cur } ? upcoming.reduce(0) { $0 + $1.amount } : nil
        return card(EdgeInsets(top: 24, leading: 16, bottom: 16, trailing: 16), spacing: 8) {
            HStack {
                cardTitle("Upcoming payments")
                if let total, !upcoming.isEmpty {
                    Text(Money.format(total, cur)).font(FN.font(13)).monospacedDigit().foregroundStyle(p.textMuted)
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
            if upcoming.isEmpty {
                Text("No bills due soon. Repeating bills you add to To-Do show up here.")
                    .font(FN.body).foregroundStyle(p.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
            }
            VStack(spacing: 0) {
                ForEach(Array(upcoming.enumerated()), id: \.element.id) { i, item in
                    if i > 0 { Rectangle().fill(p.borderSubtle).frame(height: 1) }
                    paymentRow(item)
                }
            }
        }
    }

    private func paymentRow(_ item: Glance.Payment) -> some View {
        let n = FinanceMath.daysFromToday(item.date)
        let date = DateKit.date(item.date) ?? Date()
        let sub = item.subscription != nil ? "Looks like a subscription" : item.sub == "Bill" ? "Bill" : "Repeating bill"
        return HStack(spacing: 12) {
            VStack(spacing: 0) {
                Text(MONTH_NAMES[Calendar.current.component(.month, from: date) - 1])
                    .font(FN.font(11)).foregroundStyle(p.textMuted)
                Text("\(Calendar.current.component(.day, from: date))")
                    .font(FN.font(18, .medium)).monospacedDigit().foregroundStyle(p.foreground)
            }
            .frame(width: 44)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title.isEmpty ? "Untitled bill" : item.title).font(FN.font(16)).foregroundStyle(p.foreground).lineLimit(1)
                Text("\(sub), \(Money.format(item.amount, item.currency))")
                    .font(FN.small).monospacedDigit().foregroundStyle(p.textMuted).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let subscription = item.subscription {
                SecondaryButton(title: "Track", small: true) {
                    if store.trackSubscription(subscription) { toasts.push("🔁 Monthly bill added: \(subscription.merchant)") }
                }
            } else {
                if n < 0 {
                    StatusPill(text: n == -1 ? "1 day late" : "\(-n) days late", tone: .bad)
                } else if n <= 3 {
                    StatusPill(text: n == 0 ? "Today" : n == 1 ? "Tomorrow" : "In \(n) days", tone: .warn)
                } else {
                    Text("In \(n) days").font(FN.small).monospacedDigit().foregroundStyle(p.textMuted).fixedSize()
                }
                if let todoId = item.todoId {
                    // A button, not a Toggle bound to a constant: SwiftUI set that
                    // Toggle by itself when the list redrew, and paid a bill with no
                    // click at all.
                    IconButton("check", size: 16, box: 32, help: "Mark as paid") {
                        let extra = store.toggleTodo(todoId, done: true)
                        toasts.push((["Paid: \(item.title)"] + extra).joined(separator: "\n"))
                    }
                    .padding(.trailing, -4)
                    .accessibilityLabel("Mark \(item.title) as paid")
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 10)
    }

    private var splitsCard: some View {
        let openSplits = live.filter { ($0.splits ?? []).contains { !$0.settled } }.sorted { $0.date > $1.date }
        let owed = Insights.owedToMe(live, cur).reduce(0) { $0 + $1.amount }
        return card(EdgeInsets(top: 24, leading: 16, bottom: 16, trailing: 16), spacing: 8) {
            HStack {
                cardTitle("Split bills")
                if owed > 0 {
                    Text("\(Money.format(owed, cur)) owed to you").font(FN.font(13)).monospacedDigit().foregroundStyle(p.textMuted)
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
            if openSplits.isEmpty {
                Text("Nobody owes you. Open a transaction below to split it.")
                    .font(FN.body).foregroundStyle(p.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
            }
            ForEach(openSplits.prefix(3)) { tx in
                let people = tx.splits?.count ?? 0
                VStack(alignment: .leading, spacing: 0) {
                    Button("\(tx.merchant), \(FinanceMath.shortDate(tx.date)), \(Money.format(tx.amount, tx.currency)) split with \(people) \(people == 1 ? "person" : "people")") {
                        onOpenTransaction(tx.id)
                    }
                    .buttonStyle(.fn)
                    .font(FN.small)
                    .monospacedDigit()
                    .foregroundStyle(p.textMuted)
                    .padding(.horizontal, 8)
                    ForEach(Array((tx.splits ?? []).enumerated()), id: \.offset) { j, s in
                        if j > 0 { Rectangle().fill(p.borderSubtle).frame(height: 1) }
                        splitRow(tx, j, s)
                    }
                }
            }
            if openSplits.count > 3 {
                Text("\(openSplits.count - 3) more open below, in Transactions")
                    .font(FN.small).foregroundStyle(p.textMuted)
                    .padding(.horizontal, 8)
            }
        }
    }

    private func splitRow(_ tx: Transaction, _ j: Int, _ s: Split) -> some View {
        HStack(spacing: 12) {
            Text(s.name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "?")
                .font(FN.font(13, .medium))
                .foregroundStyle(p.foreground)
                .frame(width: 32, height: 32)
                .background(p.surfaceMuted, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.name).font(FN.font(16)).foregroundStyle(p.foreground).lineLimit(1)
                Text("\(s.settled ? "Paid" : "Owes you") \(Money.format(s.amount, tx.currency))")
                    .font(FN.small).monospacedDigit().foregroundStyle(p.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if s.settled {
                HStack(spacing: 4) { Icon("check", size: 14); Text("Settled") }
                    .font(FN.font(13)).foregroundStyle(p.success)
            } else {
                SecondaryButton(title: "Mark settled", small: true) { settle(tx, j) }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 10)
    }

    private func settle(_ tx: Transaction, _ j: Int) {
        let before = tx.splits
        store.updateTransaction(tx.id) { t in
            guard var splits = t.splits, splits.indices.contains(j) else { return }
            splits[j].settled = true
            t.splits = splits
        }
        let name = before.flatMap { $0.indices.contains(j) ? $0[j].name : nil } ?? "They"
        toasts.push("\(name) settled up", action: Toast.Action(label: "Undo") { [store] in
            store.updateTransaction(tx.id) { $0.splits = before }
        })
    }
}

// MARK: - Pieces

/// An underlined link in a number's line: "Add income to see what you save".
private struct InlineLink: View {
    @Environment(\.palette) private var p
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).underline(color: p.borderStrong).foregroundStyle(p.foreground).multilineTextAlignment(.leading)
        }
        .buttonStyle(.fn)
    }
}

/// `.btn-plain .btn-sm` in the foreground colour: "Refresh the review".
private struct PlainForegroundButton: View {
    @Environment(\.palette) private var p
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(FN.font(13))
                .foregroundStyle(p.foreground)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(hovering && enabled ? p.hover : .clear, in: Capsule())
                .opacity(enabled ? 1 : 0.45)
                .contentShape(Capsule())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .fixedSize()
    }
}

/// The chart's small segmented control: 26pt segments, 12pt text.
private struct ChartSwitch: View {
    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 2) {
            ForEach([("running", "Running total"), ("daily", "Per day"), ("year", "Year")], id: \.0) { id, text in
                let on = selection == id
                Button { selection = id } label: {
                    Text(text)
                        .font(FN.font(12, on ? .medium : .regular))
                        .foregroundStyle(on ? p.foreground : p.textSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 26)
                        .background {
                            if on {
                                Capsule().fill(scheme == .dark ? p.surfaceRaised : p.surface)
                                    .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.fn)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(p.surfaceMuted, in: Capsule())
        .fixedSize()
    }
}

private struct Legend: View {
    enum Kind { case line, dashed, bar, dotted }
    @Environment(\.palette) private var p
    let items: [(String, Kind)]

    var body: some View {
        HStack(spacing: 20) {
            ForEach(items, id: \.0) { label, kind in
                HStack(spacing: 8) {
                    switch kind {
                    case .line: Capsule().fill(p.accent).frame(width: 14, height: 2)
                    case .dashed: rule(p.borderStrong, dash: [3, 2])
                    case .bar: RoundedRectangle(cornerRadius: 2).fill(p.accent).frame(width: 8, height: 10)
                    case .dotted: rule(p.textMuted, dash: [2, 2])
                    }
                    Text(label)
                }
            }
        }
        .font(FN.small)
        .foregroundStyle(p.textSecondary)
    }

    private func rule(_ color: Color, dash: [CGFloat]) -> some View {
        Path { $0.move(to: CGPoint(x: 0, y: 1)); $0.addLine(to: CGPoint(x: 14, y: 1)) }
            .stroke(color, style: StrokeStyle(lineWidth: 2, dash: dash))
            .frame(width: 14, height: 2)
    }
}

/// The donut: the top five categories in the series colours, the rest together as "Other".
private struct CategoryDonut: View {
    @Environment(\.palette) private var p
    let byCat: [(String, Double)]
    let total: Double
    let currency: String

    private struct Part {
        let name: String
        let value: Double
        let color: Color
    }

    var body: some View {
        let sum = max(1, byCat.reduce(0) { $0 + $1.1 })
        let series = financeSeries(p)
        let rest = byCat.dropFirst(5).reduce(0) { $0 + $1.1 }
        let parts = byCat.prefix(5).enumerated().map { Part(name: $0.element.0, value: $0.element.1, color: series[$0.offset]) }
            + (rest > 0 ? [Part(name: "Other", value: rest, color: p.finRest)] : [])
        let share = { (v: Double) in Int((v / sum * 100).rounded()) }

        VStack(alignment: .leading, spacing: 16) {
            ZStack {
                Canvas { context, size in
                    let r: CGFloat = 60
                    let circumference = 2 * .pi * r
                    let gap: CGFloat = parts.count > 1 ? 3 : 0
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    var offset: CGFloat = 0
                    for part in parts {
                        let length = CGFloat(part.value / sum) * circumference
                        let drawn = max(0.5, length - gap)
                        var arc = Path()
                        arc.addArc(center: center, radius: r,
                                   startAngle: .radians(Double(offset / r) - .pi / 2),
                                   endAngle: .radians(Double((offset + drawn) / r) - .pi / 2),
                                   clockwise: false)
                        context.stroke(arc, with: .color(part.color), lineWidth: 18)
                        offset += length
                    }
                }
                VStack(spacing: 2) {
                    Text("Spent").font(FN.small).foregroundStyle(p.textMuted)
                    Text(Money.format(total, currency))
                        .font(FN.font(16, .medium)).monospacedDigit().foregroundStyle(p.foreground)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: 110)
                }
            }
            .frame(width: 168, height: 168)
            .frame(maxWidth: .infinity)
            .accessibilityElement()
            .accessibilityLabel(parts.map { "\($0.name) \(share($0.value)) percent" }.joined(separator: ", "))

            VStack(spacing: 2) {
                ForEach(parts, id: \.name) { part in
                    HStack(spacing: 10) {
                        Circle().fill(part.color).frame(width: 8, height: 8)
                        Text(part.name).foregroundStyle(p.foreground).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(Money.format(part.value, currency)).monospacedDigit().foregroundStyle(p.textMuted)
                        Text("\(share(part.value))%").font(FN.font(13, .medium)).monospacedDigit()
                            .foregroundStyle(p.foreground)
                            .fixedSize()
                            .frame(minWidth: 36, alignment: .trailing)
                    }
                    .font(FN.font(13))
                    .frame(minHeight: 34)
                }
            }
        }
    }
}
