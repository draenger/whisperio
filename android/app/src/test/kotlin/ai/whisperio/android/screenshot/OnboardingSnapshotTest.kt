package ai.whisperio.android.screenshot

import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.settings.KeyUi
import ai.whisperio.android.ui.onboarding.OnboardingActions
import ai.whisperio.android.ui.onboarding.OnboardingScreen
import ai.whisperio.android.ui.onboarding.OnboardingState
import ai.whisperio.android.ui.onboarding.OnboardingStep
import ai.whisperio.core.ProviderId
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.EN)
open class OnboardingSnapshotTest {
    @get:Rule val rule = createComposeRule()

    private val noop = object : OnboardingActions {}

    private fun step(name: String, dark: Boolean = false, fontScale: Float = 1f, state: OnboardingState) =
        rule.snapshot(name, dark, fontScale) { OnboardingScreen(state, noop) }

    private val providerState =
        OnboardingState(OnboardingStep.PROVIDER, keyInput = "sk-test-0000", keyUi = KeyUi.Valid)
    private val tryItDoneState = OnboardingState(
        OnboardingStep.DONE,
        dictation = DictationState.Done("Hello from my first dictation.", null, RecordingSource.APP),
    )

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun welcome() = step("onboarding_1_welcome", state = OnboardingState(OnboardingStep.WELCOME))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun privacy() = step("onboarding_2_privacy", state = OnboardingState(OnboardingStep.PRIVACY, consent = true))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun privacyDark() = step("onboarding_2_privacy", dark = true, state = OnboardingState(OnboardingStep.PRIVACY))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun provider() = step(
        "onboarding_3_provider",
        state = OnboardingState(OnboardingStep.PROVIDER, keyInput = "sk-test-0000", keyUi = KeyUi.Valid),
    )

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun providerInvalidDark() = step(
        "onboarding_3_provider_invalid",
        dark = true,
        state = OnboardingState(OnboardingStep.PROVIDER, provider = ProviderId.GROQ, keyInput = "gsk_bad", keyUi = KeyUi.Invalid),
    )

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun language() = step("onboarding_4_language", state = OnboardingState(OnboardingStep.LANGUAGE, language = "pl"))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun mic() = step("onboarding_5_mic", state = OnboardingState(OnboardingStep.MIC))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun keyboard() = step("onboarding_6_keyboard", state = OnboardingState(OnboardingStep.KEYBOARD, canAddTile = true))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun done() = step("onboarding_7_done", state = OnboardingState(OnboardingStep.DONE))

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun tryItDone() = step(
        "onboarding_7_try_done",
        state = OnboardingState(
            OnboardingStep.DONE,
            dictation = DictationState.Done("Hello from my first dictation.", null, RecordingSource.APP),
        ),
    )

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun tryItRecordingDark() = step(
        "onboarding_7_try_recording",
        dark = true,
        state = OnboardingState(
            OnboardingStep.DONE,
            dictation = DictationState.Recording(elapsedMs = 4_000, level = 0.5f, nearLimit = false, source = RecordingSource.APP),
        ),
    )

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun providerTablet() = step("onboarding_3_provider_tablet", state = providerState)

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun providerFontScale2() = step("onboarding_3_provider_font2", fontScale = 2f, state = providerState)

    @Test @Config(qualifiers = ScreenshotConfig.TABLET)
    fun tryItDoneTablet() = step("onboarding_7_try_done_tablet", state = tryItDoneState)

    @Test @Config(qualifiers = ScreenshotConfig.PHONE)
    fun tryItDoneFontScale2() = step("onboarding_7_try_done_font2", fontScale = 2f, state = tryItDoneState)
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class OnboardingSnapshotPlTest : OnboardingSnapshotTest()
