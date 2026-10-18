import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.roborazzi)
}

// Release signing is OPTIONAL (Zryw pattern, CONTRACT §10): gitignored android/keystore.properties, else env vars
// WHISPERIO_KEYSTORE_FILE / _PASSWORD, WHISPERIO_KEY_ALIAS / _PASSWORD. Without a complete set the release build is
// produced unsigned instead of failing. Nothing here is ever echoed.
val keystoreProperties = Properties().apply {
    val propsFile = rootProject.file("keystore.properties")
    if (propsFile.exists()) propsFile.inputStream().use { load(it) }
}

fun releaseSigningValue(propertyKey: String, envKey: String): String? =
    keystoreProperties.getProperty(propertyKey)?.takeIf { it.isNotBlank() }
        ?: System.getenv(envKey)?.takeIf { it.isNotBlank() }

val releaseStoreFile = releaseSigningValue("storeFile", "WHISPERIO_KEYSTORE_FILE")
val releaseStorePassword = releaseSigningValue("storePassword", "WHISPERIO_KEYSTORE_PASSWORD")
val releaseKeyAlias = releaseSigningValue("keyAlias", "WHISPERIO_KEY_ALIAS")
val releaseKeyPassword = releaseSigningValue("keyPassword", "WHISPERIO_KEY_PASSWORD")
val hasReleaseSigning = !releaseStoreFile.isNullOrBlank() &&
    !releaseStorePassword.isNullOrBlank() &&
    !releaseKeyAlias.isNullOrBlank() &&
    !releaseKeyPassword.isNullOrBlank()

// versionCode/versionName come from the tracked android/app/version.properties (CONTRACT §1).
val versionProperties = Properties().apply {
    val propsFile = file("version.properties")
    if (propsFile.exists()) propsFile.inputStream().use { load(it) }
}
val appVersionCode = versionProperties.getProperty("versionCode")?.toIntOrNull() ?: 1
val appVersionName = versionProperties.getProperty("versionName")?.takeIf { it.isNotBlank() } ?: "0.0.0"

android {
    namespace = "ai.whisperio.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.whisperio.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false // explicit: Play rejects debuggable bundles
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api"
    }

    // AAB config: keep ALL language resources (en + pl) in the base split. The UI follows the device locale, so a user who
    // switches the phone language after install gets the matching strings at once instead of waiting for Play to fetch
    // a language split (which fails offline). Cost: a few KB of strings.xml; Whisperio ships only en + pl.
    bundle {
        language { enableSplit = false }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
            all {
                it.jvmArgs(
                    "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
                    "--add-opens=java.base/java.lang=ALL-UNNAMED",
                    "--add-opens=java.base/java.io=ALL-UNNAMED",
                    "--add-opens=java.base/java.time=ALL-UNNAMED",
                    "-Xmx2g",
                    "-Duser.timezone=UTC",
                )
            }
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

// Screenshot tests need debug-only ui-test-manifest; keep them out of the release unit-test run.
tasks.withType<Test>().configureEach {
    if (name.endsWith("ReleaseUnitTest")) {
        filter { excludeTestsMatching("ai.whisperio.android.screenshot.*") }
    }
}

roborazzi {
    outputDir.set(file("src/test/snapshots"))
}

dependencies {
    implementation(project(":core"))

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.savedstate.ktx)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    testImplementation(libs.junit4)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.mockk)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
