import AppKit
import Combine
import CleverVpnKit
import CleverVpnShellCore
import Foundation

/// 用闭源 kit（CleverVpnKit）实现 `ShellBackend`。只做映射、归一化、订阅；业务判断全在 kit/服务端。
@MainActor
final class KitBackend: ShellBackend {
    let manifest: AppManifest
    var onStateChanged: (() -> Void)?

    private var cancellables = Set<AnyCancellable>()

    init(manifest: AppManifest) {
        self.manifest = manifest
        // 任何会影响 bridge.state 的变化都推一帧（页面以 state() 为准，事件只是通知）。
        vpnClient.objectWillChange
            .sink { [weak self] _ in self?.onStateChanged?() }
            .store(in: &cancellables)
        VPNTrafficModel.shared.objectWillChange
            .sink { [weak self] _ in self?.onStateChanged?() }
            .store(in: &cancellables)
        VPNTrafficModel.shared.setAppGateOpen(true)
        VPNTrafficModel.shared.setViewGateOpen(true)
    }

    /// App 启动时调一次：系统扩展的激活由 App 发起（首次会弹系统设置授权）。
    static func installExtensionIfNeeded() {
        ExtensionInstaller().activateIfNeeded()
    }

    func capabilities() async -> [String: Any] {
        ["bridge": "3", "platform": "macos", "store": NSNull()]
    }

    func activate(key: String) async throws {
        vpnClient.activate(key: key)
        try await settle()
        if let error = vpnClient.lastError { throw map(error) }
    }

    func deactivate() async throws {
        vpnClient.deActivate()
        try await settle()
        if let error = vpnClient.lastError { throw map(error) }
    }

    func lines(refresh: Bool) async throws -> [LineInfo] {
        if refresh {
            vpnClient.refreshLines()
            try await Task.sleep(nanoseconds: 300_000_000)
        }
        return vpnClient.lines.map {
            LineInfo(id: $0.id, label: $0.label, factor: $0.factor, icon: $0.icon,
                     iconKind: $0.iconKind, isDefault: $0.isDefault, hasRelay: $0.hasRelay,
                     hasUpstream: $0.hasUpstream)
        }
    }

    func setLine(id: Int) async throws {
        vpnClient.updateLine(id: id)
        try await settle(ms: 150)
        if let error = vpnClient.lastError { throw map(error) }
    }

    func connect() async throws {
        vpnClient.lastError = nil
        vpnClient.startVPN()
        try await settle()
        if let error = vpnClient.lastError { throw map(error) }
    }

    func disconnect() async throws {
        vpnClient.stopVPN()
        try await settle(ms: 300)
        if let error = vpnClient.lastError { throw map(error) }
    }

    func state() async throws -> StateResult {
        let status: String
        switch vpnClient.status {
        case .connected: status = "connected"
        case .connecting, .reasserting: status = "connecting"
        default: status = vpnClient.lastError != nil ? "error" : "disconnected"
        }

        let errorCode = vpnClient.lastError.map { map($0).kind.code }
        let errorMessage = vpnClient.lastError?.description
        let line: (id: Int, label: String)? = {
            guard let user = vpnClient.userInfo, user.line > 0 else { return nil }
            let label = vpnClient.lines.first(where: { $0.id == user.line })?.label ?? ""
            return (user.line, label)
        }()
        let traffic = VPNTrafficModel.shared.traffic
        let since = vpnClient.connectedDate.map { Int64($0.timeIntervalSince1970 * 1000) }
        return StateResult(
            status: status,
            errorCode: errorCode,
            errorMessage: errorMessage,
            since: since,
            line: line,
            bytesIn: traffic?.downlinkTotal ?? 0,
            bytesOut: traffic?.uplinkTotal ?? 0,
            activated: vpnClient.userInfo?.activated ?? false
        )
    }

    func settings() async throws -> SettingsResult {
        let user = vpnClient.userInfo
        return SettingsResult(protocolName: (user?.protocolType ?? .auto).rawValue, split: map(user?.splitInfo ?? Split()))
    }

    func setProtocol(_ protocolName: String) async throws {
        guard let type = ProtocolType(rawValue: protocolName) else {
            throw ShellError.internalError("未知协议 \(protocolName)")
        }
        vpnClient.updateProtocolType(protocolType: type)
        try await settle(ms: 150)
        if let error = vpnClient.lastError { throw map(error) }
    }

    func setSplit(_ split: SplitResult) async throws {
        let mapped = Split(
            region: Region(enable: split.regionEnable, code: split.regionCode.isEmpty ? "CN" : split.regionCode),
            ip: IpRule(enable: split.ipEnable, ipCidr: split.ipCidr),
            domain: DomainRule(enable: split.domainEnable, domain: split.domain,
                               domainSuffix: split.domainSuffix, domainRegex: split.domainRegex)
        )
        vpnClient.updateSplitInfo(splitInfo: mapped)
        try await settle(ms: 150)
        if let error = vpnClient.lastError { throw map(error) }
    }

    func open(url: String) async throws {
        guard let target = URL(string: url), target.scheme == "https" else {
            throw ShellError.internalError("只允许 https 链接")
        }
        if !NSWorkspace.shared.open(target) {
            throw ShellError.internalError("没能在系统浏览器里打开链接")
        }
    }

    func crmRequest(_ request: CrmRequestInfo) async throws -> CrmResultInfo {
        guard !manifest.crmBase.isEmpty else {
            throw ShellError.internalError("app.json 的 crm.base 为空：这个 App 没有接 CRM")
        }
        do {
            let response = try await vpnClient.crmRequest(
                base: manifest.crmBase,
                method: request.method,
                path: request.path,
                headers: request.headers,
                body: request.body,
                timeoutMs: request.timeoutMs
            )
            return CrmResultInfo(status: response.status, body: response.body)
        } catch let error as ShellError {
            throw error
        } catch {
            // 4xx/5xx 在 CrmResponse.status 里；能到这里的都是传输失败。
            throw ShellError.network(error.localizedDescription)
        }
    }

    // MARK: - 映射

    private func map(_ split: Split) -> SplitResult {
        SplitResult(
            regionEnable: split.region.enable,
            regionCode: split.region.code.isEmpty ? "CN" : split.region.code,
            ipEnable: split.ip.enable,
            ipCidr: split.ip.ipCidr,
            domainEnable: split.domain.enable,
            domain: split.domain.domain,
            domainSuffix: split.domain.domainSuffix,
            domainRegex: split.domain.domainRegex
        )
    }

    /// kit 的错误 → bridge 五码（DEVICE_LIMIT 在 kit 里没有对应码：v1 不产生）。
    private func map(_ error: CleverVpnError) -> ShellError {
        switch error {
        case .customerFrozen:
            return ShellError(.frozen, error.description)
        case .networkError, .httpError, .connectError, .tunnelError:
            return ShellError(.network, error.description)
        default:
            return ShellError(.internalError, error.description)
        }
    }

    /// 等 kit 把异步结果落进 published（v1 用短轮询；不阻塞太久）。
    private func settle(ms: Int = 600) async throws {
        try await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
    }
}
