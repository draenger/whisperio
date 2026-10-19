# Whisperio release shrinker rules. Room, Compose, DataStore and OkHttp ship their own consumer rules.
# Keep Android components referenced only from the manifest (AGP adds these automatically; listed for clarity).
-keep class ai.whisperio.android.ime.WhisperioImeService
-keep class ai.whisperio.android.dictate.WhisperioTileService
# kotlinx.serialization (used by :core models)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class ** { kotlinx.serialization.KSerializer serializer(...); }
# --- Release hardening (AAB review, internal track 1.0.0). Conservative: libraries ship consumer rules; these cover gaps. ---
# kotlinx.serialization: keep generated serializers + Companion.serializer() of @Serializable models in :core/:app
# (the official snippet from the library README; models are decoded reflectively-by-name via serializer()).
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
    static ** INSTANCE;
}
-keepclassmembers class **$$serializer { *; }
# OkHttp 4.12 / okio: optional TLS providers are referenced but not bundled; R8 must not fail on them.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**
# Room: KSP-generated *_Impl classes are instantiated by name from the generated database; Room's consumer rules keep them,
# this is a belt-and-braces guard (cheap: only the generated implementations).
-keep class * extends androidx.room.RoomDatabase { <init>(); }
# Keep line numbers for Play Console crash/ANR stack traces (mapping.txt is uploaded with the AAB automatically).
-keepattributes SourceFile, LineNumberTable
