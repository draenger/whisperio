import Foundation

/// Published list-price lookup for cloud transcription engines. These are the providers' own
/// public per-minute rates (facts about their pricing pages), NOT a measured/billed cost —
/// Whisperio has no plan/credit/account integration with any of these providers, so there is no
/// live billing number to show. Rates checked 2026-07-19; update this table if a provider
/// re-prices — nothing here is polled from a live pricing API.
public enum ProviderPricing {
    /// USD per minute of audio for `provider` running `model` (case-insensitive, trimmed; empty
    /// string means "Whisperio's default model for that provider"). Returns `nil` when the model
    /// string isn't recognized (e.g. a custom/self-hosted model) — callers must not assume a
    /// rate when this returns `nil`. `.onDevice` always returns `nil`; callers must special-case
    /// on-device as "Free", not "unknown". `.localWhisper` (on-device WhisperKit) is the same
    /// case — a second free/on-device engine, not an "unknown model" gap.
    public static func ratePerMinuteUSD(provider: ProviderID, model: String) -> Double? {
        let m = model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch provider {
        case .onDevice:
            return nil

        case .localWhisper:
            return nil

        case .openAI:
            // openai.com/api/pricing — per-minute audio transcription rates.
            switch m {
            case "", "whisper-1", "gpt-4o-transcribe": return 0.006
            case "gpt-4o-mini-transcribe": return 0.003
            default: return nil
            }

        case .elevenLabs:
            // elevenlabs.io/pricing/api — Scribe batch transcription, flat $0.22/hour.
            return 0.22 / 60

        case .groq:
            // groq.com pricing — per-second billing normalized to per-minute here.
            switch m {
            case "", "whisper-large-v3-turbo": return 0.04 / 60
            case "whisper-large-v3": return 0.111 / 60
            case "distil-whisper": return 0.02 / 60
            default: return nil
            }

        case .deepgram:
            // deepgram.com/pricing — pay-as-you-go, pre-recorded.
            switch m {
            case "", "nova-3": return 0.0043
            case "nova-2": return 0.0058
            case "whisper-cloud": return 0.0048
            default: return nil
            }

        case .assemblyAI:
            // assemblyai.com/pricing — Universal models, per hour normalized to per minute.
            switch m {
            case "", "universal-2", "universal-1": return 0.15 / 60
            default: return nil
            }

        case .mistral:
            // mistral.ai/pricing/api — Voxtral transcription.
            switch m {
            case "", "voxtral-small": return 0.004
            case "voxtral-mini": return 0.003
            default: return nil
            }

        case .selfHosted:
            // The user's own hardware — no vendor to bill, always free.
            return 0

        case .replicate:
            // Replicate bills per-second of hardware time for the underlying model, not a
            // flat per-minute audio rate like the other cloud engines — there's no single
            // honest number to publish here. Callers must show the same "—" unknown-rate path
            // used for a custom/self-hosted model string, not a guessed number.
            return nil
        }
    }
}
