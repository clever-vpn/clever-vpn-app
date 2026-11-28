import Foundation

/// `dist/manifest.json`（壳唯一要读的构建产物）：页面不能指定 crm.base。
public struct AppManifest {
    public let name: String
    public let version: String
    public let crmBase: String
    public let crmId: String
    public let bundleIds: [String: String]

    public static func load(path: String) throws -> AppManifest {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ShellError.internalError("manifest.json 不是对象")
        }
        let crm = root["crm"] as? [String: Any] ?? [:]
        let bundle = root["bundle_id"] as? [String: String] ?? [:]
        var version = root["version"] as? String ?? "dev"
        if version.hasPrefix("v") { version.removeFirst() }
        return AppManifest(
            name: root["name"] as? String ?? "Clever VPN",
            version: version,
            crmBase: crm["base"] as? String ?? "",
            crmId: crm["id"] as? String ?? "",
            bundleIds: bundle
        )
    }
}
