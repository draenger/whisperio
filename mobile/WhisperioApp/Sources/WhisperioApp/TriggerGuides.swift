import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// Idiot-proof trigger onboarding — a "Set up dictation triggers" hub that lists every way
// to start Whisperio from outside the app, drilling into a numbered, visual, honest guide
// for each. Deliberately upfront about iOS's limits: no app can silently paste into another,
// so most triggers land the transcript on the CLIPBOARD and the user pastes; the keyboard
// bounces to the app and swipes back. Brand-styled to match the rest of the concept.

// MARK: - Model

// One honest note attached to the guide footer.
private struct GuideNote {
    let icon: String       // WZIcon key
    let text: String
}

// A single numbered step in a guide.
private struct GuideStep {
    let icon: String       // SF Symbol name (raw — these are setup glyphs beyond WZIcon's map)
    let title: String
    let detail: String
}

// One trigger guide: how to set it up + what you get + the honest catch.
private struct TriggerGuide: Identifiable {
    let id: String
    let symbol: String     // SF Symbol name for the hero tile
    let name: String
    let blurb: String      // one-line hub blurb
    let whatYouGet: String // one-line "what you get"
    let steps: [GuideStep]
    let note: GuideNote    // the honest iOS-limit note (paste / swipe-back), footer of the guide
    var openSettings = false   // guides that end in Settings show an "Open Settings" button

