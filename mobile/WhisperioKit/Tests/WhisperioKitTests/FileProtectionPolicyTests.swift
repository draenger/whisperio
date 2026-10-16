import Testing
import Foundation
@testable import WhisperioKit

@Suite struct FileProtectionPolicyTests {
    @Test func reopenedFilesGetUntilFirstUserAuthentication() {
        for kind in [FileProtectionPolicy.Kind.liveRecording, .watchClip, .jsonFallback, .tempCopy] {
            #expect(FileProtectionPolicy.classFor(kind) == .completeUntilFirstUserAuthentication)
            #expect(FileProtectionPolicy.classFor(kind, protectedDataAvailable: false) == .completeUntilFirstUserAuthentication)
        }
    }

    @Test func keptClipIsCompleteOnlyWhenProtectedDataAvailable() {
        #expect(FileProtectionPolicy.classFor(.keptClip, protectedDataAvailable: true) == .complete)
        #expect(FileProtectionPolicy.classFor(.keptClip, protectedDataAvailable: false) == .completeUntilFirstUserAuthentication)
    }

    @Test func onlyWriteOnceWatchClipUsesUnlessOpen() {
        for kind in FileProtectionPolicy.Kind.allCases {
            let c = FileProtectionPolicy.classFor(kind)
            #expect((c == .completeUnlessOpen) == (kind == .watchKeptClipWrite))
        }
    }

    @Test func jsonGuardBlocksSavesAfterFailedLoadUntilReloaded() {
        var g = JSONFallbackGuard()
        #expect(g.saveAllowed)
        g.markLoadFailed()
        #expect(!g.saveAllowed)
        g.markLoaded()
        #expect(g.saveAllowed)
    }
}
