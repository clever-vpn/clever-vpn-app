package com.clevervpn.app.bridge

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeBackend : ShellBackend {
    var lastLine: Int? = null
    var lastProtocol: String? = null
    var lastSplit: SplitInfo? = null
    var openedUrl: String? = null
    var lastCrm: CrmRequestInfo? = null

    override suspend fun capabilities(): JSONObject = JSONObject()
        .put("bridge", "3").put("platform", "android").put("store", JSONObject.NULL)

    override suspend fun activate(key: String) {}
    override suspend fun deactivate() {}

    override suspend fun lines(refresh: Boolean): List<LineInfo> = listOf(
        LineInfo(1, "香港 01", 1.0, "HK", "flag", true, true, false),
    )

    override suspend fun setLine(id: Int) { lastLine = id }
    override suspend fun connect() {}
    override suspend fun disconnect() {}

    override suspend fun state(): StateInfo = StateInfo(
        status = "disconnected", errorCode = null, errorMessage = null, since = null,
        lineId = null, lineLabel = null, bytesIn = 0, bytesOut = 0, activated = false,
    )

    override suspend fun settings(): SettingsInfo = SettingsInfo("auto", SplitInfo.default())
    override suspend fun setProtocol(protocol: String) { lastProtocol = protocol }
    override suspend fun setSplit(split: SplitInfo) { lastSplit = split }
    override suspend fun open(url: String) { openedUrl = url }

    override suspend fun crmRequest(request: CrmRequestInfo): CrmResultInfo {
        lastCrm = request
        return CrmResultInfo(200, "{}")
    }
}

private class ThrowingBackend : ShellBackend by FakeBackend() {
    override suspend fun connect() {
        throw ShellException(ShellErrorKind.FROZEN, "account frozen")
    }
}

class BridgeDispatcherTest {
    private fun req(id: String, method: String, args: JSONObject? = null): String =
        JSONObject()
            .put("id", id)
            .put("method", method)
            .put("args", args ?: JSONObject.NULL)
            .toString()

    private fun call(backend: ShellBackend, json: String): JSONObject = runBlocking {
        JSONObject(BridgeDispatcher(backend).handle(json))
    }

    @Test
    fun methodsAreThe14ContractMethods() {
        assertEquals(14, BridgeDispatcher.METHODS.size)
        assertEquals(
            listOf(
                "capabilities", "activate", "deactivate", "lines", "setLine", "connect",
                "disconnect", "state", "settings", "setProtocol", "setSplit", "open", "on", "crmRequest",
            ),
            BridgeDispatcher.METHODS,
        )
    }

    @Test
    fun echoesIdAndWrapsResult() {
        val root = call(FakeBackend(), req("17", "capabilities"))
        assertEquals("17", root.getString("id"))
        assertTrue(root.getBoolean("ok"))
        val result = root.getJSONObject("result")
        assertEquals("3", result.getString("bridge"))
        assertEquals("android", result.getString("platform"))
        assertTrue(result.isNull("store"))
    }

    @Test
    fun unknownMethodIsRejected() {
        val root = call(FakeBackend(), req("2", "readFile"))
        assertFalse(root.getBoolean("ok"))
        assertEquals("INTERNAL", root.getJSONObject("error").getString("code"))
    }

    @Test
    fun activateRequiresKey() {
        val root = call(FakeBackend(), req("3", "activate", JSONObject().put("key", "")))
        assertFalse(root.getBoolean("ok"))
    }

    @Test
    fun setLineRequiresInteger() {
        val bad = call(FakeBackend(), req("4", "setLine", JSONObject().put("id", "2")))
        assertFalse(bad.getBoolean("ok"))
        val backend = FakeBackend()
        val ok = call(backend, req("5", "setLine", JSONObject().put("id", 2)))
        assertTrue(ok.getBoolean("ok"))
        assertEquals(2, backend.lastLine)
    }

    @Test
    fun linesPassesRefresh() {
        val root = call(FakeBackend(), req("6", "lines", JSONObject().put("refresh", true)))
        val lines = root.getJSONObject("result").getJSONArray("lines")
        assertEquals(1, lines.length())
        assertEquals("HK", lines.getJSONObject(0).getString("icon"))
    }

    @Test
    fun setSplitNormalizesEmptyRegion() {
        val split = JSONObject()
            .put("region", JSONObject().put("enable", true).put("code", ""))
            .put("ip", JSONObject().put("enable", false).put("ip_cidr", JSONObject.NULL))
            .put("domain", JSONObject().put("enable", false).put("domain", JSONObject.NULL)
                .put("domain_suffix", JSONObject.NULL).put("domain_regex", JSONObject.NULL))
        val backend = FakeBackend()
        val root = call(backend, req("7", "setSplit", JSONObject().put("split", split)))
        assertTrue(root.getBoolean("ok"))
        assertEquals("CN", backend.lastSplit?.regionCode)
    }

    @Test
    fun setProtocolOnlySixValues() {
        val bad = call(FakeBackend(), req("8", "setProtocol", JSONObject().put("protocol", "wireguard")))
        assertFalse(bad.getBoolean("ok"))
        val backend = FakeBackend()
        val ok = call(backend, req("9", "setProtocol", JSONObject().put("protocol", "tcpFast")))
        assertTrue(ok.getBoolean("ok"))
        assertEquals("tcpFast", backend.lastProtocol)
    }

    @Test
    fun openOnlyHttps() {
        val bad = call(FakeBackend(), req("10", "open", JSONObject().put("url", "http://example.com")))
        assertFalse(bad.getBoolean("ok"))
        val backend = FakeBackend()
        val ok = call(backend, req("11", "open", JSONObject().put("url", "https://example.com/terms")))
        assertTrue(ok.getBoolean("ok"))
        assertEquals("https://example.com/terms", backend.openedUrl)
    }

    @Test
    fun crmRejectsAbsoluteUrlAndForeignHeaders() {
        assertFalse(call(FakeBackend(), req("12", "crmRequest", JSONObject()
            .put("method", "GET").put("path", "https://evil.example/plans"))).getBoolean("ok"))
        assertFalse(call(FakeBackend(), req("13", "crmRequest", JSONObject()
            .put("method", "GET").put("path", "/plans")
            .put("headers", JSONObject().put("cookie", "x")))).getBoolean("ok"))
        assertFalse(call(FakeBackend(), req("14", "crmRequest", JSONObject()
            .put("method", "PUT").put("path", "/plans"))).getBoolean("ok"))
    }

    @Test
    fun crmClampsTimeoutAndPassesThrough() {
        val backend = FakeBackend()
        val root = call(backend, req("15", "crmRequest", JSONObject()
            .put("method", "GET").put("path", "/plans")
            .put("headers", JSONObject().put("accept", "application/json"))
            .put("timeoutMs", 1000)))
        assertTrue(root.getBoolean("ok"))
        assertEquals(200, root.getJSONObject("result").getInt("status"))
        assertEquals(13_000, backend.lastCrm!!.timeoutMs)
    }

    @Test
    fun backendErrorMapsToBridgeCode() {
        val root = call(ThrowingBackend(), req("16", "connect"))
        assertFalse(root.getBoolean("ok"))
        assertEquals("FROZEN", root.getJSONObject("error").getString("code"))
    }

    @Test
    fun stateEventShape() = runBlocking {
        val json = BridgeDispatcher(FakeBackend()).stateEventJson()
        val root = JSONObject(json)
        assertEquals("state", root.getString("event"))
        assertEquals("disconnected", root.getJSONObject("payload").getString("status"))
    }
}
