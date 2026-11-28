package com.clevervpn.app.bridge

import org.json.JSONArray
import org.json.JSONObject

/** 壳内部的中性错误分类（kit 的错误码在 KitBackend 里映射到这里）。 */
enum class ShellErrorKind(val code: String) {
    EXPIRED("EXPIRED"),
    FROZEN("FROZEN"),
    DEVICE_LIMIT("DEVICE_LIMIT"),
    NETWORK("NETWORK"),
    INTERNAL("INTERNAL"),
}

class ShellException(val kind: ShellErrorKind, message: String) : Exception(message)

data class LineInfo(
    val id: Int,
    val label: String,
    val factor: Double,
    val icon: String?,
    val iconKind: String?,
    val isDefault: Boolean?,
    val hasRelay: Boolean,
    val hasUpstream: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("label", label)
        .put("factor", factor)
        .put("icon", icon ?: JSONObject.NULL)
        .put("iconKind", iconKind ?: JSONObject.NULL)
        .put("isDefault", isDefault ?: JSONObject.NULL)
        .put("hasRelay", hasRelay)
        .put("hasUpstream", hasUpstream)
}

data class StateInfo(
    val status: String,
    val errorCode: String?,
    val errorMessage: String?,
    val since: Long?,
    val lineId: Int?,
    val lineLabel: String?,
    val bytesIn: Long,
    val bytesOut: Long,
    val activated: Boolean,
) {
    fun toJson(): JSONObject {
        val line = if (lineId != null) JSONObject().put("id", lineId).put("label", lineLabel ?: "") else JSONObject.NULL
        val error = if (errorCode != null) JSONObject().put("code", errorCode).put("message", errorMessage ?: "") else JSONObject.NULL
        return JSONObject()
            .put("status", status)
            .put("error", error)
            .put("since", since ?: JSONObject.NULL)
            .put("line", line)
            .put("bytesIn", bytesIn)
            .put("bytesOut", bytesOut)
            .put("activated", activated)
    }
}

data class SplitInfo(
    val regionEnable: Boolean,
    val regionCode: String,
    val ipEnable: Boolean,
    val ipCidr: List<String>,
    val domainEnable: Boolean,
    val domain: List<String>,
    val domainSuffix: List<String>,
    val domainRegex: List<String>,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("region", JSONObject().put("enable", regionEnable).put("code", regionCode.ifBlank { "CN" }))
        .put("ip", JSONObject().put("enable", ipEnable).put("ip_cidr", JSONArray(ipCidr)))
        .put(
            "domain",
            JSONObject()
                .put("enable", domainEnable)
                .put("domain", JSONArray(domain))
                .put("domain_suffix", JSONArray(domainSuffix))
                .put("domain_regex", JSONArray(domainRegex)),
        )

    companion object {
        fun default(): SplitInfo = SplitInfo(
            regionEnable = true,
            regionCode = "CN",
            ipEnable = false,
            ipCidr = emptyList(),
            domainEnable = false,
            domain = emptyList(),
            domainSuffix = emptyList(),
            domainRegex = emptyList(),
        )

        fun from(json: JSONObject?): SplitInfo? {
            if (json == null) return null
            val region = json.optJSONObject("region") ?: JSONObject()
            val ip = json.optJSONObject("ip") ?: JSONObject()
            val domain = json.optJSONObject("domain") ?: JSONObject()
            return SplitInfo(
                regionEnable = region.optBoolean("enable", false),
                regionCode = region.optString("code", "CN").ifBlank { "CN" },
                ipEnable = ip.optBoolean("enable", false),
                ipCidr = ip.optJSONArray("ip_cidr").toStringList(),
                domainEnable = domain.optBoolean("enable", false),
                domain = domain.optJSONArray("domain").toStringList(),
                domainSuffix = domain.optJSONArray("domain_suffix").toStringList(),
                domainRegex = domain.optJSONArray("domain_regex").toStringList(),
            )
        }

        private fun JSONArray?.toStringList(): List<String> {
            if (this == null) return emptyList()
            return (0 until length()).map { optString(it) }.filter { it.isNotEmpty() }
        }
    }
}

data class SettingsInfo(val protocol: String, val split: SplitInfo) {
    fun toJson(): JSONObject = JSONObject().put("protocol", protocol).put("split", split.toJson())
}

data class CrmRequestInfo(
    val method: String,
    val path: String,
    val headers: Map<String, String>?,
    val body: String?,
    val timeoutMs: Int,
)

data class CrmResultInfo(val status: Int, val body: String) {
    fun toJson(): JSONObject = JSONObject().put("status", status).put("body", body)
}

/** 壳的能力面（App 里的 KitBackend 用 VpnClient 实现；单测用假的实现）。 */
interface ShellBackend {
    suspend fun capabilities(): JSONObject
    suspend fun activate(key: String)
    suspend fun deactivate()
    suspend fun lines(refresh: Boolean): List<LineInfo>
    suspend fun setLine(id: Int)
    suspend fun connect()
    suspend fun disconnect()
    suspend fun state(): StateInfo
    suspend fun settings(): SettingsInfo
    suspend fun setProtocol(protocol: String)
    suspend fun setSplit(split: SplitInfo)
    suspend fun open(url: String)
    suspend fun crmRequest(request: CrmRequestInfo): CrmResultInfo
}
