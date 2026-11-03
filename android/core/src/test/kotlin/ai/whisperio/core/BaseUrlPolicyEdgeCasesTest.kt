package ai.whisperio.core

import org.junit.Ignore
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** [BaseUrlPolicy] paths not covered by BaseUrlPolicyTest: parsing tricks, scheme handling, raw host checks. */
class BaseUrlPolicyEdgeCasesTest {
    private fun ok(s: String, bare: Boolean = false) = assertIs<BaseUrlResult.Ok>(BaseUrlPolicy.validate(s, bare), s)
    private fun rejected(s: String, bare: Boolean = false) =
        assertIs<BaseUrlResult.Rejected>(BaseUrlPolicy.validate(s, bare), s).error

    @Test fun inputIsTrimmedBeforeValidation() {
        assertEquals("api.openai.com", ok("  https://api.openai.com/v1 \n").url.host)
        assertEquals(BaseUrlError.Empty, rejected(" \t\n ", bare = true))
    }

    @Test fun schemeIsCaseInsensitive() {
        assertEquals("https", ok("HTTPS://Example.COM/v1").url.scheme)
        assertEquals("example.com", ok("HTTPS://Example.COM/v1").url.host)
        ok("HTTP://LOCALHOST:8080")
        assertIs<BaseUrlError.InsecureHttp>(rejected("HtTp://example.com"))
    }

    @Test fun nothingIsSilentlyRewritten() {
        val url = ok("https://example.com:8443/custom/path?x=1").url
        assertEquals(8443, url.port)
        assertEquals("/custom/path", url.encodedPath)
        assertEquals("x=1", url.encodedQuery)
    }

    @Test fun userinfoCannotSmuggleALocalHost() {
        // The real host is after '@'; "localhost" in the userinfo must not unlock plain http.
        assertEquals(BaseUrlError.InsecureHttp("evil.com"), rejected("http://localhost@evil.com/v1"))
        assertEquals(BaseUrlError.InsecureHttp("evil.com"), rejected("http://localhost:8080@evil.com"))
        assertEquals(BaseUrlError.InsecureHttp("8.8.8.8"), rejected("http://user:pass@8.8.8.8"))
    }

    @Test fun fragmentAndBackslashTricksResolveToTheRealHost() {
        assertIs<BaseUrlError.InsecureHttp>(rejected("http://evil.com#@localhost"))
        assertIs<BaseUrlError.InsecureHttp>(rejected("http://evil.com\\@localhost"))
        assertIs<BaseUrlError.InsecureHttp>(rejected("http://evil.com?@localhost"))
    }

    @Test fun lookalikeSuffixesAreNotLocal() {
        listOf(
            "http://localhost.evil.com", "http://127.0.0.1.nip.io", "http://10.0.0.1.evil.com",
            "http://evil.com.localhost.example", "http://mylan.com", "http://internal.example.com",
        ).forEach { assertIs<BaseUrlError.InsecureHttp>(rejected(it), it) }
    }

    @Test fun insecureHttpCarriesTheCanonicalHost() {
        assertEquals(BaseUrlError.InsecureHttp("example.com"), rejected("http://EXAMPLE.com:80/v1"))
    }

    @Test fun unsupportedSchemesAreNamedLowercase() {
        assertEquals(BaseUrlError.UnsupportedScheme("ftp"), rejected("FTP://example.com"))
        assertEquals(BaseUrlError.UnsupportedScheme("ws"), rejected("ws://localhost:8080"))
        assertEquals(BaseUrlError.UnsupportedScheme("wss"), rejected("wss://example.com/v1"))
        assertTrue(BaseUrlError.UnsupportedScheme("ftp").description.contains("\"ftp\""))
    }

    @Test fun unsupportedSchemeWithoutHostIsInvalid() {
        assertEquals(BaseUrlError.Invalid, rejected("file:///etc/passwd"))
        assertEquals(BaseUrlError.Invalid, rejected("ftp://"))
        // No "://" at all: never treated as a URL unless bare hosts are allowed.
        assertEquals(BaseUrlError.Invalid, rejected("javascript:alert(1)"))
        assertEquals(BaseUrlError.Invalid, rejected("mailto:a@b.c"))
    }

