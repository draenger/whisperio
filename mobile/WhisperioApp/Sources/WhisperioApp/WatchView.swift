import SwiftUI

// Apple Watch — capture a memo on the wrist; saved locally, syncs to iPhone when nearby;
// transcribe later. (Port of WZWatch, wz-scenes.jsx.) Transcription is offloaded to the phone.
struct WatchMemo: Identifiable {
    let id: Int
    var txt: String
    var synced: Bool
}

struct WatchView: View {
    @Environment(\.wz) private var t
    @State private var stage = "home"   // home | rec
    @State private var secs = 0
    @State private var nextId = 100
    @State private var memos: [WatchMemo] = [
        .init(id: 1, txt: "Call the dentist Tuesday morning", synced: true),
        .init(id: 2, txt: "Book idea — a chapter on tides", synced: true),
        .init(id: 3, txt: "Move the 1:1 to Thursday", synced: false)
    ]
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if stage == "home" { home } else { recording }
        }
        .onReceive(tick) { _ in if stage == "rec" { secs += 1 } }
    }

    private var home: some View {
        VStack(spacing: 9) {
            HStack {
                HStack(spacing: 5) { WGhost(size: 15, tint: .white); Text("Whisperio").font(WZFont.display(13)).foregroundStyle(.white) }
                Spacer()
                Text("9:41").font(WZFont.mono(10)).foregroundStyle(t.green)
            }
            Button { start() } label: {
                HStack(spacing: 9) {
                    WIcon("mic", size: 16).foregroundStyle(.white)
                        .frame(width: 30, height: 30).background(.white.opacity(0.22), in: Circle())
                    Text("Tap to\nrecord").font(WZFont.display(14)).foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(LinearGradient(colors: [.hex(0xa78bfa), .hex(0x6366f1)], startPoint: .leading, endPoint: .trailing),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(memos) { m in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(m.txt).font(.system(size: 11.5)).foregroundStyle(Color.hex(0xECEBF4))
                                .lineLimit(2).multilineTextAlignment(.leading)
                            HStack(spacing: 4) {
                                WIcon(m.synced ? "check" : "sync", size: 10, weight: .regular)
                                Text(m.synced ? "Synced to iPhone" : "Saved · syncs when nearby")
                            }
                            .font(WZFont.mono(9)).foregroundStyle(m.synced ? t.green : t.amber)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.hex(0x15131c), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    }
                }
            }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 8)
    }

    private var recording: some View {
        VStack(spacing: 0) {
            Text("RECORDING").font(WZFont.mono(10)).tracking(1).foregroundStyle(Color.hex(0xa78bfa))
            Text(String(format: "0:%02d", secs % 60)).font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.white).monospacedDigit().padding(.vertical, 8)
            Waveform(color: .hex(0xa78bfa), bars: 18, height: 36)
            Button(action: stop) {
                WIcon("stop", size: 20).foregroundStyle(.white)
                    .frame(width: 54, height: 54).background(t.red, in: Circle())
                    .overlay(Circle().stroke(t.red.opacity(0.18), lineWidth: 6))
            }
            .buttonStyle(.plain).padding(.top, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RadialGradient(colors: [.hex(0x2a1d4d), .black], center: .init(x: 0.5, y: 0.38), startRadius: 10, endRadius: 180).ignoresSafeArea())
    }

    private func start() { stage = "rec"; secs = 0 }
    private func stop() {
        let id = nextId; nextId += 1
        let captured = secs
        stage = "home"
        memos.insert(.init(id: id, txt: "New voice memo · \(captured)s", synced: false), at: 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
            if let idx = memos.firstIndex(where: { $0.id == id }) {
                withAnimation { memos[idx].synced = true }
            }
        }
    }
}
