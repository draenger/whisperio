import WidgetKit
import SwiftUI
import AppIntents

// One-tap dictation triggers: a Home/Lock-Screen widget button and a Control
// Center control. Both run DictateIntent, which opens Whisperio straight into
// recording — no Back Tap setup needed.

struct DictateEntry: TimelineEntry { let date: Date }

struct DictateProvider: TimelineProvider {
    func placeholder(in context: Context) -> DictateEntry { DictateEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (DictateEntry) -> Void) {
        completion(DictateEntry(date: .now))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DictateEntry>) -> Void) {
        completion(Timeline(entries: [DictateEntry(date: .now)], policy: .never))
    }
}

struct DictateWidgetView: View {
    @Environment(\.widgetFamily) private var family
    // Rezme teal accent (#1cc8b4) — matches WZTheme.rezmeTheme.accent. The widget extension
    // doesn't link the app module, so the value is mirrored here rather than imported.
    private let accent = Color(red: 28 / 255, green: 200 / 255, blue: 180 / 255)

    var body: some View {
        Button(intent: DictateIntent()) {
            switch family {
            case .accessoryCircular:
                Image(systemName: "mic.fill").font(.system(size: 22, weight: .bold))
            case .accessoryRectangular:
                HStack(spacing: 6) {
                    Image(systemName: "mic.fill").font(.system(size: 16, weight: .bold))
                    Text("Dictate").font(.system(size: 15, weight: .semibold))
                }
            default:
                VStack(spacing: 8) {
                    Image(systemName: "mic.fill").font(.system(size: 30, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(accent, in: Circle())
                    Text("Dictate").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct DictateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioDictate", provider: DictateProvider()) { _ in
            DictateWidgetView()
        }
        .configurationDisplayName("Dictate")
        .description("Tap to start a Whisperio dictation.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .systemSmall])
    }
}

@available(iOS 18.0, *)
struct DictateControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "WhisperioDictateControl") {
            ControlWidgetButton(action: DictateIntent()) {
                Label("Dictate", systemImage: "mic.fill")
            }
        }
        .displayName("Whisperio Dictate")
        .description("Start a Whisperio dictation.")
    }
}

@main
struct WhisperioWidgetBundle: WidgetBundle {
    var body: some Widget {
        DictateWidget()
        if #available(iOS 18.0, *) {
            DictateControl()
        }
    }
}
