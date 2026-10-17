package ai.whisperio.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Privacy gate: Whisperio ships no analytics, crash reporting, ads or billing SDKs. Scans every
 * `build.gradle.kts` under android/ plus the version catalog and fails on any banned token.
 * Gradle runs :core tests with the project dir (android/core) as the working directory.
 */
class PrivacyGateTest {
    private val banned = listOf(
        "firebase", "crashlytics", "sentry", "posthog", "amplitude", "mixpanel",
        "appsflyer", "adjust", "play-services-ads", "billing", "analytics",
    )

    private val androidRoot: File = File("..").canonicalFile

    private fun scanTargets(): List<File> {
        val builds = androidRoot.walkTopDown()
            .onEnter { it.name != "build" && it.name != ".gradle" && it.name != ".git" }
            .filter { it.isFile && it.name == "build.gradle.kts" }
            .toList()
        return builds + File(androidRoot, "gradle/libs.versions.toml")
    }

    /** Returns "<token> in <file>:<line>" for every hit; exposed so the scanner itself is testable. */
    private fun findViolations(name: String, text: String): List<String> =
        text.lines().flatMapIndexed { i, line ->
            banned.filter { line.contains(it, ignoreCase = true) }.map { "'$it' in $name:${i + 1}: ${line.trim()}" }
        }

    @Test fun noTrackingOrBillingDependencies() {
        val targets = scanTargets()
        val names = targets.map { it.relativeTo(androidRoot).invariantSeparatorsPath }
        assertTrue("core/build.gradle.kts" in names, "scanner must see core/build.gradle.kts, saw $names")
        assertTrue("gradle/libs.versions.toml" in names, "scanner must see the version catalog, saw $names")

        val violations = targets.filter { it.exists() }.flatMap { findViolations(it.name, it.readText()) }
        if (violations.isNotEmpty()) fail("Banned dependency tokens found:\n" + violations.joinToString("\n"))
    }

    @Test fun scannerActuallyDetectsBannedTokens() {
        assertTrue(findViolations("x", "implementation(\"com.google.firebase:firebase-analytics\")").size == 2)
        assertTrue(findViolations("x", "implementation(libs.sentry.android)").isNotEmpty())
        assertTrue(findViolations("x", "implementation(libs.PostHog)").isNotEmpty())
        assertTrue(findViolations("x", "implementation(libs.okhttp.core)").isEmpty())
    }
}
