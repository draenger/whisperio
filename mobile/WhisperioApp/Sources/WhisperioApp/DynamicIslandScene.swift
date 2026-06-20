import SwiftUI

// Dynamic Island / Live Activity — record from anywhere with a system-level stop control.
// (wz-scenes.jsx) Expanded recording pill over a home-screen mock; collapses to a "saved" pill.
struct DynamicIslandScene: View {
    @Environment(\.wz) private var t
    @State private var rec = true
    @State private var secs = 7
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private let apps = ["Messages", "Mail", "Notes", "Safari", "Calendar", "Maps", "Photos", "Music"]
    private let appColors: [Color] = [.hex(0x34c759), .hex(0x1f9bf5), .hex(0xffd60a), .hex(0x0a84ff),
                                      .hex(0xff453a), .hex(0x30d158), .hex(0xff375f), .hex(0xfa2d6e)]

    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [.hex(0x2a1d4d), .hex(0x0a0911)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 22), count: 4), spacing: 22) {
                    ForEach(Array(apps.enumerated()), id: \.offset) { i, a in
                        VStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 15, style: .continuous).fill(appColors[i]).opacity(0.92)
                                .frame(width: 58, height: 58)
                            Text(a).font(.system(size: 11)).foregroundStyle(.white.opacity(0.85))
                        }
                    }
                }
                .padding(.horizontal, 30).padding(.top, 120)
                Spacer()
                // dock
                HStack(spacing: 0) {
                    ForEach(Array([Color.hex(0x1f9bf5), .hex(0x34c759), .hex(0xff9f0a)].enumerated()), id: \.offset) { _, c in
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(c).frame(width: 56, height: 56)
                            .frame(maxWidth: .infinity)
                    }
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(t.gradient).frame(width: 56, height: 56)
                        .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 18).frame(height: 86)
                .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 32, style: .continuous))
                .padding(.horizontal, 16).padding(.bottom, 34)
            }
            island
        }
        .onReceive(tick) { _ in if rec { secs += 1 } }
    }

    private var island: some View {
        Group {
            if rec {
                HStack(spacing: 14) {
                    ZStack {
                        Circle().fill(t.gradient).frame(width: 40, height: 40)
                            .overlay(WGhost(size: 22, tint: .white))
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 7) {
                            Circle().fill(t.red).frame(width: 7, height: 7)
                            Text("Recording").font(WZFont.display(13.5)).foregroundStyle(.white)
                            Text("on-device").font(WZFont.mono(11)).foregroundStyle(.white.opacity(0.6))
                        }
                        Waveform(color: .hex(0xa78bfa), bars: 20, height: 20)
                    }
                    Text(String(format: "0:%02d", secs % 60)).font(WZFont.mono(14)).foregroundStyle(.white).monospacedDigit()
                    Button { withAnimation { rec = false } } label: {
                        WIcon("stop", size: 16).foregroundStyle(.white)
                            .frame(width: 40, height: 40).background(t.red, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 18).padding(.vertical, 13)
                .background(.black, in: RoundedRectangle(cornerRadius: 34, style: .continuous))
                .frame(width: 364)
                .padding(.top, 8)
            } else {
                Button { withAnimation { rec = true; secs = 0 } } label: {
                    HStack(spacing: 9) {
                        WIcon("check", size: 14).foregroundStyle(Color.hex(0x04231a))
                            .frame(width: 24, height: 24).background(t.green, in: Circle())
                        Text("Saved · tap to record").font(WZFont.mono(12)).foregroundStyle(.white)
                    }
                    .padding(.horizontal, 16).frame(height: 37)
                    .background(.black, in: Capsule())
                }
                .buttonStyle(.plain).padding(.top, 11)
            }
        }
    }
}
