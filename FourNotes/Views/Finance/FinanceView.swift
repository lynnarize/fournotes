import SwiftUI

// Finance, as on the web (src/components/FinanceView.tsx): a header row (month, scan,
// more), the dashboard, a one-line add bar, and the month's transactions in a sortable
// table whose rows open to edit and split.

struct FinanceView: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @EnvironmentObject private var toasts: ToastCenter
    @EnvironmentObject private var assistant: Assistant
    @EnvironmentObject private var engine: AIEngine

    @State private var month = DateKit.localMonth()
    @State private var summarizing = false
    /// The data the review was last asked to cover, so a failure isn't retried in a loop.
    @State private var reviewRequested: String?
    @State private var openId: String?
    @State private var showReport = false
    @State private var showBudgets = false
    @State private var showPaste = false
    @State private var pasteText = ""
    /// Narrows the transaction table.
    @State private var query = ""
    @State private var categoryFilter = ""
    @State private var sort = TableSort(column: .date, ascending: false)

    // The "add a transaction" row.
    @State private var newMerchant = ""
    @State private var newAmount = ""
    @State private var newCurrency = ""
    @State private var newCategory = "Food & Drink"
    @FocusState private var merchantFocused: Bool

    private var cur: String { store.settings.currency }

    private var txs: [Transaction] {
        store.liveTransactions
            .filter { $0.date.hasPrefix(month) }
            .sorted { ($0.date, $0.createdAt) > ($1.date, $1.createdAt) }
    }

    private var summary: MonthlySummary? { store.summaries.first { $0.month == month } }

    var body: some View {
        ScrollViewReader { proxy in
            page(scrollTo: { id in
                withAnimation(Motion.screen) { proxy.scrollTo(id, anchor: .top) }
            })
        }
    }

    private func page(scrollTo: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.top, -8)
                .padding(.bottom, 24)

            FinanceDashboard(
                month: month, summary: summary, summarizing: summarizing,
                onSummarize: { Task { await summarize() } },
                onBudgets: { showBudgets = true },
                onOpenTransactions: { scrollTo("transactions") },
                onOpenTransaction: { id in openId = id; scrollTo("transactions") },
                onAddIncome: {
                    // The add bar switches to Income and waits for the amount.
                    newCategory = "Income"
                    scrollTo("add")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { merchantFocused = true }
                })

            addBar
                .id("add")
                .padding(.top, 24)

            transactionsSection
                .id("transactions")
                .padding(.top, 24)
        }
        .onAppear { if newCurrency.isEmpty { newCurrency = cur } }
        // The review is rewritten each time Finance opens after the month's
        // spending changed, or on a new day.
        .task(id: reviewBasis) { await autoSummarize(reviewBasis) }
        .task(id: nav.focus) {
            guard let link = nav.consumeFocus([.transactions, .budget]) else { return }
            if link.kind == .budget {
                // Budgets are edited in Finance settings.
                showBudgets = true
            } else if let t = store.liveTransactions.first(where: { $0.id == link.id }) {
                // Only move months for a date the app can actually read.
                if let day = DateKit.date(t.date) { month = DateKit.localMonth(day) }
                query = ""
                categoryFilter = ""
                openId = t.id
            }
        }
        .fnSheet(isPresented: $showBudgets) {
            SheetFrame(title: "Budgets and categories", maxHeight: 720) {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Monthly budgets").font(FN.font(15, .medium)).foregroundStyle(p.foreground)
                        BudgetEditor()
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Categories").font(FN.font(15, .medium)).foregroundStyle(p.foreground)
                        CategoryEditor()
                    }
                    .padding(.top, 20)
                    .overlay(alignment: .top) { Rectangle().fill(p.borderSubtle).frame(height: 1) }
                    // `.btn-primary .btn-lg`, the width of the dialog.
                    Button { showBudgets = false } label: {
                        Text("Done")
                            .font(FN.font(15, .medium))
                            .foregroundStyle(p.accentForeground)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(p.accent, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.fn)
                }
            }
        }
        .fnSheet(isPresented: $showPaste) { pasteSheet }
        .fnSheet(isPresented: $showReport) { ReportView() }
    }

    // MARK: - Header

    /// Under the page title (which carries the Beta badge): the month, scanning, and the
    /// rest of Finance's actions.
    private var header: some View {
        HStack(spacing: 10) {
            Spacer(minLength: 0)
            HStack(spacing: 0) {
                MonthStep(icon: "chevronLeft", help: "Previous month") { month = FinanceMath.shiftMonth(month, by: -1) }
                Text(Fmt.monthYear(month))
                    .font(FN.bodyMedium)
                    .foregroundStyle(p.foreground)
                    .frame(minWidth: 136)
                    .contentTransition(.opacity)
                    .motion(month, Motion.screen)
                MonthStep(icon: "chevron", help: "Next month") { month = FinanceMath.shiftMonth(month, by: 1) }
            }
            .frame(height: 36)
            .background(p.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(p.border, lineWidth: 1))

            SecondaryButton(title: "Scan receipt", icon: "scan") { assistant.pickAndScan() }

            // `.btn-secondary .btn-icon`: a round bordered "…".
            MenuButton(help: "More finance actions", align: .trailing) {
                [
                    .item("Monthly report…", icon: "download") { showReport = true },
                    .item("Paste a payment notification…", icon: "clipboard") { showPaste = true },
                    .divider,
                    .item("Budgets and categories…", icon: "target") { showBudgets = true },
                ]
            } label: {
                MoreCircle()
            }
        }
    }

    // MARK: - Add a transaction

    private var currencyOptions: [String] {
        var seen = Set<String>()
        return ([cur] + CURRENCIES).filter { seen.insert($0).inserted }
    }

    /// One line to add a transaction. Income goes in as money received.
    private var addBar: some View {
        HStack(spacing: 6) {
            TextField(newCategory == "Income" ? "Add income, like Salary" : "Add a transaction, like Lunch at Sederhana",
                      text: $newMerchant)
                .textFieldStyle(.plain)
                .font(FN.font(15))
                .foregroundStyle(p.foreground)
                .focused($merchantFocused)
                .onSubmit(addTransaction)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .frame(minWidth: 240, maxWidth: .infinity)
                .layoutPriority(1)
            HStack(spacing: 6) {
                MenuButton(help: "Currency") {
                    currencyOptions.map { c in .item(c, checked: c == (newCurrency.isEmpty ? cur : newCurrency)) { newCurrency = c } }
                } label: {
                    BarMenuLabel(title: newCurrency.isEmpty ? cur : newCurrency, muted: true)
                }
                TextField("0", text: $newAmount)
                    .textFieldStyle(.plain)
                    .font(FN.body)
                    .monospacedDigit()
                    .foregroundStyle(p.foreground)
                    .onSubmit(addTransaction)
            }
            .padding(.leading, 16)
            .padding(.trailing, 16)
            .frame(width: 170, height: 44)
            .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            MenuButton(help: "Category") {
                store.categories.map { c in .item(c, checked: c == newCategory) { newCategory = c } }
            } label: {
                BarMenuLabel(title: newCategory, muted: false)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .fixedSize()
            Button(action: addTransaction) {
                Text("Add")
                    .font(FN.bodyMedium)
                    .foregroundStyle(p.accentForeground)
                    .padding(.horizontal, 22)
                    .frame(height: 44)
                    .background(p.accent, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            .fixedSize()
            .accessibilityLabel("Add transaction")
        }
        .padding(6)
        .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
    }

    private func addTransaction() {
        guard !newMerchant.trimmingCharacters(in: .whitespaces).isEmpty,
              let amount = Money.parse(newAmount), amount != 0 else { return }
        store.addTransaction {
            $0.merchant = newMerchant
            $0.amount = newCategory == "Income" ? -abs(amount) : amount
            $0.currency = newCurrency.isEmpty ? cur : newCurrency
            $0.fxRate = nil
            $0.category = newCategory
            $0.date = month == DateKit.localMonth() ? DateKit.localDate() : "\(month)-01"
        }
        newMerchant = ""
        newAmount = ""
    }

    // MARK: - Transactions

    /// The table, narrowed by the search box and the category filter, then sorted.
    private var shown: [Transaction] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let out = txs.filter { t in
            (categoryFilter.isEmpty || t.category == categoryFilter)
                && (q.isEmpty || t.merchant.localizedCaseInsensitiveContains(q) || t.category.localizedCaseInsensitiveContains(q)
                    || t.items.contains { $0.name.localizedCaseInsensitiveContains(q) })
        }
        return out.sorted { a, b in
            let ordered: Bool
            switch sort.column {
            case .date: ordered = (a.date, a.createdAt) < (b.date, b.createdAt)
            case .merchant: ordered = a.merchant.localizedCaseInsensitiveCompare(b.merchant) == .orderedAscending
            case .category: ordered = a.category.localizedCaseInsensitiveCompare(b.category) == .orderedAscending
            case .amount: ordered = Insights.baseAmount(a, cur) < Insights.baseAmount(b, cur)
            }
            return sort.ascending ? ordered : !ordered
        }
    }

    private var filtered: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty || !categoryFilter.isEmpty }

    private func share(_ list: [Transaction]) -> Double {
        list.filter { $0.amount > 0 }.reduce(0) { $0 + Insights.myShare($1, cur) }
    }

    private var transactionsSection: some View {
        let byCat = Insights.spendByCategory(txs, cur).filter { $0.value > 0 }
            .sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
        let colors = categoryColors(byCat, p)
        var seen = Set<String>()
        let categories = (store.categories + txs.map(\.category)).filter { seen.insert($0).inserted }
        let rows = shown

        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text("Transactions").font(FN.font(20, .medium)).foregroundStyle(p.foreground)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) {
                    Icon("search", size: 16).foregroundStyle(p.textMuted)
                    TextField("Search merchants or items", text: $query)
                        .textFieldStyle(.plain)
                        .font(FN.body)
                        .foregroundStyle(p.foreground)
                        .onExitCommand { query = "" }
                }
                .padding(.horizontal, 12)
                .frame(width: 260, height: 36)
                .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                SelectMenu(options: [("", "All categories")] + categories.map { ($0, $0) },
                           selection: $categoryFilter, help: "Filter by category")
                    .fixedSize()
            }

            if txs.isEmpty {
                EmptyStart(
                    title: "No spending logged yet",
                    hint: "Add one above, scan a receipt, paste a payment notification, or just say what you spent.",
                    prompts: ["Spent 25k on coffee at Starbucks", "Set my food budget to 1.5M a month"],
                    extra: { SecondaryButton(title: "Paste a notification", small: true) { showPaste = true } })
                    .transition(.opacity.combined(with: .offset(y: 8)))
            } else {
                VStack(spacing: 0) {
                    TableHeader(sort: $sort)
                    if rows.isEmpty {
                        Rectangle().fill(p.borderSubtle).frame(height: 1)
                        Text("Nothing matches\(query.trimmingCharacters(in: .whitespaces).isEmpty ? "" : " “\(query.trimmingCharacters(in: .whitespaces))”")\(categoryFilter.isEmpty ? "" : " in \(categoryFilter)").")
                            .font(FN.body).foregroundStyle(p.textMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 32)
                    }
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { t in
                            TransactionRow(tx: t, color: colors[t.category] ?? p.finRest,
                                           open: openId == t.id,
                                           onToggle: { openId = openId == t.id ? nil : t.id },
                                           onDelete: { delete(t) })
                        }
                    }
                    .animation(Motion.list, value: rows.map(\.id))
                    // Your share: of the month, or of what the filters leave.
                    HStack {
                        Text(filtered ? "Your share of the \(rows.count == 1 ? "one" : String(rows.count)) shown"
                             : "Your share in \(FinanceDashboard.monthName(month))")
                            .foregroundStyle(p.textSecondary)
                        Spacer()
                        Text(Money.format(filtered ? share(rows) : share(txs), cur))
                            .font(FN.bodyMedium)
                            .monospacedDigit()
                            .foregroundStyle(p.foreground)
                            .padding(.trailing, 48)
                    }
                    .font(FN.body)
                    .padding(.leading, 24)
                    .padding(.trailing, 24)
                    .padding(.vertical, 14)
                    .background(p.surfaceMuted)
                    .overlay(alignment: .top) { Rectangle().fill(p.border).frame(height: 1) }
                }
                .background(p.surface)
                .clipShape(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FN.radiusPanel, style: .continuous).strokeBorder(p.border, lineWidth: 1))
            }
        }
    }

    private func delete(_ t: Transaction) {
        store.remove(.transactions, t.id)
        if openId == t.id { openId = nil }
        toasts.push("Deleted \(t.merchant)", action: Toast.Action(label: "Undo") { [store] in
            store.updateTransaction(t.id) { $0.deletedAt = nil }
        })
    }

    // MARK: - Paste a notification

    private var pasteSheet: some View {
        SheetFrame(title: "Paste a payment notification") {
            VStack(alignment: .leading, spacing: 16) {
                Text("Paste a payment notification from any app (GoPay, OVO, DANA, ShopeePay, QRIS, a bank app) or the text of a receipt. For screenshots and photos, use Scan receipt instead.")
                    .font(FN.body)
                    .foregroundStyle(p.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                CommittedField(placeholder: "Payment to Kopi Kenangan of Rp28,000 was successful", value: pasteText,
                               boxed: true, axis: .vertical, lineLimit: 4...8, minHeight: 96, settle: nil) { pasteText = $0 }

                HStack(spacing: 8) {
                    Spacer()
                    KitButton(kind: .plain, title: "Cancel") { showPaste = false }
                    PrimaryButton(title: "Add",
                                  disabled: pasteText.trimmingCharacters(in: .whitespaces).isEmpty,
                                  action: submitPaste)
                }
            }
        }
    }

    private func submitPaste() {
        let text = pasteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if let parsed = Wallet.parseNotification(text) {
            store.addTransaction {
                $0.merchant = parsed.merchant
                $0.amount = parsed.amount
                $0.category = parsed.category
                $0.date = DateKit.localDate()
            }
            toasts.push("💸 \(parsed.wallet ?? "Payment"): \(parsed.merchant) "
                        + Money.format(abs(parsed.amount), cur))
        } else if engine.canChat {
            Task { await assistant.send(text) }
            toasts.push("Sent to the assistant to read.")
        } else {
            toasts.push("Couldn't read that, and no server is set for the assistant.", tone: .error)
            return
        }
        pasteText = ""
        showPaste = false
    }

    // MARK: - Monthly review

    private var monthTotal: Double {
        txs.filter { $0.amount > 0 }.reduce(0) { $0 + Insights.myShare($1, cur) }
    }

    /// What this month's review covers: its transactions, and the day.
    private var reviewBasis: String {
        let rows = txs.map { "\($0.id)|\($0.amount)|\($0.category)" }.joined(separator: ";")
        return Fingerprint.of("\(month)#\(DateKit.localDate())#\(rows)")
    }

    private func autoSummarize(_ basis: String) async {
        guard month == DateKit.localMonth(), !txs.isEmpty, engine.canSummarize,
              reviewRequested != basis else { return }
        // Up to date: written today, over the same total.
        // (A review from before the figures were the app's own is rewritten.)
        if let summary, DateKit.date(summary.createdAt).map(DateKit.localDate) == DateKit.localDate(),
           abs(summary.total - monthTotal) < 1,
           summary.text.hasPrefix("- Total: \(Money.format(summary.total, cur))") {
            return
        }
        // Let a burst of edits settle; a newer change cancels this one.
        try? await Task.sleep(for: .seconds(1.5))
        guard !Task.isCancelled else { return }
        reviewRequested = basis
        await summarize()
    }

    private func summarize() async {
        guard !summarizing else { return }
        summarizing = true
        defer { summarizing = false }
        do {
            let written = try await engine.monthlySummary(month: month, currency: cur, transactions: txs)
            let total = monthTotal
            let text = MonthlyReview.compose(written, total: total,
                                             byCategory: Insights.spendByCategory(txs, cur), currency: cur)
            store.saveSummary(MonthlySummary(
                month: month, total: total, currency: cur,
                byCategory: Insights.spendByCategory(txs, cur),
                text: text, createdAt: DateKit.nowIso()))
        } catch {
            toasts.push((error as? APIError)?.errorDescription ?? "Failed", tone: .error)
        }
    }
}

