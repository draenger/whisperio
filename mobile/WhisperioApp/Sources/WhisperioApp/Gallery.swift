import SwiftUI

// Concept gallery — the equivalent of the design canvas: one navigable hub that reaches
// every surface (core app, engine directions, scenes, edge states, the style kit) so the
// whole concept builds and runs as a single app.

private struct ConceptScreen<Content: View>: View {
    @Environment(\.wz) private var t
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: title)
                ScrollView(showsIndicators: false) {
                    content.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 28)
                }
            }
        }
    }
}

// Direction B is stateful (toggles + consent) — small live wrapper for the gallery.
private struct EngineDirectionBDemo: View {
    @Environment(\.wz) private var t
    @State private var cleanup = true
    @State private var cloud = false
    @State private var sheet = false
    var body: some View {
        ZStack {
            EngineChain(cleanup: $cleanup, cloud: $cloud) { withAnimation { sheet = true } }
            if sheet {
                ConsentSheet(onClose: { withAnimation { sheet = false } },
                             onConfirm: { withAnimation { cloud = true; sheet = false } })
                .transition(.opacity)
            }
        }
    }
}

struct GalleryView: View {
    @State private var dark = true
    @StateObject private var settings = SettingsStore()
    private var t: WZTheme { .of(dark) }

    var body: some View {
        NavigationStack {
            List {
                section("Core app", [
                    entry("iPhone app (live)") { AnyView(WZPhoneView(initialScreen: .home, dark: dark)) },
                    entry("Onboarding") { AnyView(WZPhoneView(initialScreen: .onboarding, dark: dark)) }
                ])
                section("Engine & privacy — 3 directions", [
                    entry("A · privacy-led radio") { AnyView(ConceptScreen(title: "Engine — A") { EngineDirectionA() }) },
                    entry("B · processing chain (settled)") { AnyView(ConceptScreen(title: "Engine — B") { EngineDirectionBDemo() }) },
                    entry("C · privacy tier dial") { AnyView(ConceptScreen(title: "Engine — C") { EngineDirectionC() }) }
                ])
                section("Triggers (honest about iOS)", [
                    entry("Custom keyboard · the bounce") { AnyView(KeyboardScene()) },
                    entry("Action Button / Lock / Back-Tap") { AnyView(TriggerScene()) },
                    entry("Dynamic Island · Live Activity") { AnyView(DynamicIslandScene()) }
                ])
                section("Other devices", [
                    entry("iPad · split view") { AnyView(iPadHost().environmentObject(settings)) },
                    entry("Apple Watch") { AnyView(WatchHost()) }
                ])
                section("Edge states", [
                    entry("Empty · first run") { AnyView(EmptyStateView()) },
                    entry("Offline · a feature") { AnyView(OfflineStateView()) },
                    entry("Cloud unreachable → on-device") { AnyView(CloudErrorStateView()) },
                    entry("Older iPhone → Cloud") { AnyView(OldDeviceView().environmentObject(settings)) }
                ])
                section("Reference", [
                    entry("Component & style kit") { AnyView(StyleKitView()) }
                ])
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Whisperio · concept")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dark.toggle() } label: { WIcon(dark ? "sun" : "moon", size: 18) }
                }
            }
        }
        .environment(\.wz, t)
        .preferredColorScheme(dark ? .dark : .light)
    }

    private func section(_ title: String, _ rows: [GalleryEntry]) -> some View {
        Section(title) {
            ForEach(rows) { e in
                NavigationLink { e.make().environment(\.wz, t).preferredColorScheme(dark ? .dark : .light) }
                    label: { Text(e.title).font(WZFont.ui(15)) }
            }
        }
    }

    private func entry(_ title: String, _ make: @escaping () -> AnyView) -> GalleryEntry {
        GalleryEntry(title: title, make: make)
    }
}

private struct GalleryEntry: Identifiable {
    let id = UUID()
    let title: String
    let make: () -> AnyView
}

// iPad / Watch are unusual sizes; host them centered & scrollable so they show on any device.
private struct iPadHost: View {
    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            iPadSplitView().frame(width: 1124, height: 768)
        }
        .background(Color.black.opacity(0.2).ignoresSafeArea())
    }
}
private struct WatchHost: View {
    var body: some View {
        WatchView()
            .frame(width: 198, height: 242)
            .clipShape(RoundedRectangle(cornerRadius: 44, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 44, style: .continuous).stroke(.white.opacity(0.15), lineWidth: 10))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.ignoresSafeArea())
    }
}