    static let all: [TriggerGuide] = [
        // 1 — Action Button
        TriggerGuide(
            id: "action",
            symbol: "button.programmable",
            name: "Action Button",
            blurb: "Hold the side button → record → paste.",
            whatYouGet: "Squeeze the Action Button anywhere to capture a thought.",
            steps: [
                GuideStep(icon: "gearshape", title: "Open Settings → Action Button",
                          detail: "Swipe through the options until you reach the Shortcut screen."),
                GuideStep(icon: "square.and.pencil", title: "Choose “Shortcut”",
                          detail: "Tap Choose a Shortcut, then pick the Whisperio “Dictate” shortcut."),
                GuideStep(icon: "hand.tap", title: "Press & hold to record",
                          detail: "Hold the Action Button from any screen — Whisperio opens and starts listening."),
                GuideStep(icon: "doc.on.clipboard", title: "Your text is on the clipboard",
                          detail: "When you finish, the transcript is copied. Long-press any text field → Paste."),
            ],
            note: GuideNote(icon: "lock",
                            text: "iOS won’t let any app type into another app for you. So the Action Button copies your words — you paste them wherever you want. Nothing is sent anywhere."),
            openSettings: true
        ),
        // 2 — Back Tap
        TriggerGuide(
            id: "backtap",
            symbol: "iphone.gen3.radiowaves.left.and.right",
            name: "Back Tap",
            blurb: "Double- or triple-tap the back of your iPhone.",
            whatYouGet: "Tap the back of your phone twice (or three times) to dictate.",
            steps: [
                GuideStep(icon: "gearshape", title: "Settings → Accessibility → Touch",
                          detail: "Scroll to the very bottom of Touch and tap “Back Tap”."),
                GuideStep(icon: "hand.tap.fill", title: "Pick Double Tap or Triple Tap",
                          detail: "Double Tap is quickest; Triple Tap is harder to trigger by accident. You can set both."),
                GuideStep(icon: "square.and.pencil", title: "Choose the Whisperio shortcut",
                          detail: "Scroll down to the Shortcuts section and select Whisperio “Dictate”."),
                GuideStep(icon: "hand.point.up.braille", title: "Tap the back → record → paste",
                          detail: "Tap the back of your iPhone to start. When you’re done, the text is on your clipboard — long-press → Paste."),
            ],
            note: GuideNote(icon: "lock",
                            text: "Back Tap runs a Shortcut, and Shortcuts can’t paste into other apps silently on iOS. Whisperio records, then copies — you paste. Honest and predictable."),
            openSettings: true
        ),
        // 3 — Lock Screen / Control Center (design order: Action Button, Back Tap, Lock Screen &
        // Control Center, Keyboard, Home Screen widget, Dynamic Island — mob-settings.jsx:17-22)
        TriggerGuide(
            id: "control",
            symbol: "switch.2",
            name: "Lock Screen & Control Center",
            blurb: "A Whisperio control, one swipe away.",
            whatYouGet: "Add a Whisperio control to Control Center or the Lock Screen and tap to record.",
            steps: [
                GuideStep(icon: "switch.2", title: "Open Control Center to edit",
                          detail: "Swipe down from the top-right, then press and hold on empty space and tap “Add a Control”."),
                GuideStep(icon: "plus.circle", title: "Add the Whisperio control",
                          detail: "Search “Whisperio” in the control gallery and add “Dictate”. Drag it where you like."),
                GuideStep(icon: "lock.iphone", title: "Or put it on the Lock Screen",
                          detail: "Long-press the Lock Screen → Customize → Lock Screen, tap a control slot and choose Whisperio."),
                GuideStep(icon: "doc.on.clipboard", title: "Tap to record → paste",
                          detail: "Tap the control to record on-device. The transcript is copied to your clipboard for you to paste."),
            ],
            note: GuideNote(icon: "lock",
                            text: "From the Lock Screen and Control Center, Whisperio records and copies to the clipboard — iOS doesn’t allow silent paste into another app, so the last step is yours."),
            openSettings: false
        ),
        // 4 — Custom keyboard
        TriggerGuide(
            id: "keyboard",
            symbol: "keyboard",
            name: "Whisperio keyboard",
            blurb: "A mic key on your keyboard, in every app.",
            whatYouGet: "Tap the mic on the Whisperio keyboard to dictate right where you’re typing.",
            steps: [
                GuideStep(icon: "gearshape", title: "Settings → General → Keyboard",
                          detail: "Open Keyboards → Add New Keyboard… and choose Whisperio."),
                GuideStep(icon: "lock.open", title: "Turn on “Allow Full Access”",
                          detail: "Tap Whisperio in the list and enable Allow Full Access — the mic key needs it to open the app."),
                GuideStep(icon: "globe", title: "Switch to the Whisperio keyboard",
                          detail: "In any text field, hold the 🌐 globe key and pick Whisperio, then tap the mic."),
                GuideStep(icon: "arrow.uturn.backward", title: "Record, then swipe back",
                          detail: "Whisperio opens and records on-device. Swipe back (or tap “← app” top-left) and the text is inserted for you."),
            ],
            note: GuideNote(icon: "keyboard",
                            text: "A keyboard can’t record audio itself, so the mic key BOUNCES to the Whisperio app to listen, then hands the text back when you return. That one swipe back is the only manual step — nothing happens behind your back."),
            openSettings: true
        ),
        // 5 — Home Screen widget
        TriggerGuide(
            id: "widget",
            symbol: "square.grid.2x2",
            name: "Home Screen widget",
            blurb: "A tap-to-dictate tile on your Home Screen.",
            whatYouGet: "Place the Whisperio widget on your Home Screen and tap it to start recording instantly.",
            steps: [
                GuideStep(icon: "hand.tap", title: "Enter jiggle mode",
                          detail: "Touch and hold any empty spot on your Home Screen until the icons wiggle."),
                GuideStep(icon: "plus.circle", title: "Tap “+” → search Whisperio",
                          detail: "Tap the “+” in the top-left, search for Whisperio and pick a widget size."),
                GuideStep(icon: "square.grid.2x2", title: "Add the Dictate widget",
                          detail: "Tap “Add Widget”, then position it and tap Done."),
                GuideStep(icon: "mic.fill", title: "Tap the widget to record",
                          detail: "One tap opens Whisperio recording on-device — no menus, no waiting."),
            ],
            note: GuideNote(icon: "clip",
                            text: "The widget launches recording; the finished transcript is saved in Whisperio and copied to your clipboard so you can paste it anywhere."),
            openSettings: false
        ),
        // 6 — Dynamic Island / Live Activity
        TriggerGuide(
            id: "island",
            symbol: "capsule.portrait",
            name: "Dynamic Island",
            blurb: "Record from anywhere with a live stop control.",
            whatYouGet: "Start dictation and Whisperio lives in the Dynamic Island — with a Stop button — while you use other apps.",
            steps: [
                GuideStep(icon: "mic.fill", title: "Start dictation any way you like",
                          detail: "Action Button, Back Tap, keyboard or widget — recording begins on-device."),
                GuideStep(icon: "capsule.portrait", title: "Watch the Dynamic Island",
                          detail: "A live waveform appears at the top of your screen. Whisperio keeps listening as you switch apps."),
                GuideStep(icon: "hand.tap.fill", title: "Long-press to expand",
                          detail: "Press and hold the Island to see the full Live Activity with your live transcript."),
                GuideStep(icon: "stop.circle", title: "Tap Stop right there",
                          detail: "Hit the Stop control in the Island — no need to return to the app. Your text is saved and copied."),
            ],
            note: GuideNote(icon: "clip",
                            text: "The Dynamic Island gives you a system Stop control from any app. When you stop, the transcript is saved in Whisperio and placed on your clipboard to paste."),
            openSettings: false
        ),
    ]
}

// MARK: - Hub

