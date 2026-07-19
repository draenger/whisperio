import Testing
@testable import WhisperioKit

@Suite struct ProviderPricingTests {
    @Test func onDeviceIsAlwaysNil() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .onDevice, model: "") == nil)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .onDevice, model: "anything") == nil)
    }

    @Test func openAIDefaults() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: "") == 0.006)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: "whisper-1") == 0.006)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: "gpt-4o-transcribe") == 0.006)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: "gpt-4o-mini-transcribe") == 0.003)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: "some-custom-model") == nil)
    }

    @Test func elevenLabsFlatRate() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .elevenLabs, model: "") == 0.22 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .elevenLabs, model: "scribe") == 0.22 / 60)
    }

    @Test func groqDefaults() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .groq, model: "") == 0.04 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .groq, model: "whisper-large-v3-turbo") == 0.04 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .groq, model: "whisper-large-v3") == 0.111 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .groq, model: "distil-whisper") == 0.02 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .groq, model: "made-up") == nil)
    }

    @Test func deepgramDefaults() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: "") == 0.0043)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: "nova-3") == 0.0043)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: "nova-2") == 0.0058)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: "whisper-cloud") == 0.0048)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: "nova-4") == nil)
    }

    @Test func assemblyAIDefaults() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .assemblyAI, model: "") == 0.15 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .assemblyAI, model: "universal-2") == 0.15 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .assemblyAI, model: "universal-1") == 0.15 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .assemblyAI, model: "conformer-2") == nil)
    }

    @Test func mistralDefaults() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .mistral, model: "") == 0.004)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .mistral, model: "voxtral-small") == 0.004)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .mistral, model: "voxtral-mini") == 0.003)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .mistral, model: "voxtral-large") == nil)
    }

    @Test func modelMatchingIsCaseInsensitiveAndTrimmed() {
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: "  WHISPER-1  ") == 0.006)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .groq, model: "Whisper-Large-V3-Turbo") == 0.04 / 60)
        #expect(ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: "  Nova-2  ") == 0.0058)
    }
}