// MARK: - The table

private struct TableSort: Equatable {
    enum Column { case date, merchant, category, amount }
    var column: Column
    var ascending: Bool
}

/// Column widths, as the web's table: Date 104, Category 200, Amount 150, and 48 for delete.
private enum Columns {
    static let date: CGFloat = 104 - 24 - 12
    static let category: CGFloat = 200 - 12
    static let amount: CGFloat = 150 - 24
    static let delete: CGFloat = 48
}

/// The column titles: click to sort, again to reverse.
private struct TableHeader: View {
    @Environment(\.palette) private var p
    @Binding var sort: TableSort

    var body: some View {
        HStack(spacing: 12) {
            title("Date", .date).frame(width: Columns.date, alignment: .leading)
            title("Merchant", .merchant).frame(maxWidth: .infinity, alignment: .leading)
            title("Category", .category).frame(width: Columns.category, alignment: .leading)
            title("Amount", .amount).frame(width: Columns.amount, alignment: .trailing)
                .padding(.trailing, 12)
            Color.clear.frame(width: Columns.delete - 24, height: 1)
        }
        .padding(.leading, 24)
        .padding(.trailing, 12)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    private func title(_ text: String, _ column: TableSort.Column) -> some View {
        let on = sort.column == column
        return Button {
            if sort.column == column {
                sort.ascending.toggle()
            } else {
                sort = TableSort(column: column, ascending: !(column == .date || column == .amount))
            }
        } label: {
            HStack(spacing: 4) {
                Text(text)
                Icon("chevronDown", size: 12)
                    .opacity(on ? 1 : 0)
                    .rotationEffect(.degrees(on && sort.ascending ? 180 : 0))
            }
            .font(FN.font(12, on ? .medium : .regular))
            .foregroundStyle(on ? p.foreground : p.textMuted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.fn)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// One transaction: date, merchant (with what's in it, split and linked), category,
/// amount, and delete on hover. Opens to edit and split.
private struct TransactionRow: View {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var nav: Navigation
    @State private var hovering = false

    let tx: Transaction
    let color: Color
    let open: Bool
    let onToggle: () -> Void
    let onDelete: () -> Void

    private var cur: String { store.settings.currency }
    private var foreign: Bool { tx.currency != cur }
    private var income: Bool { tx.amount < 0 }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(p.borderSubtle).frame(height: 1)
            summaryRow
                .background(open || hovering ? p.hover : .clear)
            if open {
                editor
                    .background(p.hover)
                    .transition(.opacity.combined(with: .offset(y: -8)))
            }
        }
        .flashes(nav.isFlashing(tx.id), palette: p)
        .motion(open || hovering, Motion.quick)
        .onHover { hovering = $0 }
    }

    private var summaryRow: some View {
        let splits = tx.splits ?? []
        let unsettled = splits.filter { !$0.settled }.count
        return HStack(spacing: 12) {
            Text(FinanceMath.shortDate(tx.date))
                .font(FN.body).monospacedDigit()
                .foregroundStyle(p.textSecondary)
                .frame(width: Columns.date, alignment: .leading)

            Button(action: onToggle) {
                HStack(spacing: 10) {
                    if let image = Attachments.image(file: tx.imageFile, dataUrl: tx.imageDataUrl) {
                        Image(nsImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 32, height: 32)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(tx.merchant).font(FN.body).foregroundStyle(p.foreground).lineLimit(1)
                        if !tx.items.isEmpty || !splits.isEmpty || tx.noteId != nil {
                            HStack(spacing: 8) {
                                if !tx.items.isEmpty {
                                    Text(String(tx.items.map(\.name).joined(separator: ", ").prefix(60))).lineLimit(1)
                                }
                                if !splits.isEmpty {
                                    HStack(spacing: 4) {
                                        Icon("users", size: 12)
                                        Text("Split with \(splits.count)\(unsettled > 0 ? ", \(unsettled) unpaid" : ", all settled")")
                                    }
                                }
                                if tx.noteId != nil {
                                    HStack(spacing: 4) { Icon("link", size: 12); Text("Linked note") }
                                }
                            }
                            .font(FN.small)
                            .foregroundStyle(p.textMuted)
                            .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(.fn)
            .frame(maxWidth: .infinity)
            .accessibilityValue(open ? "Open" : "")

            MenuButton(help: "Category of \(tx.merchant)") {
                store.categories.map { c in
                    .item(c, checked: c == tx.category) { store.updateTransaction(tx.id) { $0.category = c } }
                }
            } label: {
                HStack(spacing: 6) {
                    Circle().fill(color).frame(width: 8, height: 8)
                    Text(tx.category).lineLimit(1)
                    Icon("chevronDown", size: 12).opacity(0.6)
                }
                .font(FN.font(13))
                .foregroundStyle(p.textSecondary)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .frame(width: Columns.category, alignment: .leading)

            VStack(alignment: .trailing, spacing: 0) {
                if !splits.isEmpty && !income {
                    Text(Money.format(Insights.myShare(tx, cur), cur))
                    Text("of \(Money.format(tx.amount, tx.currency))").font(FN.small).foregroundStyle(p.textMuted)
                } else {
                    Text((income ? "+" : "") + Money.format(abs(tx.amount), tx.currency))
                    if foreign {
                        Text(tx.fxRate != nil ? "≈ \(Money.format(abs(Insights.baseAmount(tx, cur)), cur))" : "Fetching the rate…")
                            .font(FN.small).foregroundStyle(p.textMuted)
                    }
                    if income { Text("Income").font(FN.small).foregroundStyle(p.textMuted) }
                }
            }
            .font(FN.body)
            .monospacedDigit()
            .foregroundStyle(p.foreground)
            .frame(width: Columns.amount, alignment: .trailing)
            .padding(.trailing, 12)

            // Shown on hover; red under the pointer.
            DeleteButton(action: onDelete)
                .opacity(hovering ? 1 : 0)
                .frame(width: Columns.delete - 24)
        }
        .padding(.leading, 24)
        .padding(.trailing, 12)
        .padding(.vertical, 10)
    }

    private var editor: some View {
        HStack(alignment: .top, spacing: 24) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .topLeading),
                                GridItem(.flexible(), spacing: 12, alignment: .topLeading)],
                      alignment: .leading, spacing: 12) {
                field("Merchant") {
                    CommittedField(placeholder: "Merchant", value: tx.merchant, boxed: true) { v in
                        store.updateTransaction(tx.id) { $0.merchant = v }
                    }
                }
                field("Date") {
                    DatePicker("", selection: Binding(
                        get: { DateKit.date(tx.date) ?? Date() },
                        set: { d in store.updateTransaction(tx.id) { $0.date = DateKit.localDate(d) } }),
                        displayedComponents: .date)
                        .labelsHidden()
                        .frame(height: 36)
                }
                field("Amount") {
                    AmountField(value: tx.amount, currency: tx.currency) { amount in
                        store.updateTransaction(tx.id) { $0.amount = amount }
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                }
                field("Currency") {
                    SelectMenu(options: currencyOptions.map { ($0, $0) },
                               selection: Binding(
                        get: { tx.currency },
                        set: { c in store.updateTransaction(tx.id) { $0.currency = c; $0.fxRate = nil } }))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .modifier(EditorExtras(tx: tx, foreign: foreign, cur: cur, field: field))

            VStack(alignment: .leading, spacing: 8) {
                Text("Split bill").font(FN.small).foregroundStyle(p.textMuted)
                SplitEditor(txId: tx.id)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 24)
        .padding(.top, 4)
        .padding(.bottom, 20)
    }

    private var currencyOptions: [String] {
        var seen = Set<String>()
        return ([cur, tx.currency] + CURRENCIES).filter { seen.insert($0).inserted }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> AnyView {
        AnyView(VStack(alignment: .leading, spacing: 6) {
            Text(label).font(FN.small).foregroundStyle(p.textMuted)
            content()
        })
    }
}

/// Below the editor's grid: the rate for a foreign currency, the linked note, a line on
/// income, and delete.
private struct EditorExtras: ViewModifier {
    @Environment(\.palette) private var p
    @EnvironmentObject private var store: Store
    let tx: Transaction
    let foreign: Bool
    let cur: String
    let field: (String, () -> AnyView) -> AnyView

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            content
            if foreign {
                field("Rate: 1 \(tx.currency) = ? \(cur)") {
                    AnyView(AmountField(value: tx.fxRate ?? 0, currency: cur) { rate in
                        if rate > 0 { store.updateTransaction(tx.id) { $0.fxRate = rate } }
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .background(p.surface, in: RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FN.radiusControl, style: .continuous).strokeBorder(p.border, lineWidth: 1)))
                }
            }
            field("Linked note") {
                AnyView(SelectMenu(options: [("", "None")] + store.liveNotes.map { ($0.id, $0.title.isEmpty ? "Untitled" : $0.title) },
                                   selection: Binding(
                    get: { tx.noteId ?? "" },
                    set: { id in store.updateTransaction(tx.id) { $0.noteId = id.isEmpty ? nil : id } }))
                    .frame(maxWidth: .infinity, alignment: .leading))
            }
            Text("Amounts below zero are money received.").font(FN.small).foregroundStyle(p.textMuted)
            KitButton(kind: .danger, title: "Delete transaction", small: true) { store.remove(.transactions, tx.id) }
                .padding(.leading, -12)
        }
    }
}

/// The trash at a row's end: plain, red under the pointer.
private struct DeleteButton: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon("trash", size: 14)
                .foregroundStyle(hovering ? p.danger : p.textSecondary)
                .frame(width: 32, height: 32)
                .background(hovering ? p.hover : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .help("Delete")
    }
}

/// A month step in the month switcher: 36pt round, under the pointer a shade darker.
private struct MonthStep: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let icon: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(icon, size: 16)
                .foregroundStyle(hovering ? p.foreground : p.textSecondary)
                .frame(width: 36, height: 36)
                .background(hovering ? p.hover : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.fn)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// The header's "…": a round bordered button (`.btn-secondary .btn-icon`).
private struct MoreCircle: View {
    @Environment(\.palette) private var p
    @Environment(\.menuIsOpen) private var open
    @State private var hovering = false

    var body: some View {
        Icon("more", size: 18)
            .foregroundStyle(p.textSecondary)
            .frame(width: 36, height: 36)
            .background(hovering || open ? p.surfaceMuted : p.surface, in: Circle())
            .overlay(Circle().strokeBorder(p.border, lineWidth: 1))
            .contentShape(Circle())
            .onHover { hovering = $0 }
            .motion(hovering || open, Motion.quick)
    }
}

/// A menu's label inside the add bar: plain text and a small chevron.
private struct BarMenuLabel: View {
    @Environment(\.palette) private var p
    @State private var hovering = false
    let title: String
    let muted: Bool

    var body: some View {
        HStack(spacing: 4) {
            Text(title).lineLimit(1)
            Icon("chevronDown", size: 12).opacity(0.7)
        }
        .font(FN.body)
        .foregroundStyle(hovering ? p.foreground : (muted ? p.textMuted : p.textSecondary))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }
}
