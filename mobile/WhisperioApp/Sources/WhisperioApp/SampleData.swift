import Foundation

// UI sample data, mirroring wz-core.jsx (WZ_RECS / WZ_MODELS). These are display models
// for the prototype screens; real data will come from WhisperioKit (Recording, Settings)
// once the record loop is wired on the Mac.

struct DemoRecording: Identifiable {
    let id: Int
    let title: String
    let src: String       // keyboard | action | watch | backtap | app
    let app: String
    let dur: String
    let when: String
    let words: Int
    let engine: String    // on-device | cloud
    var category: String = WZCategories.work.id   // WZCategory id (see Categories.swift)
}

enum WZSample {
    static let recordings: [DemoRecording] = [
        .init(id: 1, title: "Refactor the auth module to use JWT tokens and add refresh-token rotation",
              src: "keyboard", app: "Terminal", dur: "0:09", when: "Just now", words: 14, engine: "on-device",
              category: WZCategories.code.id),
        .init(id: 2, title: "Reply: Thanks for the update — let’s push the launch to next Thursday so QA has a full cycle.",
              src: "action", app: "Mail", dur: "0:12", when: "2m ago", words: 19, engine: "on-device",
              category: WZCategories.work.id),
        .init(id: 3, title: "Idea: a weekly digest that summarizes every voice note into three bullet points.",
              src: "watch", app: "Synced from Watch", dur: "0:07", when: "14m ago", words: 13, engine: "on-device",
              category: WZCategories.ideas.id),
        .init(id: 4, title: "Grocery: oat milk, sourdough, the good olive oil, lemons, and coffee beans.",
              src: "backtap", app: "Notes", dur: "0:06", when: "1h ago", words: 11, engine: "on-device",
              category: WZCategories.todo.id),
        .init(id: 5, title: "Standup notes — shipped the export pipeline, blocked on the staging cert, pairing with Mara after lunch.",
              src: "app", app: "In-app", dur: "0:15", when: "Yesterday", words: 18, engine: "cloud",
              category: WZCategories.work.id),
        .init(id: 6, title: "Text Sam: running ten late, grab us a table by the window if you can.",
              src: "keyboard", app: "Messages", dur: "0:05", when: "Yesterday", words: 14, engine: "on-device",
              category: WZCategories.messages.id)
    ]
}

struct DemoModel: Identifiable {
    let id: String
    let name: String
    let sub: String
    let size: String
    let state: String     // active | ready | downloading | get
    var tag: String? = nil
    var pct: Int? = nil
}

extension WZSample {
    static let models: [DemoModel] = [
        .init(id: "apple", name: "Apple Speech", sub: "Built-in · on-device", size: "System", state: "active", tag: "Default"),
        .init(id: "apple-int", name: "Apple Intelligence", sub: "Cleanup & summaries · on-device", size: "System", state: "ready", tag: "A17+ / M-series"),
        .init(id: "whisper-s", name: "Whisper small", sub: "Higher accuracy · 99 languages", size: "466 MB", state: "ready"),
        .init(id: "whisper-b", name: "Whisper base", sub: "Balanced · multilingual", size: "142 MB", state: "downloading", pct: 64),
        .init(id: "whisper-t", name: "Whisper tiny", sub: "Fastest · English", size: "75 MB", state: "get")
    ]
}
