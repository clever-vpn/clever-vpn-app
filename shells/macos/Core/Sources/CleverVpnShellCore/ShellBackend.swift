import Foundation

/// 壳的能力面。App 里的 `KitBackend` 用 CleverVpnKit 实现；单测用假的实现。
@MainActor
public protocol ShellBackend: AnyObject {
    func capabilities() async -> [String: Any]
    func activate(key: String) async throws
    func deactivate() async throws
    func lines(refresh: Bool) async throws -> [LineInfo]
    func setLine(id: Int) async throws
    func connect() async throws
    func disconnect() async throws
    func state() async throws -> StateResult
    func settings() async throws -> SettingsResult
    func setProtocol(_ protocolName: String) async throws
    func setSplit(_ split: SplitResult) async throws
    func open(url: String) async throws
    func crmRequest(_ request: CrmRequestInfo) async throws -> CrmResultInfo
}
