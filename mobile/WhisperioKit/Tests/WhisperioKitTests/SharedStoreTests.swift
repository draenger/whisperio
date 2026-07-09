import Testing
import Foundation
@testable import WhisperioKit

// Serialized: every case mutates the same App Group UserDefaults suite, so they must not
// run in parallel against shared global state.
@Suite(.serialized) struct SharedStoreTests {
    @Test func consumeReturnsOnceThenClears() {
        SharedStore.clearPendingTranscript()
        SharedStore.setPendingTranscript("hello")
        #expect(SharedStore.hasPendingTranscript)
        #expect(SharedStore.consumePendingTranscript() == "hello")
        // Consumed → gone; a second read yields nothing.
        #expect(!SharedStore.hasPendingTranscript)
        #expect(SharedStore.consumePendingTranscript() == nil)
    }

    @Test func staleTranscriptIsRejectedAndCleared() {
        SharedStore.clearPendingTranscript()
        SharedStore.setPendingTranscript("old")
        // maxAge in the past forces the just-written entry to count as stale.
        #expect(SharedStore.consumePendingTranscript(maxAge: -1) == nil)
        #expect(!SharedStore.hasPendingTranscript)   // stale read also purged it
    }

    @Test func purgeKeepsFreshButDropsStale() {
        SharedStore.clearPendingTranscript()
        SharedStore.setPendingTranscript("draft")
        // Generous window: a fresh transcript awaiting swipe-back must survive.
        SharedStore.purgeStalePendingTranscript(maxAge: 600)
        #expect(SharedStore.hasPendingTranscript)
        // Past window: it must be eagerly dropped, not merely hidden.
        SharedStore.purgeStalePendingTranscript(maxAge: -1)
        #expect(!SharedStore.hasPendingTranscript)
    }
}
