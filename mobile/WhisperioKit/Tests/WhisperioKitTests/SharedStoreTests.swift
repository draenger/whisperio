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

    @Test func lastInsertedFreshSurvivesStaleIsPurged() {
        SharedStore.clearAllTranscripts()
        SharedStore.setLastInsertedTranscript("rewrite me")
        SharedStore.purgeStaleLastInsertedTranscript(maxAge: 600)
        #expect(SharedStore.lastInsertedTranscript == "rewrite me")
        SharedStore.purgeStaleLastInsertedTranscript(maxAge: -1)
        #expect(SharedStore.lastInsertedTranscript == nil)
    }

    @Test func purgeStalePendingAlsoPurgesLastInserted() {
        SharedStore.clearAllTranscripts()
        SharedStore.setLastInsertedTranscript("old")
        SharedStore.purgeStalePendingTranscript(maxAge: -1)
        #expect(SharedStore.lastInsertedTranscript == nil)
    }

    @Test func clearAllTranscriptsWipesBoth() {
        SharedStore.setPendingTranscript("p")
        SharedStore.setLastInsertedTranscript("l")
        SharedStore.clearAllTranscripts()
        #expect(!SharedStore.hasPendingTranscript)
        #expect(SharedStore.lastInsertedTranscript == nil)
    }

    @Test func clearAllTranscriptsRemovesRewriteKeys() {
        SharedStore.setRewriteSource("src")
        SharedStore.setRewritePresetID("preset")
        SharedStore.setRewriteResult("result")
        SharedStore.clearAllTranscripts()
        #expect(SharedStore.consumeRewriteSource() == nil)
        #expect(SharedStore.consumeRewritePresetID() == nil)
        #expect(SharedStore.consumeRewriteResult() == nil)
    }

    @Test func purgeDropsStaleRewriteResult() {
        SharedStore.clearAllTranscripts()
        SharedStore.setRewriteResult("result")
        SharedStore.purgeStalePendingTranscript(maxAge: 600)
        #expect(SharedStore.consumeRewriteResult() == "result")   // fresh survives
        SharedStore.setRewriteResult("result")
        SharedStore.purgeStalePendingTranscript(maxAge: -1)
        #expect(SharedStore.consumeRewriteResult() == nil)
        SharedStore.clearAllTranscripts()
    }

    // MARK: - Dictation origin (audit L2: insert only into the field the dictation started in)

    @Test func originMatchesSameDocumentID() {
        let a = KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "Hi Anna, ")
        let b = KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "Hi Anna, typed more")
        #expect(SharedStore.originMatches(origin: a, current: b))
    }

    @Test func originMatchesSameNonEmptyContextWhenIDsDiffer() {
        let a = KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "Hi Anna, ")
        let b = KeyboardFieldFingerprint(documentID: "doc-2", contextTail: "Hi Anna, ")
        #expect(SharedStore.originMatches(origin: a, current: b))
    }

    @Test func originRejectsDifferentFieldAndUnknownOrigin() {
        let a = KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "Hi Anna, ")
        let other = KeyboardFieldFingerprint(documentID: "doc-2", contextTail: "Hey boss ")
        #expect(!SharedStore.originMatches(origin: a, current: other))
        // Two empty fields in different documents are NOT proof of the same field.
        let emptyA = KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "")
        let emptyB = KeyboardFieldFingerprint(documentID: "doc-2", contextTail: "")
        #expect(!SharedStore.originMatches(origin: emptyA, current: emptyB))
        #expect(!SharedStore.originMatches(origin: nil, current: a))
    }

    @Test func fingerprintStoresOnlyAHashOfTheLast64Chars() {
        let long = String(repeating: "x", count: 100) + "tail"
        let fp = KeyboardFieldFingerprint(documentID: nil, contextTail: long)
        #expect(fp == KeyboardFieldFingerprint(documentID: nil, contextTail: String(long.suffix(64))))
        #expect(!fp.contextHash.contains("tail"))
        #expect(fp.contextHash.count == 64)   // hex SHA-256
        #expect(KeyboardFieldFingerprint(documentID: nil, contextTail: "").contextHash.isEmpty)
    }

    @Test func originRoundTripsAndIsClearedWithPendingTranscript() {
        SharedStore.clearAllTranscripts()
        let fp = KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "Hi Anna, ")
        SharedStore.setDictationOrigin(fp)
        #expect(SharedStore.dictationOrigin == fp)
        SharedStore.setPendingTranscript("hello")
        #expect(SharedStore.consumePendingTranscript() == "hello")
        #expect(SharedStore.dictationOrigin == nil)   // consumed together with the transcript
    }

    @Test func peekDoesNotConsume() {
        SharedStore.clearAllTranscripts()
        SharedStore.setPendingTranscript("held")
        #expect(SharedStore.peekPendingTranscript() == "held")
        #expect(SharedStore.peekPendingTranscript() == "held")
        #expect(SharedStore.peekPendingTranscript(maxAge: -1) == nil)   // stale peek purges
        #expect(!SharedStore.hasPendingTranscript)
    }

    @Test func staleOriginIsPurgedAndEraseAllClearsIt() {
        SharedStore.clearAllTranscripts()
        SharedStore.setDictationOrigin(KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "abc"))
        SharedStore.purgeStalePendingTranscript(maxAge: 600)
        #expect(SharedStore.dictationOrigin != nil)
        SharedStore.purgeStalePendingTranscript(maxAge: -1)
        #expect(SharedStore.dictationOrigin == nil)
        SharedStore.setDictationOrigin(KeyboardFieldFingerprint(documentID: "doc-1", contextTail: "abc"))
        SharedStore.clearAllTranscripts()
        #expect(SharedStore.dictationOrigin == nil)
    }
}
