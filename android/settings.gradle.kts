pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "whisperio-android"

// Pure Kotlin/JVM: providers, chain, URL policy, error redaction, text cleanup (CONTRACT.md §3).
include(":core")
// Android app: Compose UI, IME, recorder, QS tile, Room history, Keystore key store.
include(":app")