// "Set up dictation triggers" — lists every trigger with a short blurb; taps drill into a guide.
struct TriggerGuidesView: View {
    @Environment(\.wz) private var t
    var onBack: () -> Void
    @State private var open: TriggerGuide?

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Dictation triggers", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        InfoCard(text: "Whisperio can start a dictation from all over iOS. Set up any of these once, then talk from anywhere — every transcript still lands back in your library.")

                        VStack(alignment: .leading, spacing: 9) {
                            SectionLabel(text: "Available triggers").padding(.leading, 4)
                            VStack(spacing: 0) {
                                ForEach(Array(TriggerGuide.all.enumerated()), id: \.element.id) { idx, g in
                                    hubRow(g, last: idx == TriggerGuide.all.count - 1)
                                }
                            }
                            .padding(.horizontal, 16)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        StateBanner(tone: .ok, icon: "lock",
                                    title: "On-device by default",
                                    sub: "Every trigger records privately on your iPhone. Your words never leave unless you turn on a cloud engine.")

                        Text("Honest by design: iOS never lets one app type into another for you. Most triggers copy your words to the clipboard so you paste them; the keyboard bounces to Whisperio and swipes back. Nothing happens behind your back.")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
        .sheet(item: $open) { g in
            TriggerGuideDetail(guide: g, onClose: { open = nil })
                .environment(\.wz, t)
                .preferredColorScheme(t.dark ? .dark : .light)
                #if os(iOS)
                .presentationDetents([.large])
                #endif
        }
    }

    private func hubRow(_ g: TriggerGuide, last: Bool) -> some View {
        Button { open = g } label: {
            HStack(spacing: 13) {
                Image(systemName: g.symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(t.accentLite)
                    .frame(width: 34, height: 34)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(g.name).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                    Text(g.blurb).font(WZFont.ui(12)).foregroundStyle(t.muted).lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                WIcon("chevR", size: 17, weight: .regular).foregroundStyle(t.faint)
            }
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { if !last { Rectangle().fill(t.lineSoft).frame(height: 1) } }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Guide detail

// One clear, numbered, visual guide for a single trigger.
private struct TriggerGuideDetail: View {
    @Environment(\.wz) private var t
    let guide: TriggerGuide
    var onClose: () -> Void

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: guide.name) {
                    Button(action: onClose) {
                        WIcon("x", size: 15).foregroundStyle(t.muted)
                            .frame(width: 34, height: 34)
                            .background(t.surfaceUp, in: Circle())
                            .overlay(Circle().stroke(t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        hero

                        VStack(alignment: .leading, spacing: 9) {
                            SectionLabel(text: "Step by step").padding(.leading, 4)
                            VStack(spacing: 0) {
                                ForEach(Array(guide.steps.enumerated()), id: \.offset) { idx, s in
                                    stepRow(idx + 1, s, last: idx == guide.steps.count - 1)
                                }
                            }
                            .padding(.horizontal, 16)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        if guide.openSettings {
                            GradButton(title: "Open Settings", icon: "settings") { openSettings() }
                                .fixedSize()
                        }

                        honestNote

                        HStack(spacing: 6) {
                            WIcon("lock", size: 12).foregroundStyle(t.green)
                            Text("Records on-device by default")
                                .font(WZFont.mono(11.5)).foregroundStyle(t.green)
                            Spacer(minLength: 0)
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
    }

    private var hero: some View {
        HStack(spacing: 14) {
            Image(systemName: guide.symbol)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 54, height: 54)
                .background(t.gradient, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: "What you get")
                Text(guide.whatYouGet).font(WZFont.ui(14, .medium)).foregroundStyle(t.text)
                    .lineSpacing(2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func stepRow(_ n: Int, _ s: GuideStep, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 13) {
            ZStack {
                Circle().fill(t.accent.opacity(t.dark ? 0.16 : 0.10))
                    .overlay(Circle().stroke(t.hair, lineWidth: 1))
                    .frame(width: 30, height: 30)
                Text("\(n)").font(WZFont.mono(13, .semibold)).foregroundStyle(t.accentLite)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Image(systemName: s.icon)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(t.accentLite)
                    Text(s.title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                }
                Text(s.detail).font(WZFont.ui(12.5)).foregroundStyle(t.muted).lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(t.lineSoft).frame(height: 1) } }
    }

    private var honestNote: some View {
        HStack(alignment: .top, spacing: 11) {
            WIcon(guide.note.icon, size: 16, weight: .regular).foregroundStyle(t.amber).padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text("The honest bit").font(WZFont.ui(13, .semibold)).foregroundStyle(t.text)
                Text(guide.note.text).font(WZFont.ui(12.5)).foregroundStyle(t.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.amber.opacity(t.dark ? 0.10 : 0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.amber.opacity(t.dark ? 0.26 : 0.24), lineWidth: 1))
    }

    private func openSettings() {
#if canImport(UIKit)
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
#endif
    }
}
