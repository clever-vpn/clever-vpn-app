package com.clevervpn.app.bridge

import org.json.JSONArray
import org.json.JSONObject

/**
 * bridge@3 的壳侧唯一判决点：方法白名单、参数校验、错误信封。
 * 与 Windows / macOS 的实现同构（同一份 docs/BRIDGE.md）。
 */
class BridgeDispatcher(private val backend: ShellBackend) {

    suspend fun handle(raw: String): String {
        var id: String? = null
        return try {
            val root = JSONObject(raw)
            id = root.optString("id").ifBlank { null }
            val method = root.optString("method")
            if (method.isBlank()) throw ShellException(ShellErrorKind.INTERNAL, "缺少 method")
            if (method !in METHODS) throw ShellException(ShellErrorKind.INTERNAL, "未知方法 $method")
            val args = root.optJSONObject("args")
            val result = dispatch(method, args)
            ok(id, result)
        } catch (e: ShellException) {
            fail(id, e.kind.code, e.message ?: "")
        } catch (e: Exception) {
            fail(id, "INTERNAL", e.message ?: e.toString())
        }
    }

    suspend fun stateEventJson(): String {
        val payload = backend.state().toJson()
        return JSONObject().put("event", "state").put("payload", payload).toString()
    }

    private suspend fun dispatch(method: String, args: JSONObject?): Any? = when (method) {
        "capabilities" -> backend.capabilities()
        "activate" -> { backend.activate(requireString(args, "key")); null }
        "deactivate" -> { backend.deactivate(); null }
        "lines" -> {
            val refresh = args?.optBoolean("refresh", false) ?: false
            val lines = JSONArray(backend.lines(refresh).map { it.toJson() })
            JSONObject().put("lines", lines)
        }
        "setLine" -> { backend.setLine(requireInt(args, "id")); null }
        "connect" -> { backend.connect(); null }
        "disconnect" -> { backend.disconnect(); null }
        "state" -> backend.state().toJson()
        "settings" -> backend.settings().toJson()
        "setProtocol" -> { backend.setProtocol(requireProtocol(args)); null }
        "setSplit" -> {
            val split = SplitInfo.from(args?.optJSONObject("split"))
                ?: throw ShellException(ShellErrorKind.INTERNAL, "缺少参数 split")
            backend.setSplit(split)
            null
        }
        "open" -> { backend.open(requireHttps(args)); null }
        "on" -> null
        "crmRequest" -> backend.crmRequest(parseCrmRequest(args)).toJson()
        else -> throw ShellException(ShellErrorKind.INTERNAL, "未知方法 $method")
    }

    // ── 参数校验 ─────────────────────────────────────────────

    private fun requireString(args: JSONObject?, name: String): String {
        val value = args?.optString(name).orEmpty()
        if (value.isBlank()) throw ShellException(ShellErrorKind.INTERNAL, "缺少参数 $name")
        return value
    }

    private fun requireInt(args: JSONObject?, name: String): Int {
        val value = args?.opt(name)
        if (value !is Number) throw ShellException(ShellErrorKind.INTERNAL, "参数 $name 必须是整数")
        return value.toInt()
    }

    private fun requireProtocol(args: JSONObject?): String {
        val value = requireString(args, "protocol")
        if (value !in PROTOCOLS) throw ShellException(ShellErrorKind.INTERNAL, "未知协议 $value")
        return value
    }

    private fun requireHttps(args: JSONObject?): String {
        val value = requireString(args, "url")
        if (!value.startsWith("https://") || value.startsWith("https:///")) {
            throw ShellException(ShellErrorKind.INTERNAL, "只允许 https 链接")
        }
        return value
    }

    private fun parseCrmRequest(args: JSONObject?): CrmRequestInfo {
        if (args == null) throw ShellException(ShellErrorKind.INTERNAL, "缺少 CRM 请求参数")
        val method = args.optString("method").uppercase()
        if (method != "GET" && method != "POST") {
            throw ShellException(ShellErrorKind.INTERNAL, "CRM 请求方法只允许 GET/POST")
        }
        val path = args.optString("path")
        if (!path.startsWith("/") || path.startsWith("//") || path.contains("://")) {
            throw ShellException(ShellErrorKind.INTERNAL, "path 必须以 / 开头，且不能是绝对 URL")
        }
        if (path.length > 2048) throw ShellException(ShellErrorKind.INTERNAL, "path 过长")

        val headers = mutableMapOf<String, String>()
        args.optJSONObject("headers")?.let { given ->
            given.keys().forEach { name ->
                if (name.lowercase() !in ALLOWED_HEADERS) {
                    throw ShellException(ShellErrorKind.INTERNAL, "CRM 请求不接受头 $name（只允许 authorization / accept / content-type）")
                }
                val value = given.optString(name)
                if (value.isEmpty()) throw ShellException(ShellErrorKind.INTERNAL, "头 $name 必须是字符串")
                headers[name] = value
            }
        }

        val body = if (args.has("body") && !args.isNull("body")) args.optString("body") else null
        if (body != null && body.toByteArray().size > CRM_BODY_LIMIT) {
            throw ShellException(ShellErrorKind.INTERNAL, "CRM 请求体过大")
        }

        val timeout = if (args.has("timeoutMs")) args.optInt("timeoutMs").coerceIn(TIMEOUT_MIN, TIMEOUT_MAX) else TIMEOUT_DEFAULT
        return CrmRequestInfo(method, path, headers.ifEmpty { null }, body, timeout)
    }

    // ── 信封 ─────────────────────────────────────────────────

    private fun ok(id: String?, result: Any?): String = JSONObject()
        .put("id", id ?: JSONObject.NULL)
        .put("ok", true)
        .put("result", result ?: JSONObject.NULL)
        .toString()

    private fun fail(id: String?, code: String, message: String): String = JSONObject()
        .put("id", id ?: JSONObject.NULL)
        .put("ok", false)
        .put("error", JSONObject().put("code", code).put("message", message))
        .toString()

    companion object {
        val METHODS = listOf(
            "capabilities", "activate", "deactivate", "lines", "setLine", "connect",
            "disconnect", "state", "settings", "setProtocol", "setSplit", "open", "on",
            "crmRequest",
        )
        private val PROTOCOLS = setOf("auto", "udpTunnel", "udpFast", "udpStable", "tcpFast", "tcpStable")
        private val ALLOWED_HEADERS = setOf("authorization", "accept", "content-type")
        private const val CRM_BODY_LIMIT = 64 * 1024
        private const val TIMEOUT_MIN = 13_000
        private const val TIMEOUT_MAX = 30_000
        private const val TIMEOUT_DEFAULT = 15_000
    }
}
