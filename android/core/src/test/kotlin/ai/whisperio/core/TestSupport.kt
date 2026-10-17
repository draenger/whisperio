package ai.whisperio.core

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import java.io.File

/** One decoded multipart/form-data part. */
data class Part(val name: String, val filename: String?, val contentType: String?, val body: String)

/** Decodes a recorded multipart request (the audio fixture is ASCII, so UTF-8 decoding is lossless). */
fun RecordedRequest.multipartParts(): List<Part> {
    val ct = getHeader("Content-Type").orEmpty()
    val boundary = ct.substringAfter("boundary=").trim()
    val raw = body.clone().readUtf8()
    return raw.split("--$boundary").drop(1).filter { !it.startsWith("--") }.map { chunk ->
        val trimmed = chunk.removePrefix("\r\n")
        val headers = trimmed.substringBefore("\r\n\r\n")
        val content = trimmed.substringAfter("\r\n\r\n").removeSuffix("\r\n")
        Part(
            name = Regex("""; name="([^"]*)"""").find(headers)!!.groupValues[1],
            filename = Regex("""filename="([^"]*)"""").find(headers)?.groupValues?.get(1),
            contentType = Regex("""Content-Type: (.*)""", RegexOption.IGNORE_CASE).find(headers)?.groupValues?.get(1)?.trim(),
            body = content,
        )
    }
}

fun RecordedRequest.fields(): Map<String, String> =
    multipartParts().filter { it.filename == null }.associate { it.name to it.body }

fun RecordedRequest.partNames(): List<String> = multipartParts().map { it.name }

fun audioFixture(bytes: String = "FAKE-AUDIO-BYTES", name: String = "clip.m4a"): File =
    File.createTempFile("whisperio", name).apply { writeText(bytes); deleteOnExit() }

fun MockWebServer.enqueueJson(body: String, code: Int = 200) {
    enqueue(MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body))
}

/** Base URL string with the given path prefix, e.g. server.base("/v1"). */
fun MockWebServer.base(path: String = ""): String = url(path).toString().trimEnd('/')
