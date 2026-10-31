package ai.whisperio.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CONTRACT 8: no analytics / crash reporter / ads / Play Services, and exactly two permissions. Greps the module
 * sources and the build file (the working directory of an Android unit test is the module directory).
 */
class PrivacyGateTest {
    private val moduleDir = File(".").absoluteFile.let { if (File(it, "src/main").exists()) it else File(it, "app") }

    private val banned = listOf(
        "firebase", "crashlytics", "google-services", "play-services", "gms.ads", "admob", "sentry", "bugsnag",
        "mixpanel", "com.amplitude", "appsflyer", "adjust.com", "posthog", "com.facebook", "datadog", "billingclient",
    )

    @Test fun noKnownTrackingOrPaymentSdkInBuildFileOrSources() {
        val files = listOf(File(moduleDir, "build.gradle.kts")) +
            File(moduleDir, "src/main").walkTopDown().filter { it.isFile && it.extension in setOf("kt", "xml", "kts") }
        assertTrue("module sources not found at $moduleDir", files.size > 5)
        val hits = files.flatMap { f ->
            val text = f.readText().lowercase()
            banned.filter { it in text }.map { "${f.name}: $it" }
        }
        assertTrue("banned SDK references: $hits", hits.isEmpty())
    }

    @Test fun tinkIsTheOnlyCryptoLibraryInTheBuildFile() {
        val build = File(moduleDir, "build.gradle.kts").readText()
        assertTrue(build.contains("implementation(libs.tink.android)"))
        val otherCrypto = listOf("bouncycastle", "spongycastle", "conscrypt", "sqlcipher", "androidx.security", "security.crypto", "sodium", "libs.tink.")
            .filter { it in build.lowercase() }
        assertEquals(listOf("libs.tink."), otherCrypto) // only the tink-android alias, nothing else crypto-like
    }

    @Test fun manifestDeclaresOnlyRecordAudioAndInternet() {
        val manifest = File(moduleDir, "src/main/AndroidManifest.xml").readText()
        val perms = Regex("<uses-permission[^>]*android:name=\"([^\"]+)\"").findAll(manifest).map { it.groupValues[1] }.toSet()
        assertEquals(setOf("android.permission.RECORD_AUDIO", "android.permission.INTERNET"), perms)
        assertTrue(manifest.contains("android:allowBackup=\"false\""))
        assertTrue(manifest.contains("android:fullBackupContent=\"false\""))
        assertTrue(manifest.contains("android:dataExtractionRules"))
    }

    @Test fun dataExtractionRulesExcludeEverythingForBothTransfers() {
        val rules = File(moduleDir, "src/main/res/xml/data_extraction_rules.xml").readText()
        for (section in listOf("cloud-backup", "device-transfer")) {
            val body = rules.substringAfter("<$section>").substringBefore("</$section>")
            assertTrue("$section must exclude data", body.contains("<exclude"))
            assertTrue("$section must not include anything", !body.contains("<include"))
        }
    }

    @Test fun stringsExistInEnglishAndPolishWithTheSameKeys() {
        fun keys(path: String) = Regex("<string name=\"([^\"]+)\"").findAll(File(moduleDir, path).readText()).map { it.groupValues[1] }.toSet()
        assertEquals(keys("src/main/res/values/strings.xml"), keys("src/main/res/values-pl/strings.xml"))
    }
}
