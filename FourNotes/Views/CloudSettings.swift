import AppKit
import SwiftUI

// Settings → AI & API keys → In the cloud: one tab per provider, as on the web
// (src/components/ApiKeysSection.tsx). OpenRouter's free models come first:
// one free key and the app is fully working. The same key can switch to paid
// models; OpenCode (Zen's free models, or a Go subscription), Claude and any
// other OpenAI-compatible provider are the alternatives. Each tab keeps its
// own key, and the one picked with "Ask this first" answers first.

struct CloudProviderTabs<Claude: View>: View {
    typealias Tab = CloudProviders.Tab

    @Environment(\.palette) private var p
    @Environment(\.colorScheme) private var scheme
    @EnvironmentObject private var engine: AIEngine
    @Namespace private var raised
    @ViewBuilder let claude: () -> Claude

    @State private var tab: Tab = .openrouter
    /// Tabs with a key saved, re-read when a key changes rather than on every draw.
    @State private var keyed: Set<Tab> = []

    @State private var orPaid = false
    @State private var orFreeModel = ""
    @State private var orPaidModel = ""
    @State private var paidModels: [OpenRouterModels.PaidModel]?
    @State private var paidError = false

    @State private var ocTier: OpenCodeModels.Tier = .free
    @State private var ocModel = ""

