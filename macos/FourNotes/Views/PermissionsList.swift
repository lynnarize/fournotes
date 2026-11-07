import AppKit
import SwiftUI

// What Transcribe needs macOS to allow, one row each: what it's for and whether it's on,
// with Allow beside it. The setup step shows them as cards; Settings → Meetings as rows.

/// A permission's control: On, Allow, or System Settings once macOS won't ask again.
struct PermissionControl: View {
    @ObservedObject private var permissions = Permissions.shared
    let kind: Permissions.Kind

    var body: some View {
        switch permissions.state(kind) {
        case .allowed:
            StatusPill(text: "On", tone: .good)
        case .denied:
            SecondaryButton(title: "Open System Settings", small: true) { permissions.openSystemSettings(kind) }
                .help("macOS asks only once. Turn it on for Four Notes there.")
        case .notAsked:
            SecondaryButton(title: permissions.asking == kind ? "Asking…" : "Allow", small: true) {
                Task { await permissions.request(kind) }
            }
            .disabled(permissions.asking != nil)
        }
    }
}

/// The four, as cards: the setup step's list.
struct PermissionCards: View {
    @Environment(\.palette) private var p
    @ObservedObject private var permissions = Permissions.shared

    var body: some View {
        VStack(spacing: 12) {
            ForEach(Permissions.Kind.allCases) { kind in
                HStack(spacing: 14) {
                    Icon(kind.icon, size: 18)
                        .foregroundStyle(permissions.state(kind) == .allowed ? p.accent : p.textSecondary)
                        .frame(width: 40, height: 40)
                        .background(p.surfaceMuted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(kind.title).font(FN.font(15, .medium)).foregroundStyle(p.foreground)
                        Text(kind.detail).font(FN.font(13)).lineSpacing(2).foregroundStyle(p.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    PermissionControl(kind: kind).fixedSize()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(p.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(p.border, lineWidth: 1))
                .accessibilityElement(children: .contain)
            }
        }
        .animation(Motion.standard, value: permissions.states)
        .task { await permissions.refresh() }
        // Back from System Settings: what was changed there shows.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await permissions.refresh() }
        }
    }
}
