package ai.whisperio.android.screenshot

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

    private fun step(name: String, dark: Boolean = false, state: OnboardingState) =
        rule.snapshot(name, dark) { OnboardingScreen(state, noop) }

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
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = ScreenshotConfig.PL)
class OnboardingSnapshotPlTest : OnboardingSnapshotTest()
