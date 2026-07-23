#if os(macOS)
import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreGraphics

// Native port of desktop/src/main/dictation/hotkeyManager.ts's activateOutput() (:158): records
// the SYSTEM OUTPUT audio (whatever is currently playing) instead of the microphone, so a
// meeting/video's audio can be dictated the same way LiveDictation captures the mic. Electron
// had no direct equivalent to reach for here since it shelled out to a native helper; this is a
// from-scratch ScreenCaptureKit capture, gated on the same "Screen Recording" TCC permission
// system audio capture requires on macOS (SCStream's audio-only capture still needs it).
//
// SCStream requires at least one video output on macOS 13/14 even for an audio-only capture, so
// this installs a throwaway 2x2 video output with a large `minimumFrameInterval` purely to
// satisfy that requirement — its frames are always dropped.
@MainActor
final class MacSystemAudioCapture: NSObject {
    private var stream: SCStream?
    private var audioFile: AVAudioFile?
    private var fileURL: URL?
    private let audioOutputQueue = DispatchQueue(label: "wz.mac.systemaudio.audio")
    private let videoOutputQueue = DispatchQueue(label: "wz.mac.systemaudio.video")

    // MARK: - Permission (Screen Recording / TCC)

    /// True if Whisperio already has Screen Recording access. Mirrors `MacAutoPaste`'s
    /// Accessibility check but for the CoreGraphics screen-capture TCC bucket ScreenCaptureKit
    /// audio capture is gated behind.
    static func hasPermission() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Prompts the system Screen Recording permission sheet (first call only) and returns the
    /// resulting access state. Note: macOS typically only grants this after the app is
    /// relaunched — a caller that gets `false` back right after prompting should tell the user to
    /// restart Whisperio, not just retry.
    @discardableResult
    static func requestPermission() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    // MARK: - Capture lifecycle

    /// Begins capturing system output audio to a temp file. Throws if no shareable display is
    /// found or SCStream setup fails.
    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "MacSystemAudioCapture", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "No shareable display found"])
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1
        // Minimal, effectively-inert video track — required by SCStream but never consumed.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 3

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioOutputQueue)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoOutputQueue)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("wz-output-\(UUID().uuidString)")
            .appendingPathExtension("caf")
        fileURL = url
        self.stream = stream

        try await stream.startCapture()
    }

    /// Stops capture and returns the recorded file's URL (nil if nothing was ever written —
    /// e.g. the source produced no audio samples before stop() was called).
    func stop() async -> URL? {
        if let stream {
            try? await stream.stopCapture()
        }
        stream = nil
        audioFile = nil
        let url = fileURL
        fileURL = nil
        guard let url, FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    /// Stops capture (if running) and deletes the temp file — mirrors hotkeyManager.ts's
    /// cancel() discarding in-flight audio rather than transcribing it.
    func cancel() async {
        if let stream {
            try? await stream.stopCapture()
        }
        stream = nil
        audioFile = nil
        if let fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }
        fileURL = nil
    }
}

// MARK: - SCStreamOutput

extension MacSystemAudioCapture: SCStreamOutput {
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let pcmBuffer = sampleBuffer.asPCMBuffer else { return }
        Task { @MainActor in
            self.appendAudio(pcmBuffer)
        }
    }

    private func appendAudio(_ buffer: AVAudioPCMBuffer) {
        guard let fileURL else { return }
        if audioFile == nil {
            audioFile = try? AVAudioFile(forWriting: fileURL, settings: buffer.format.settings)
        }
        try? audioFile?.write(from: buffer)
    }
}

// MARK: - CMSampleBuffer → AVAudioPCMBuffer

private extension CMSampleBuffer {
    /// Builds an `AVAudioFormat` from this sample buffer's ASBD and copies its audio data into a
    /// fresh `AVAudioPCMBuffer` so it can be appended to an `AVAudioFile`.
    var asPCMBuffer: AVAudioPCMBuffer? {
        guard let formatDescription = CMSampleBufferGetFormatDescription(self),
              let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return nil
        }
        let format = AVAudioFormat(streamDescription: asbdPointer)
        guard let format else { return nil }

        let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(self))
        guard frameCount > 0,
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            return nil
        }
        pcmBuffer.frameLength = frameCount

        guard let blockBuffer = CMSampleBufferGetDataBuffer(self) else { return nil }
        var lengthAtOffset = 0
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(
            blockBuffer, atOffset: 0, lengthAtOffsetOut: &lengthAtOffset,
            totalLengthOut: &totalLength, dataPointerOut: &dataPointer
        ) == noErr, let dataPointer else {
            return nil
        }

        if let floatData = pcmBuffer.floatChannelData {
            dataPointer.withMemoryRebound(to: Float.self, capacity: totalLength / MemoryLayout<Float>.size) { src in
                floatData[0].update(from: src, count: Int(frameCount) * Int(format.channelCount))
            }
        } else if let int16Data = pcmBuffer.int16ChannelData {
            dataPointer.withMemoryRebound(to: Int16.self, capacity: totalLength / MemoryLayout<Int16>.size) { src in
                int16Data[0].update(from: src, count: Int(frameCount) * Int(format.channelCount))
            }
        } else {
            return nil
        }
        return pcmBuffer
    }
}
#endif
