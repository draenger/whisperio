package ai.whisperio.core

import okhttp3.HttpUrl.Companion.toHttpUrl
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Vectors ported from BaseURLPolicyTests.swift. */
class BaseUrlPolicyTest {
    private fun ok(s: String, bare: Boolean = false) = assertIs<BaseUrlResult.Ok>(BaseUrlPolicy.validate(s, bare), s)
    private fun rejected(s: String, bare: Boolean = false) =
        assertIs<BaseUrlResult.Rejected>(BaseUrlPolicy.validate(s, bare), s).error

    @Test fun httpsAlwaysOk() {
        assertEquals("api.openai.com", ok("https://api.openai.com/v1").url.host)
        ok("https://example.com:8443/v1")
    }

    @Test fun httpOkForLoopbackAndPrivate() {
        listOf(
            "http://localhost:8080/v1", "http://127.0.0.1:9000", "http://127.5.5.5", "http://[::1]:8080/v1",
            "http://10.1.2.3/v1", "http://172.16.0.1", "http://172.31.255.1", "http://192.168.1.20:8080/v1",
            "http://mybox.local:8080/v1",
        ).forEach { ok(it) }
    }

    @Test fun httpOkForIntranetStyleHosts() {
        listOf(
            "http://nas:8080/v1", "http://whisper-box", "http://stt.lan", "http://box.home.arpa",
            "http://svc.internal", "http://100.64.0.1", "http://100.127.255.1", "http://[fd12::1]:8080",
            "http://[fe80::1]", "http://[fc00::2]",
        ).forEach { ok(it) }
        listOf("http://100.63.0.1", "http://100.128.0.1", "http://[2001:db8::1]", "http://example.com.lan.evil.com")
            .forEach { assertIs<BaseUrlError.InsecureHttp>(rejected(it), it) }
    }

    @Test fun httpPublicRejected() {
        listOf(
            "http://api.openai.com/v1", "http://8.8.8.8", "http://172.32.0.1", "http://172.15.0.1",
            "http://192.169.1.1", "http://11.0.0.1", "http://example.com",
        ).forEach { assertIs<BaseUrlError.InsecureHttp>(rejected(it), it) }
    }

    @Test fun invalidRejected() {
        assertEquals(BaseUrlError.Empty, rejected(""))
        assertEquals(BaseUrlError.Empty, rejected("   "))
        assertEquals(BaseUrlError.Invalid, rejected("not a url"))
        assertEquals(BaseUrlError.Invalid, rejected("localhost:8000"))
        assertIs<BaseUrlError.UnsupportedScheme>(rejected("ftp://example.com"))
        assertEquals(BaseUrlError.Invalid, rejected("https://"))
    }

    @Test fun bareHostOnlyWhenAllowedAndStillChecked() {
        assertEquals("http", ok("192.168.1.5:5000", bare = true).url.scheme)
        assertIs<BaseUrlError.InsecureHttp>(rejected("example.com", bare = true))
    }

    @Test fun officialVsCustomHost() {
        assertTrue(BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, "https://api.openai.com/v1".toHttpUrl()))
        assertTrue(BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, "https://API.OPENAI.COM/v1".toHttpUrl()))
        assertFalse(BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, "https://my-proxy.example.com/v1".toHttpUrl()))
        assertFalse(BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, "https://api.openai.com.evil.test/v1".toHttpUrl()))
        assertFalse(BaseUrlPolicy.isOfficialHost(ProviderId.SELFHOSTED, "https://api.openai.com/v1".toHttpUrl()))
    }

    @Test fun errorMessagesAreReadable() {
        assertEquals("Enter a URL.", BaseUrlError.Empty.description)
        assertTrue(BaseUrlError.InsecureHttp("example.com").description.contains("example.com is a public host"))
    }
}