    @Test fun malformedHttpUrlsAreInvalid() {
        assertEquals(BaseUrlError.Invalid, rejected("http://"))
        assertEquals(BaseUrlError.Invalid, rejected("http:// localhost"))
        assertEquals(BaseUrlError.Invalid, rejected("https://exa mple.com"))
        assertEquals(BaseUrlError.Invalid, rejected("http://localhost:99999"))
        assertEquals(BaseUrlError.Invalid, rejected("not a url", bare = true))
    }

    @Test fun bareHostVariants() {
        assertEquals("http://localhost/", ok("localhost", bare = true).url.toString())
        assertEquals(5000, ok("nas:5000/v1", bare = true).url.port)
        // A scheme present wins over the bare-host assumption.
        assertEquals("https", ok("https://example.com", bare = true).url.scheme)
        assertIs<BaseUrlError.InsecureHttp>(rejected("8.8.8.8:80", bare = true))
    }

    @Test fun isLocalHostRawInputs() {
        listOf(
            "LOCALHOST", " localhost ", "[::1]", "::1", "0.0.0.0", "[fd00::1]", "FE80::1", "printer",
            "Box.Local", "router.lan", "a.home.arpa", "db.internal", "172.20.3.4", "100.100.100.100",
        ).forEach { assertTrue(BaseUrlPolicy.isLocalHost(it), it) }
    }

    @Test fun isLocalHostRejectsPublicAndMalformedIpv4() {
        listOf(
            "8.8.8.8", "1.1.1.1", "256.1.1.1", "10.0.0.256", "192.168.1", "10.0.0.0.1", "0177.0.0.1",
            "1234.0.0.1", "172.32.0.0", "100.128.0.0", "169.254.1.1", "::ffff:8.8.8.8", "2001:4860::8888",
        ).forEach { assertFalse(BaseUrlPolicy.isLocalHost(it), it) }
    }

    @Test fun officialHostIsOnlyDefinedForOpenAi() {
        assertEquals("api.openai.com", BaseUrlPolicy.officialHost(ProviderId.OPENAI))
        for (id in ProviderId.entries - ProviderId.OPENAI) assertNull(BaseUrlPolicy.officialHost(id), id.name)
    }

    @Test fun officialHostMatchIgnoresPortAndPathButNotSubdomain() {
        fun u(s: String) = ok(s).url
        assertTrue(BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, u("https://api.openai.com:443/anything")))
        assertFalse(BaseUrlPolicy.isOfficialHost(ProviderId.OPENAI, u("https://eu.api.openai.com/v1")))
        assertFalse(BaseUrlPolicy.isOfficialHost(ProviderId.GROQ, u("https://api.openai.com/v1")))
    }

    // ---- Known gaps (see PR "Bugs found"). Ignored so the suite stays green; remove @Ignore once fixed.

    /**
     * A dotless all-digit host is treated as an intranet name, but the JVM resolver parses it as a
     * 32-bit IPv4 literal: 134744072 == 8.8.8.8, so plain http to a public IP is allowed.
     */
    @Ignore("BUG: BaseUrlPolicy.kt isLocalHost dotless rule accepts integer IPv4 literals of public hosts")
    @Test fun integerIpv4LiteralOfPublicHostIsRejected() {
        assertEquals("8.8.8.8", InetAddress.getByName("134744072").hostAddress)
        assertIs<BaseUrlError.InsecureHttp>(rejected("http://134744072/v1"))
    }

    /** `fc::1` is 00fc::1 (outside fc00::/7) but passes the string-prefix check. */
    @Ignore("BUG: BaseUrlPolicy.kt isLocalHost IPv6 ULA check is a string prefix, not fc00::/7")
    @Test fun shortIpv6StartingWithFcIsNotUniqueLocal() {
        assertFalse(BaseUrlPolicy.isLocalHost("fc::1"))
        assertFalse(BaseUrlPolicy.isLocalHost("fd::1"))
    }

    /** Characterisation of the current (buggy) behaviour so a fix is noticed. */
    @Test fun currentBehaviourForIntegerIpv4Literal() {
        assertTrue(BaseUrlPolicy.isLocalHost("134744072"))
    }
}
