import SwiftUI

// wz3 "In use now" chip pair (REDESIGN.md §1) — the two active engines shown at the top of the
// on-device models screen. CHOSEN STYLE = C · Minimal flat: quiet, app-native, lowest visual risk,
// matching the current Settings language (surfaceUp icon tile + hairline border, mono eyebrow,
// UI-semibold provider, mono muted model line, a small privacy pill on the right). No signature
// mark / circuit / PCB flourishes — those A/B/D variants were rejected.

/// One engine row. Renders whatever REAL state the caller resolves — this view holds no engine
/// knowledge itself, so the STT/LLM resolution stays in `ModelsView` (which owns settings) and this
/// file stays a pure presentation type. `icon` defaults to a device/cloud glyph derived from
/// `isCloud`; callers may override it (e.g. "spark" for the language model row).
struct InUseChip: View {
    @Environment(\.wz) private var t
    let eyebrow: String
    let provider: String
    let model: String
    let isCloud: Bool
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 12) {
            WIcon(icon ?? (isCloud ? "cloud" : "cpu"), size: 17)
                .foregroundStyle(t.accentLite)
                .frame(width: 38, height: 38)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(t.line, lineWidth: 1))
            VStack(alignment: .leading, spacing: 2) {
                Text(eyebrow)
                    .font(WZFont.mono(9, .semibold)).tracking(0.6)
                    .textCase(.uppercase).foregroundStyle(t.faint)
                Text(provider)
                    .font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                    .lineLimit(1).minimumScaleFactor(0.85)
                Text(model)
                    .font(WZFont.mono(10.5)).foregroundStyle(t.muted)
                    .lineLimit(1).minimumScaleFactor(0.85)
            }
            Spacer(minLength: 8)
            InUseBadge(isCloud: isCloud)
        }
        .padding(.vertical, 11)
    }
}

/// The trailing privacy pill — green "▪ on-device" / amber "◆ cloud" (REDESIGN.md §1). Kept in the
/// same quiet capsule idiom as `PrivacyBadge` but with the design's mono ~9 glyph label rather than
/// the lock/cloud icon, so it reads as a compact status tag inside the chip rather than a full badge.
struct InUseBadge: View {
    @Environment(\.wz) private var t
    let isCloud: Bool
    var body: some View {
        let c = isCloud ? t.amber : t.green
        Text(isCloud ? "◆ cloud" : "▪ on-device")
            .font(WZFont.mono(9, .semibold))
            .foregroundStyle(c)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(c.opacity(t.dark ? 0.12 : 0.09), in: Capsule())
            .overlay(Capsule().stroke(c.opacity(t.dark ? 0.28 : 0.25), lineWidth: 1))
            .fixedSize()
    }
}

/// Stacks the STT chip over the LLM chip inside a titled "In use now" group. Matches `SettGroup`
/// styling (SectionLabel + surface card with a hairline border); a soft divider separates the two
/// rows, same as `SettRow`'s inter-row line. Data-only — the caller builds both chips from real
/// settings state.
struct InUseNowPanel: View {
    @Environment(\.wz) private var t
    let stt: InUseChip
    let llm: InUseChip

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "In use now").padding(.leading, 4)
            VStack(spacing: 0) {
                stt
                    .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
                llm
            }
            .padding(.horizontal, 16)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}
