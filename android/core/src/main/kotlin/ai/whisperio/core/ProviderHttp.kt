package ai.whisperio.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.Response
import java.io.File
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Shared plumbing for the providers; the iOS equivalent is Engine/MultipartBody.swift.

internal val OCTET_STREAM = "application/octet-stream".toMediaType()
internal val JSON_MEDIA = "application/json".toMediaType()

/** iOS: `language != "auto" && !language.isEmpty` means the field is sent. */
internal fun isAutoLanguage(language: String): Boolean = language.isBlank() || language.trim() == "auto"

internal fun requireKey(provider: ProviderId, key: String?): String {
    val k = key?.trim().orEmpty()
    if (k.isEmpty()) throw ProviderError.NotConfigured(provider)
    return k
}

internal fun checkUploadSize(file: File, limitBytes: Long) {
    if (file.length() > limitBytes) throw ProviderError.FileTooLarge(limitBytes)
}

/** Adds the audio part; quotes/CR/LF are stripped from the filename (MultipartBody.swift). */
internal fun MultipartBody.Builder.addAudio(file: File): MultipartBody.Builder {
    val safe = file.name.replace("\"", "").replace("\r", "").replace("\n", "")
    return addFormDataPart("file", safe, file.asRequestBody(OCTET_STREAM))
}

internal fun formBody(build: MultipartBody.Builder.() -> Unit): MultipartBody =
    MultipartBody.Builder().setType(MultipartBody.FORM).apply(build).build()

/** Parses a fixed provider base (or a test override); throws [IllegalArgumentException] if malformed. */
internal fun String.toHttpUrlStrict(): HttpUrl = toHttpUrl()

internal fun baseUrlOrThrow(provider: ProviderId, base: String): HttpUrl =
    when (val r = BaseUrlPolicy.validate(base)) {
        is BaseUrlResult.Ok -> r.url
        is BaseUrlResult.Rejected -> throw ProviderError.BaseUrlRejected(provider, r.error.description)
    }

/** Appends [path] (slash separated) to a base URL, tolerating a trailing slash on the base. */
internal fun HttpUrl.child(path: String): HttpUrl = newBuilder().addPathSegments(path).build()

internal suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }
    })
}

/**
 * Executes [request] and returns the 2xx body. Non-2xx becomes a redacted [ProviderError.Http],
 * transport failures become [ProviderError.Network]. Cancellation propagates untouched.
 */
internal suspend fun OkHttpClient.executeText(
    provider: ProviderId,
    request: Request,
    step: String? = null,
): String =
    try {
        newCall(request).await().use { response ->
            val body = withContext(Dispatchers.IO) { response.body?.string().orEmpty() }
            if (!response.isSuccessful) throw ProviderError.http(provider, response.code, body, step)
            body
        }
    } catch (e: IOException) {
        throw ProviderError.Network(provider, ProviderError.redactSecrets(e.message ?: e.javaClass.simpleName))
    }

internal fun parseObject(provider: ProviderId, body: String): JsonObject =
    try {
        Json.parseToJsonElement(body).jsonObject
    } catch (_: SerializationException) {
        throw ProviderError.Failed(provider, "Unexpected response from ${provider.displayName}.")
    } catch (_: IllegalArgumentException) {
        throw ProviderError.Failed(provider, "Unexpected response from ${provider.displayName}.")
    }

internal fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Reads `{"text": "..."}` — the OpenAI-compatible / ElevenLabs response shape. */
internal fun parseText(provider: ProviderId, body: String): String =
    parseObject(provider, body).string("text")
        ?: throw ProviderError.Failed(provider, "${provider.displayName} returned no transcript.")

/**
 * POST multipart to an OpenAI-compatible `/audio/transcriptions` endpoint
 * (OpenAI, Groq, Mistral, self-hosted share this wire format).
 */
internal suspend fun OkHttpClient.postOpenAiStyle(
    provider: ProviderId,
    url: HttpUrl,
    bearer: String?,
    model: String,
    request: TranscriptionRequest,
    sendPrompt: Boolean,
): String {
    val body = formBody {
        addFormDataPart("model", model)
        if (!isAutoLanguage(request.language)) addFormDataPart("language", request.language.trim())
        if (sendPrompt && request.vocabulary.isNotBlank()) addFormDataPart("prompt", request.vocabulary)
        addAudio(request.audio)
    }
    val http = Request.Builder().url(url).apply {
        if (bearer != null) header("Authorization", "Bearer $bearer")
    }.post(body).build()
    return parseText(provider, executeText(provider, http))
}
