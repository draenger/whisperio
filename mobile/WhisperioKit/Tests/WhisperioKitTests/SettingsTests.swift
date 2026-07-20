import Testing
import Foundation
@testable import WhisperioKit

@Suite struct SettingsTests {
    @Test func defaultsPutOnDeviceFirstAndNoSecrets() {
        let s = WhisperioSettings()
        #expect(s.primaryProvider == .onDevice)
        // The default order is the classic implicit chain, one modelless slot per engine.
        #expect(s.modelOrder.map(\.provider) == WhisperioSettings.classicOrder)
        #expect(s.modelOrder.allSatisfy { $0.model.isEmpty })
        #expect(s.openAIKey.isEmpty)
        #expect(s.elevenLabsKey.isEmpty)
    }

    @Test func localWhisperIsOnDeviceButOptInOnly() {
        let s = WhisperioSettings()
        // On-device classification: never cloud-gated, same as Apple Speech.
        #expect(s.isCloud(.localWhisper) == false)
        // Deliberately NOT in the default fallback chain — a local Whisper model requires an
        // explicit user download before it's usable, so it must never silently become a default
        // fallback candidate for every existing/new user. It's opt-in via the Model-order UI
        // once a model is actually downloaded.
        #expect(!WhisperioSettings.classicOrder.contains(.localWhisper))
        #expect(!s.modelOrder.map(\.provider).contains(.localWhisper))
        // A modelless .localWhisper slot resolves to the configured local model default.
        #expect(s.selectedModel(for: .localWhisper) == "openai_whisper-base")
    }

    @Test func codableRoundTrips() throws {
        let original = WhisperioSettings(
            providerChain: [.onDevice, .openAI],
            openAIKey: "x",
            language: "pl",
            customVocabulary: "git, TypeScript",
            cleanupEnabled: true
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded == original)
    }

    // MARK: - Model order (provider + model slots)