    @State private var results: [Tab: (ok: Bool, message: String)] = [:]
    @State private var testing: Tab?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            tabBar
            VStack(alignment: .leading, spacing: 10) {
                switch tab {
                case .openrouter: openRouter
                case .opencode: openCode
                case .anthropic:
                    claude()
                    useFirst(.anthropic)
                case .other:
                    ProviderSlotEditor(slot: .cloud, onChange: keysChanged)
                    useFirst(.other)
                }
            }
            .animation(Motion.standard, value: tab)
        }
        .onAppear(perform: load)
        // A key saved on the Claude tab, or on Other, is only seen by the engine.
        .onChange(of: engine.revision) { refreshKeyed() }
    }

    // MARK: - Tabs

    /// The kit's segmented control, a dot on the tabs with a key: green on the one asked first.
    private var tabBar: some View {
        HStack(spacing: 2) {
            ForEach(Tab.allCases) { t in
                let on = tab == t
                Button { withAnimation(Motion.standard) { tab = t } } label: {
                    HStack(spacing: 6) {
                        Text(t.label)
                        if keyed.contains(t) {
                            Circle()
                                .fill(engine.cloudTabs.first == t ? p.success : p.textMuted)
                                .frame(width: 6, height: 6)
                                .help(engine.cloudTabs.first == t ? "Key saved · asked first" : "Key saved")
                        }
                    }
                    .font(FN.font(13, on ? .medium : .regular))
                    .foregroundStyle(on ? p.foreground : p.textSecondary)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background {
                        if on {
                            Capsule(style: .circular)
                                .fill(scheme == .dark ? p.surfaceRaised : p.surface)
                                .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
                                .matchedGeometryEffect(id: "tab", in: raised)
                        }
                    }
                    .contentShape(Capsule(style: .circular))
                }
                .buttonStyle(.fn)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(p.surfaceMuted, in: Capsule(style: .circular))
    }

    // MARK: - OpenRouter

    @ViewBuilder
    private var openRouter: some View {
        header(badge: orPaid ? "Paid" : "Free", tone: orPaid ? .accent : .success,
               title: "OpenRouter key",
               link: orPaid ? ("Add credits", OpenRouterModels.creditsPage) : ("Get a free key", OpenRouterModels.keysPage))
        KeyField(item: .openrouterKey, showsLabel: false, onChange: keysChanged)
        HStack(spacing: 8) {
            tierSwitch(paid: orPaid, paidLabel: "Paid") { paid in
                orPaid = paid
                Keychain.write(.openrouterTier, paid ? "paid" : nil)
                saved(.openrouter)
            }
            if orPaid {
                BoxedField(placeholder: paidModels != nil ? "Search, e.g. claude, gpt, gemini"
                               : paidError ? "Model id, e.g. provider/model" : "Loading models…",
                           text: $orPaidModel) { pickPaid(orPaidModel) }
                if let paidModels, !paidModels.isEmpty {
                    SelectField(title: "Choose", help: "OpenRouter's paid models") { paidEntries(paidModels) }
                }
            } else {
                SelectField(title: freeLabel, help: "OpenRouter's tested free models") {
                    OpenRouterModels.free.map { m in
                        .item(m.menuLabel, checked: m.id == orFreeModel) {
                            orFreeModel = m.id
                            Keychain.write(.openrouterModel, m.id)
                            saved(.openrouter)
                        }
                    }
                }
            }
        }
        hint(orPaid ? paidHint : freeHint)
        if orPaid, !OpenRouterModels.isModelId(orPaidModel) {
            SettingsHint("Pick a paid model, or switch back to Free. Until then a free model answers.", tone: p.danger)
        }
        testRow(.openrouter)
        useFirst(.openrouter)
    }

    private var freeLabel: String {
        OpenRouterModels.free.first { $0.id == orFreeModel }?.label
            ?? OpenRouterModels.free.first?.label ?? "Default"
    }

    private var paidInfo: OpenRouterModels.PaidModel? { paidModels?.first { $0.id == orPaidModel } }

    private var freeHint: String {
        let tested = OpenRouterModels.checkedAt
            .map { " (tested \($0.formatted(date: .abbreviated, time: .omitted)))" } ?? ""
        return "Free, with daily limits. Only models that correctly file to-dos and transactions are listed"
            + tested + "; if one is busy, the next is tried."
    }

    private var paidHint: String {
        var line = ""
        if let m = paidInfo {
            line = "\(m.name): \(OpenRouterModels.perMillion(m.prompt)) / \(OpenRouterModels.perMillion(m.completion)) "
                + "per 1M tokens in / out"
                + (m.context > 0 ? ", \(m.context / 1000)K context" : "")
                + (m.vision ? ", reads photos. " : ", text only. ")
        }
        return line + "Billed to your OpenRouter credits, no daily limit. Used for every AI feature"
            + (paidInfo?.vision == false ? " except photos, which go to a free model that reads them." : ".")
    }

    /// The paid list, narrowed by what is typed in the model field.
    private func paidEntries(_ all: [OpenRouterModels.PaidModel]) -> [MenuEntry] {
        let typed = orPaidModel.trimmingCharacters(in: .whitespaces)
        let matching = typed.isEmpty || all.contains(where: { $0.id == typed })
            ? all
            : all.filter { $0.id.localizedCaseInsensitiveContains(typed) || $0.name.localizedCaseInsensitiveContains(typed) }
        return matching.prefix(60).map { m in
            .item(m.menuLabel, checked: m.id == orPaidModel) { pickPaid(m.id) }
        }
    }

    private func pickPaid(_ id: String) {
        let id = id.trimmingCharacters(in: .whitespaces)
        orPaidModel = id
        Keychain.write(.openrouterPaidModel, id.isEmpty ? nil : id)
        // Unknown models are assumed to read photos.
        let known = paidModels?.first { $0.id == id }
        Keychain.write(.openrouterPaidTextOnly, known.map { $0.vision ? nil : "1" } ?? nil)
        saved(.openrouter)
    }

    /// The paid list is long and changes often: loaded live, only once Paid is picked.
    private func loadPaidModels() async {
        guard paidModels == nil else { return }
        do {
            let list = try await OpenRouterModels.paid()
            paidModels = list
            paidError = list.isEmpty
        } catch {
            paidError = true
        }
    }

    // MARK: - OpenCode

    @ViewBuilder
    private var openCode: some View {
        let go = ocTier == .go
        header(badge: go ? "Go" : "Free", tone: go ? .accent : .success,
               title: go ? "OpenCode Go key" : "OpenCode key",
               link: go ? ("Subscribe to Go", OpenCodeModels.goPage) : ("Get a key", OpenCodeModels.keysPage))
        KeyField(item: .opencodeKey, showsLabel: false, onChange: keysChanged)
        HStack(spacing: 8) {
            tierSwitch(paid: go, paidLabel: "Go") { paid in
                ocTier = paid ? .go : .free
                Keychain.write(.opencodeTier, paid ? OpenCodeModels.Tier.go.rawValue : nil)
                ocModel = CloudProviders.openCodeModel
                saved(.opencode)
            }
            SelectField(title: OpenCodeModels.label(ocModel, tier: ocTier), help: "OpenCode models") {
                OpenCodeModels.models(ocTier).map { m in
                    .item(m.menuLabel, checked: m.id == ocModel) {
                        ocModel = m.id
                        Keychain.write(ocTier == .go ? .opencodeGoModel : .opencodeModel, m.id)
                        saved(.opencode)
                    }
                }
            }
        }
        hint(go
             ? "Uses your OpenCode Go subscription ($10/month) with its 5-hour, weekly and monthly limits. Photos go to DeepSeek V4 Flash Vision, included in Go."
             : "OpenCode Zen's free models. They may use your prompts to improve the model. Photos go to DeepSeek V4 Flash Vision, which needs a Zen balance.")
        testRow(.opencode)
        useFirst(.opencode)
    }

    // MARK: - Pieces

    private func header(badge: String, tone: CloudHeader.Tone, title: String, link: (String, String)) -> some View {
        CloudHeader(badge: badge, tone: tone, title: title, link: link)
    }

    private func tierSwitch(paid: Bool, paidLabel: String, onPick: @escaping (Bool) -> Void) -> some View {
        SegmentedTabs(items: [("free", "Free"), ("paid", paidLabel)],
                      selection: Binding(get: { paid ? "paid" : "free" }, set: { onPick($0 == "paid") }))
            .fixedSize()
    }

    private func hint(_ text: String) -> some View {
        SettingsHint(text)
    }

    private func testRow(_ t: Tab) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SecondaryButton(title: testing == t ? "Testing…" : "Test", small: true) { Task { await test(t) } }
                .disabled(testing != nil || !keyed.contains(t))
            if let r = results[t] {
                HStack(alignment: .top, spacing: 6) {
                    Icon(r.ok ? "check" : "warning", size: 15).padding(.top, 1)
                    Text(r.message).fixedSize(horizontal: false, vertical: true)
                }
                .font(FN.font(13))
                .foregroundStyle(r.ok ? p.success : p.danger)
                .transition(.opacity.combined(with: .offset(y: 4)))
            }
        }
        .animation(Motion.standard, value: results[t]?.message)
    }

    /// Only worth showing once there's a choice to make.
    @ViewBuilder
    private func useFirst(_ t: Tab) -> some View {
        let ready = engine.cloudTabs
        if ready.count > 1, ready.contains(t) {
            if ready.first == t {
                HStack(spacing: 6) {
                    Icon("check", size: 15)
                    Text("Asked first in the cloud")
                }
                .font(FN.font(13))
                .foregroundStyle(p.success)
            } else if let first = ready.first {
                Button("Ask this first, instead of \(first.label)") {
                    CloudProviders.prefer(t)
                    engine.refresh()
                }
                .buttonStyle(.fn)
                .font(FN.font(13))
                .foregroundStyle(p.foreground)
                .underline(color: p.borderStrong)
            }
        }
    }

    // MARK: - State

    private func load() {
        orPaid = CloudProviders.openRouterPaid
        orFreeModel = Keychain.read(.openrouterModel) ?? OpenRouterModels.defaultModel
        orPaidModel = Keychain.read(.openrouterPaidModel) ?? ""
        ocTier = CloudProviders.openCodeTier
        ocModel = CloudProviders.openCodeModel
        refreshKeyed()
        // Open on the provider asked first.
        if let first = engine.cloudTabs.first { tab = first }
        if orPaid { Task { await loadPaidModels() } }
    }

    private func refreshKeyed() {
        keyed = Set(Tab.allCases.filter(CloudProviders.hasKey))
    }

    private func keysChanged() {
        refreshKeyed()
        results = [:]
        engine.refresh()
    }

    private func saved(_ t: Tab) {
        results[t] = nil
        engine.refresh()
        if t == .openrouter, orPaid { Task { await loadPaidModels() } }
    }

    private func test(_ t: Tab) async {
        let client = t == .openrouter ? CloudProviders.openRouter() : CloudProviders.openCode()
        guard let client else { return }
        testing = t
        defer { testing = nil }
        let label = t == .openrouter
            ? (orPaid && OpenRouterModels.isModelId(orPaidModel) ? orPaidModel : freeLabel)
            : OpenCodeModels.label(ocModel, tier: ocTier)
        results[t] = await client.checkKey(modelLabel: label)
    }
}
