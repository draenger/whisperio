# Whisperio release shrinker rules. Room, Compose, DataStore and OkHttp ship their own consumer rules.
# Keep Android components referenced only from the manifest (AGP adds these automatically; listed for clarity).
-keep class ai.whisperio.android.ime.WhisperioImeService
-keep class ai.whisperio.android.dictate.WhisperioTileService
# kotlinx.serialization (used by :core models)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class ** { kotlinx.serialization.KSerializer serializer(...); }