    @Test func modelOrderRoundTripsWithPinnedModels() throws {
        let original = WhisperioSettings(modelOrder: [
            ProviderSlot(provider: .onDevice),
            ProviderSlot(provider: .groq, model: "whisper-large-v3-turbo"),
            ProviderSlot(provider: .groq, model: "whisper-large-v3"),
            ProviderSlot(provider: .openAI, model: "whisper-1"),
        ])
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded == original)
        #expect(decoded.modelOrder.count == 4)
        #expect(decoded.primaryProvider == .onDevice)
        // The same provider may hold several slots with different models.
        #expect(decoded.modelOrder.filter { $0.provider == .groq }.count == 2)
    }

    // A pre-slot blob (primary providerChain + ordered fallbackChain) migrates into the
    // equivalent slots: primary first, then each fallback engine once, primary deduped.
    @Test func legacyChainMigratesIntoEquivalentSlots() throws {
        let legacy = Data("""
        {"providerChain": ["groq"], "fallbackChain": ["ondevice", "groq", "openai"]}
        """.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.modelOrder.map(\.provider) == [.groq, .onDevice, .openAI])
        #expect(decoded.primaryProvider == .groq)
        // Migrated slots stay modelless so they keep following the per-engine selection.
        #expect(decoded.modelOrder.allSatisfy { $0.model.isEmpty })
    }

    // A legacy blob without any chain keys falls back to the classic order.
    @Test func legacyBlobWithoutChainsFallsBackToClassicOrder() throws {
        let legacy = Data(#"{"openAIKey": "x"}"#.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.modelOrder.map(\.provider) == WhisperioSettings.classicOrder)
    }

    // A slot's pinned model wins at transcription time; a modelless slot resolves to the
    // engine's per-engine selected model.
    @Test func resolvedModelPrefersTheSlotThenTheEngineSelection() {
        let s = WhisperioSettings(groqModel: "whisper-large-v3-turbo")
        #expect(s.resolvedModel(for: ProviderSlot(provider: .groq, model: "distil-whisper")) == "distil-whisper")
        #expect(s.resolvedModel(for: ProviderSlot(provider: .groq)) == "whisper-large-v3-turbo")
        #expect(s.resolvedModel(for: ProviderSlot(provider: .onDevice)).isEmpty)
    }

    // The compatibility setter (`providerChain = [id]`) keeps its old "pick the engine"
    // meaning: the engine's existing slot moves to the front, keeping the rest of the order.
    @Test func providerChainSetterMovesExistingSlotToFront() {
        var s = WhisperioSettings(modelOrder: [
            ProviderSlot(provider: .onDevice),
            ProviderSlot(provider: .groq, model: "whisper-large-v3"),
            ProviderSlot(provider: .openAI),
        ])
        s.providerChain = [.groq]
        #expect(s.modelOrder.map(\.provider) == [.groq, .onDevice, .openAI])
        // The moved slot keeps its pinned model.
        #expect(s.modelOrder[0].model == "whisper-large-v3")
        #expect(s.fallbackChain == [.onDevice, .openAI])

        // Picking an engine that has no slot inserts a fresh modelless one at the front.
        s.providerChain = [.mistral]
        #expect(s.modelOrder.map(\.provider) == [.mistral, .groq, .onDevice, .openAI])
        #expect(s.modelOrder[0].model.isEmpty)
    }

    // An unknown provider raw value inside modelOrder (a future build's engine) must not
    // throw the whole blob away — the order falls back via legacy keys/defaults.
    @Test func unknownProviderInModelOrderFallsBack() throws {
        let json = Data("""
        {"modelOrder": [{"provider": "some-future-engine", "model": "x"}],
         "providerChain": ["ondevice"], "openAIKey": "k"}
        """.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: json)
        #expect(decoded.primaryProvider == .onDevice)
        #expect(decoded.openAIKey == "k")
    }

    @Test func vocabularyTermsAreTrimmedAndCompacted() {
        let s = WhisperioSettings(customVocabulary: " git ,, TypeScript ,React,")
        #expect(s.vocabularyTerms == ["git", "TypeScript", "React"])
    }

    @Test func providerRawValuesMatchDesktopSettings() {
        // Cross-platform config parity with the desktop JSON.
        #expect(ProviderID.openAI.rawValue == "openai")
        #expect(ProviderID.elevenLabs.rawValue == "elevenlabs")
        #expect(ProviderID.onDevice.rawValue == "ondevice")
    }

    // MARK: - Replicate / Self-hosted (R4)

    @Test func replicateAndSelfHostedDisplayNamesAndRawValues() {
        #expect(ProviderID.replicate.rawValue == "replicate")
        #expect(ProviderID.replicate.displayName == "Replicate")
        #expect(ProviderID.selfHosted.rawValue == "selfhosted")
        #expect(ProviderID.selfHosted.displayName == "Self-hosted")
    }

    @Test func replicateAndSelfHostedAreCloudButNeverInTheDefaultChain() {
        let s = WhisperioSettings()
        // Both send audio off-device — honestly cloud — but neither is silently added to any
        // existing user's default fallback order (same opt-in-only treatment as .localWhisper).
        #expect(s.isCloud(.replicate))
        #expect(s.isCloud(.selfHosted))
        #expect(!WhisperioSettings.classicOrder.contains(.replicate))
        #expect(!WhisperioSettings.classicOrder.contains(.selfHosted))
    }

    @Test func replicateAndSelfHostedFieldsDefaultEmptyAndResolveThroughSelectedModel() {
        let s = WhisperioSettings()
        #expect(s.replicateKey.isEmpty)
        #expect(s.replicateModel.isEmpty)
        #expect(s.selfHostedURL.isEmpty)
        #expect(s.selfHostedKey.isEmpty)
        #expect(s.selfHostedModel.isEmpty)
        #expect(s.selectedModel(for: .replicate).isEmpty)
        #expect(s.selectedModel(for: .selfHosted).isEmpty)
    }

    @Test func replicateAndSelfHostedFieldsRoundTripAndResolve() throws {
        var s = WhisperioSettings(replicateKey: "r-key", replicateModel: "owner/model",
                                  selfHostedURL: "http://localhost:8000", selfHostedKey: "s-key",
                                  selfHostedModel: "ggml-base")
        s.setPrimaryProvider(.replicate)
        let data = try JSONEncoder().encode(s)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded == s)
        #expect(decoded.replicateKey == "r-key")
        #expect(decoded.selfHostedURL == "http://localhost:8000")
        #expect(decoded.resolvedModel(for: ProviderSlot(provider: .replicate)) == "owner/model")
        #expect(decoded.resolvedModel(for: ProviderSlot(provider: .selfHosted)) == "ggml-base")
    }

    // A legacy blob (persisted before Replicate/Self-hosted existed) still decodes cleanly —
    // the new fields fall back to their empty defaults, never throwing the blob away.
    @Test func legacyBlobWithoutReplicateOrSelfHostedFieldsFallsBackToDefaults() throws {
        let legacy = Data(#"{"openAIKey": "x"}"#.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.replicateKey.isEmpty)
        #expect(decoded.selfHostedURL.isEmpty)
    }

    // MARK: - ElevenLabs model (R5)

    @Test func elevenLabsModelDefaultsEmptyPreservingExistingBehavior() {
        // Empty means "let ElevenLabsProvider's own diarize/keyterm-driven default decide" — the
        // exact behavior shipped before this field existed. A stored empty string must never be
        // read as "no model configured, do something else".
        let s = WhisperioSettings()
        #expect(s.elevenLabsModel.isEmpty)
        #expect(s.selectedModel(for: .elevenLabs).isEmpty)
    }

    @Test func elevenLabsModelRoundTrips() throws {
        let original = WhisperioSettings(elevenLabsModel: "scribe_v2")
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded.elevenLabsModel == "scribe_v2")
        #expect(decoded.selectedModel(for: .elevenLabs) == "scribe_v2")
    }

    // MARK: - Categorize (R7)

    @Test func autoCategorizeDefaultsToTruePreservingExistingBehavior() {
        // Today's shipped behavior is "every note gets classified" — the toggle must default on
        // so existing users see zero change until they explicitly turn it off.
        let s = WhisperioSettings()
        #expect(s.autoCategorize == true)
        #expect(s.customCategories.isEmpty)
    }

    @Test func autoCategorizeAndCustomCategoriesRoundTrip() throws {
        let cats = [CustomCategory(id: "reading", label: "Reading", icon: "book", hueIndex: 2)]
        let original = WhisperioSettings(autoCategorize: false, customCategories: cats)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded.autoCategorize == false)
        #expect(decoded.customCategories == cats)
    }

    // A legacy blob missing autoCategorize/customCategories entirely still decodes, falling back
    // to the defaults — same tolerant-decode contract as every other field.
    @Test func legacyBlobWithoutCategorizeFieldsFallsBackToDefaults() throws {
        let legacy = Data(#"{"openAIKey": "x"}"#.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.autoCategorize == true)
        #expect(decoded.customCategories.isEmpty)
    }

    // A CustomCategory persisted before some field existed (or hand-edited to drop one) still
    // decodes, each missing key falling back to its documented default.
    @Test func customCategoryTolerantDecodeFallsBackToDefaults() throws {
        let legacy = Data(#"{"label": "Reading"}"#.utf8)
        let cat = try JSONDecoder().decode(CustomCategory.self, from: legacy)
        #expect(cat.label == "Reading")
        #expect(cat.icon == "spark")
        #expect(cat.hueIndex == 0)
        #expect(!cat.id.isEmpty)
    }

    // MARK: - SyncMode

    @Test func syncModeDefaultsToAutomaticWithFifteenMinuteInterval() {
        let s = WhisperioSettings()
        #expect(s.syncMode == .automatic)
        #expect(s.syncIntervalMinutes == 15)
    }

    @Test func syncModeCodableRoundTrips() throws {
        for mode in SyncMode.allCases {
            let original = WhisperioSettings(syncMode: mode, syncIntervalMinutes: 30)
            let data = try JSONEncoder().encode(original)
            let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
            #expect(decoded.syncMode == mode)
            #expect(decoded.syncIntervalMinutes == 30)
        }
    }

    // A blob persisted before syncMode/syncIntervalMinutes existed (missing keys entirely) still
    // decodes, falling back to the defaults — same tolerant-decode contract as every other field.
    @Test func syncModeMissingKeysFallBackToDefaults() throws {
        let legacy = try JSONEncoder().encode(["providerChain": ["ondevice"]])
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.syncMode == .automatic)
        #expect(decoded.syncIntervalMinutes == 15)
    }

    // An unrecognized raw string (e.g. a future build's mode) must not throw the whole settings
    // blob out — it falls back to .automatic, same as a missing key.
    @Test func syncModeUnknownRawValueFallsBackToAutomatic() throws {
        let json = """
        {"providerChain": ["ondevice"], "syncMode": "some-future-mode"}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: json)
        #expect(decoded.syncMode == .automatic)
    }

    // A non-positive syncIntervalMinutes (corrupt persisted state, or a future build that allowed
    // 0) falls back to the default rather than producing a runaway sub-minute timer downstream.
    @Test func syncIntervalMinutesNonPositiveFallsBackToDefault() throws {
        let json = """
        {"providerChain": ["ondevice"], "syncIntervalMinutes": 0}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: json)
        #expect(decoded.syncIntervalMinutes == 15)
    }

    // MARK: - DigestSourceMode ("What goes into the digest")

    @Test func digestSourceModeDefaultsToAll() {
        let s = WhisperioSettings()
        #expect(s.digestSourceMode == .all)
    }

    @Test func digestSourceModeCodableRoundTrips() throws {
        for mode in DigestSourceMode.allCases {
            let original = WhisperioSettings(digestSourceMode: mode)
            let data = try JSONEncoder().encode(original)
            let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
            #expect(decoded.digestSourceMode == mode)
        }
    }

    // A blob persisted before digestSourceMode existed (missing key entirely) still decodes,
    // falling back to `.all` — same tolerant-decode contract as every other field.
    @Test func digestSourceModeMissingKeyFallsBackToAll() throws {
        let legacy = try JSONEncoder().encode(["providerChain": ["ondevice"]])
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.digestSourceMode == .all)
    }

    // An unrecognized raw string (e.g. a future build's mode) must not throw the whole settings
    // blob out — it falls back to `.all`, same as syncMode's unknown-value tolerance.
    @Test func digestSourceModeUnknownRawValueFallsBackToAll() throws {
        let json = """
        {"providerChain": ["ondevice"], "digestSourceMode": "some-future-mode"}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: json)
        #expect(decoded.digestSourceMode == .all)
    }

    // MARK: - preferredLanguages (R4 — onboarding step 2 persistence)

    @Test func preferredLanguagesDefaultsEmpty() {
        let s = WhisperioSettings()
        #expect(s.preferredLanguages.isEmpty)
    }

    @Test func preferredLanguagesRoundTrips() throws {
        let original = WhisperioSettings(language: "pl", preferredLanguages: ["pl", "en", "de"])
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded.preferredLanguages == ["pl", "en", "de"])
        #expect(decoded.language == "pl")
    }

    // A blob persisted before preferredLanguages existed (missing key entirely) still decodes,
    // falling back to empty — same tolerant-decode contract as every other field.
    @Test func preferredLanguagesMissingKeyFallsBackToEmpty() throws {
        let legacy = Data(#"{"openAIKey": "x"}"#.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.preferredLanguages.isEmpty)
    }

    // MARK: - oldDeviceNoticeShown (R3 — "Engine & privacy" screen shown-once flag)

    @Test func oldDeviceNoticeShownDefaultsFalse() {
        let s = WhisperioSettings()
        #expect(s.oldDeviceNoticeShown == false)
    }

    @Test func oldDeviceNoticeShownRoundTrips() throws {
        let original = WhisperioSettings(oldDeviceNoticeShown: true)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded.oldDeviceNoticeShown == true)
    }

    // A blob persisted before oldDeviceNoticeShown existed (missing key entirely) still decodes,
    // falling back to false — same tolerant-decode contract as every other field.
    @Test func oldDeviceNoticeShownMissingKeyFallsBackToFalse() throws {
        let legacy = Data(#"{"openAIKey": "x"}"#.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.oldDeviceNoticeShown == false)
    }
}
