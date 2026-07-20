import SwiftUI

// Edge states (wz-extras.jsx): empty first-run, offline (framed as a feature),
// cloud-unreachable → on-device fallback, and older iPhone → cloud.

enum BannerTone { case ok, warn, bad }

struct StateBanner: View {
    @Environment(\.wz) private var t
    var tone: BannerTone
    var icon: String
    var title: String
    var sub: String? = nil
    var action: String? = nil

    private var color: Color { tone == .warn ? t.amber : tone == .bad ? t.red : t.green }

    var body: some View {
        HStack(spacing: 11) {
            WIcon(icon, size: 18, weight: .regular).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(WZFont.ui(13.5, .semibold)).foregroundStyle(t.text)
                if let sub { Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted) }
            }
            Spacer(minLength: 0)
            if let action {
                Text(action).font(WZFont.ui(12.5, .semibold)).foregroundStyle(color)
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(color.opacity(0.5), lineWidth: 1))
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(color.opacity(t.dark ? 0.10 : 0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(color.opacity(t.dark ? 0.26 : 0.24), lineWidth: 1))
    }
}

// Mini home shell reused by the empty/offline/error states.
struct StateHome<Banner: View>: View {
    @Environment(\.wz) private var t
    var empty = false
    var rows: [DemoRecording] = []
    @ViewBuilder var banner: Banner

    var body: some View {
        ScreenScaffold {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    WHeader(title: "Whisperio") { SquareIconButton(icon: "settings") }
                    VStack(spacing: 12) {
                        HStack(spacing: 9) {
                            WIcon("search", size: 17, weight: .regular); Text("Search transcripts").font(WZFont.ui(14.5)); Spacer()
                        }
                        .foregroundStyle(t.faint).padding(.horizontal, 13).padding(.vertical, 11)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(t.line, lineWidth: 1))
                        banner
                    }
                    .padding(.horizontal, 16).padding(.top, 4)

                    if empty {
                        VStack(spacing: 0) {
                            ZStack {
                                Circle().fill(t.gradient).frame(width: 140, height: 140).blur(radius: 34).opacity(0.3)
                                WGhost(size: 92)
                            }
                            .padding(.bottom, 22)
                            Text("Nothing captured yet").font(WZFont.display(23)).foregroundStyle(t.text)
                            Text("Tap the mic, hold the Action Button, or use the Whisperio keyboard. Everything you say lands here.")
                                .font(WZFont.ui(14.5)).foregroundStyle(t.muted).multilineTextAlignment(.center)
                                .lineSpacing(3).padding(.top, 10).padding(.horizontal, 40)
                            HStack(spacing: 8) {
                                EngineChip(label: "Action Button", icon: "bolt")
                                EngineChip(label: "Keyboard", icon: "keyboard")
                            }
                            .padding(.top, 18)
                        }
                        .frame(maxHeight: .infinity).padding(.top, -40)
                    } else {
                        ScrollView(showsIndicators: false) {
                            VStack(alignment: .leading, spacing: 0) {
                                // RecRow (variant D) self-pads 16pt horizontally, so only the
                                // label needs the inset here — rows run full-bleed.
                                SectionLabel(text: "Recent").padding(.horizontal, 16).padding(.bottom, 4)
                                ForEach(Array(rows.enumerated()), id: \.element.id) { idx, r in
                                    RecRow(r: r) {}
                                    if idx < rows.count - 1 { Divider().overlay(t.lineSoft) }
                                }
                            }
                            .padding(.top, 16).padding(.bottom, 130)
                        }
                    }
                }
                Circle().fill(t.primary).frame(width: 72, height: 72)
                    .overlay(WIcon("mic", size: 28).foregroundStyle(t.primaryInk))
                    .shadow(color: t.accent.opacity(0.7), radius: 14, y: 16)
                    .padding(.bottom, 40)
            }
        }
    }
}

extension StateHome where Banner == EmptyView {
    init(empty: Bool = false, rows: [DemoRecording] = []) {
        self.init(empty: empty, rows: rows) { EmptyView() }
    }
}

struct EmptyStateView: View {
    var body: some View { StateHome(empty: true) }
}

struct OfflineStateView: View {
    var body: some View {
        StateHome(rows: Array(WZSample.recordings.prefix(4))) {
            StateBanner(tone: .ok, icon: "lock", title: "You’re offline — and that’s fine",
                        sub: "On-device engine running at full speed. Nothing is waiting to upload.")
        }
    }
}

struct CloudErrorStateView: View {
    var body: some View {
        StateHome(rows: Array(WZSample.recordings.prefix(4))) {
            StateBanner(tone: .warn, icon: "cloud", title: "Couldn’t reach the cloud",
                        sub: "Transcribed on-device instead — your note is saved.", action: "Retry")
        }
    }
}

// Older / non-Apple-Intelligence device → cloud fallback (a settings screen). The toggle is
// wired to the real `cloudConsentGranted` gate (SettingsStore.makeChain()'s actual consent
// check) — not a local decorative @State — so switching it on here is what makes recording
// on this device actually work; this IS "the cloud-consent path" R3 asks the screen to offer.
struct OldDeviceView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    var onBack: () -> Void = {}

    private var cloudBinding: Binding<Bool> {
        Binding(
            get: { settings.settings.cloudConsentGranted },
            set: { settings.settings.cloudConsentGranted = $0 }
        )
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Engine & privacy", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        StateBanner(tone: .warn, icon: "cpu", title: "This iPhone transcribes in the cloud",
                                    sub: "On-device speech needs an A17 Pro or newer. Your device uses the cloud engine instead.")
                        VStack(spacing: 0) {
                            row(icon: "cloud", iconColor: t.amber, title: "Cloud transcription",
                                sub: "OpenAI / ElevenLabs · required on this device", last: false) {
                                WToggle(on: cloudBinding)
                            }
                            row(icon: "lock", iconColor: t.faint, title: "On-device engine",
                                sub: "Not available on this iPhone", last: true, dimmed: true) {
                                Text("A17+").font(WZFont.mono(11)).foregroundStyle(t.faint)
                            }
                        }
                        .padding(.horizontal, 16)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        FlowLine(cloud: true)
                        Text("You can still review, edit and export transcripts normally. Upgrade to an Apple-Intelligence iPhone for fully-offline capture.")
                            .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
    }

    private func row<R: View>(icon: String, iconColor: Color, title: String, sub: String, last: Bool, dimmed: Bool = false, @ViewBuilder right: () -> R) -> some View {
        HStack(spacing: 13) {
            WIcon(icon, size: 18, weight: .regular).foregroundStyle(iconColor)
                .frame(width: 38, height: 38)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted)
            }
            Spacer(minLength: 0)
            right()
        }
        .padding(.vertical, 14)
        .opacity(dimmed ? 0.55 : 1)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(t.lineSoft).frame(height: 1) } }
    }
}
