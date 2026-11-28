package com.clevervpn.app.kit

import com.clevervpn.app.bridge.CrmRequestInfo
import com.clevervpn.app.bridge.CrmResultInfo
import com.clevervpn.app.bridge.LineInfo
import com.clevervpn.app.bridge.SettingsInfo
import com.clevervpn.app.bridge.ShellBackend
import com.clevervpn.app.bridge.ShellErrorKind
import com.clevervpn.app.bridge.ShellException
import com.clevervpn.app.bridge.SplitInfo
import com.clevervpn.app.bridge.StateInfo
import com.clevervpn.app.shell.AppManifest
import com.clevervpn.kit.VpnClient
import com.clevervpn.kit.common.CleverVpnError
import com.clevervpn.kit.common.DomainRule
import com.clevervpn.kit.common.IpRule
import com.clevervpn.kit.common.Protocol
import com.clevervpn.kit.common.Region
import com.clevervpn.kit.common.Split
import com.clevervpn.kit.common.Status
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * 用闭源 kit（VpnClient）实现 ShellBackend。只做映射、归一化与权限请求接线。
 *
 * `ensureVpnPermission` 由 Activity 提供：Android 的 VpnService 授权必须先 `prepare()` +
 * 用户点同意，kit 的 start() 在未授权时会直接报错。
 */
class KitBackend(
    private val client: VpnClient,
    private val manifest: AppManifest,
    private val ensureVpnPermission: suspend () -> Unit,
    private val openExternal: (String) -> Unit,
) : ShellBackend {

    override suspend fun capabilities(): JSONObject = JSONObject()
        .put("bridge", "3")
        .put("platform", "android")
        .put("store", JSONObject.NULL)

    override suspend fun activate(key: String) {
        client.activate(key)?.let { throw map(it) }
    }

    override suspend fun deactivate() {
        client.deactivate()
    }

    override suspend fun lines(refresh: Boolean): List<LineInfo> {
        if (refresh) {
            client.refreshLines()
            delay(500)
        }
        return client.lines.value.map {
            LineInfo(
                id = it.id,
                label = it.label,
                factor = it.factor,
                icon = it.icon,
                iconKind = it.iconKind,
                isDefault = it.isDefault,
                hasRelay = it.hasRelay,
                hasUpstream = it.hasUpstream,
            )
        }
    }

    override suspend fun setLine(id: Int) {
        client.updateLine(id)
    }

    override suspend fun connect() {
        ensureVpnPermission()
        client.start()?.let { throw map(it) }
    }

    override suspend fun disconnect() {
        client.stop()
    }

    override suspend fun state(): StateInfo {
        val user = client.userInfo.value
        val error = client.errorFlow.value
        val status = when {
            error != null -> "error"
            client.currentStatus == Status.Starting -> "connecting"
            client.currentStatus == Status.Started -> "connected"
            else -> "disconnected"
        }
        val lineId = user?.line?.takeIf { it > 0 }
        val lineLabel = lineId?.let { id -> client.lines.value.firstOrNull { it.id == id }?.label } ?: ""
        val traffic = client.trafficFlow.value
        return StateInfo(
            status = status,
            errorCode = error?.let { map(it).kind.code },
            errorMessage = error?.message,
            since = client.startedAtFlow.value,
            lineId = lineId,
            lineLabel = lineLabel,
            bytesIn = traffic?.rxTotal ?: 0,
            bytesOut = traffic?.txTotal ?: 0,
            activated = user?.activated ?: false,
        )
    }

    override suspend fun settings(): SettingsInfo {
        val user = client.userInfo.value
        val split = user?.splitInfo ?: Split()
        return SettingsInfo(
            protocol = protocolName(user?.protocolType ?: Protocol.AUTO),
            split = SplitInfo(
                regionEnable = split.region.enable,
                regionCode = split.region.code.ifBlank { "CN" },
                ipEnable = split.ip.enable,
                ipCidr = split.ip.ipCidr,
                domainEnable = split.domain.enable,
                domain = split.domain.domain,
                domainSuffix = split.domain.domainSuffix,
                domainRegex = split.domain.domainRegex,
            ),
        )
    }

    override suspend fun setProtocol(protocol: String) {
        client.updateProtocolType(parseProtocol(protocol))
    }

    override suspend fun setSplit(split: SplitInfo) {
        client.updateSplitInfo(
            Split(
                region = Region(enable = split.regionEnable, code = split.regionCode.ifBlank { "CN" }),
                ip = IpRule(enable = split.ipEnable, ipCidr = split.ipCidr),
                domain = DomainRule(
                    enable = split.domainEnable,
                    domain = split.domain,
                    domainSuffix = split.domainSuffix,
                    domainRegex = split.domainRegex,
                ),
            ),
        )
    }

    override suspend fun open(url: String) {
        if (!url.startsWith("https://")) throw ShellException(ShellErrorKind.INTERNAL, "只允许 https 链接")
        openExternal(url)
    }

    override suspend fun crmRequest(request: CrmRequestInfo): CrmResultInfo {
        if (manifest.crmBase.isBlank()) {
            throw ShellException(ShellErrorKind.INTERNAL, "app.json 的 crm.base 为空：这个 App 没有接 CRM")
        }
        return try {
            val response = client.crmRequest(
                base = manifest.crmBase,
                method = request.method,
                path = request.path,
                headers = request.headers,
                body = request.body,
                timeoutMs = request.timeoutMs,
            )
            CrmResultInfo(status = response.status, body = response.body)
        } catch (e: ShellException) {
            throw e
        } catch (e: Exception) {
            // 4xx/5xx 在 CrmResponse.status 里；能到这里的都是传输失败。
            throw ShellException(ShellErrorKind.NETWORK, e.message ?: "CRM 请求失败")
        }
    }

    // ── 映射 ─────────────────────────────────────────────────

    private fun protocolName(protocol: Protocol): String = when (protocol) {
        Protocol.AUTO -> "auto"
        Protocol.UDP_TUNNEL -> "udpTunnel"
        Protocol.UDP_FAST -> "udpFast"
        Protocol.UDP_STABLE -> "udpStable"
        Protocol.TCP_FAST -> "tcpFast"
        Protocol.TCP_STABLE -> "tcpStable"
    }

    private fun parseProtocol(name: String): Protocol = when (name) {
        "udpTunnel" -> Protocol.UDP_TUNNEL
        "udpFast" -> Protocol.UDP_FAST
        "udpStable" -> Protocol.UDP_STABLE
        "tcpFast" -> Protocol.TCP_FAST
        "tcpStable" -> Protocol.TCP_STABLE
        else -> Protocol.AUTO
    }

    /** kit 错误 → bridge 五码（DEVICE_LIMIT 在 kit 里没有对应码：v1 不产生）。 */
    private fun map(error: CleverVpnError): ShellException = when (error) {
        is CleverVpnError.CustomerFrozen -> ShellException(ShellErrorKind.FROZEN, error.message)
        is CleverVpnError.NoLicence -> ShellException(ShellErrorKind.EXPIRED, error.message)
        is CleverVpnError.NetworkError,
        is CleverVpnError.HttpError,
        is CleverVpnError.ApiConnectionError,
        is CleverVpnError.ConnectError,
        is CleverVpnError.TunnelError,
        -> ShellException(ShellErrorKind.NETWORK, error.message)
        else -> ShellException(ShellErrorKind.INTERNAL, error.message)
    }
}
