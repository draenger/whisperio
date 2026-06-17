// swift-tools-version: 6.0
import PackageDescription

// WhisperioKit — platform-agnostic domain core for the Whisperio mobile apps.
// Pure Swift (Foundation only); no UIKit/SwiftUI/AVFoundation so it stays unit-testable
// with `swift test` on any Apple platform and free of design/UI coupling.
let package = Package(
    name: "WhisperioKit",
    platforms: [.iOS(.v17), .macOS(.v14), .watchOS(.v10)],
    products: [
        .library(name: "WhisperioKit", targets: ["WhisperioKit"])
    ],
    targets: [
        .target(name: "WhisperioKit"),
        .testTarget(name: "WhisperioKitTests", dependencies: ["WhisperioKit"])
    ]
)
