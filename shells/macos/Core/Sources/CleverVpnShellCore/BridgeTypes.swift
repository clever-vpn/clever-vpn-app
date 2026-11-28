import Foundation

/// 壳内部的中性错误分类（kit 的错误码在 App 的 KitBackend 里映射到这里）。
public enum ShellErrorKind: String {
    case expired = "EXPIRED"
    case frozen = "FROZEN"
    case deviceLimit = "DEVICE_LIMIT"
    case network = "NETWORK"
    case internalError = "INTERNAL"

    public var code: String { rawValue }
}

public struct ShellError: Error {
    public let kind: ShellErrorKind
    public let message: String

    public init(_ kind: ShellErrorKind, _ message: String) {
        self.kind = kind
        self.message = message
    }

    public static func internalError(_ message: String) -> ShellError { .init(.internalError, message) }
    public static func network(_ message: String) -> ShellError { .init(.network, message) }
}

public struct LineInfo {
    public var id: Int
    public var label: String
    public var factor: Double
    public var icon: String?
    public var iconKind: String?
    public var isDefault: Bool?
    public var hasRelay: Bool
    public var hasUpstream: Bool

    public init(id: Int, label: String, factor: Double, icon: String?, iconKind: String?,
                isDefault: Bool?, hasRelay: Bool, hasUpstream: Bool) {
        self.id = id
        self.label = label
        self.factor = factor
        self.icon = icon
        self.iconKind = iconKind
        self.isDefault = isDefault
        self.hasRelay = hasRelay
        self.hasUpstream = hasUpstream
    }

    public var json: [String: Any] {
        [
            "id": id,
            "label": label,
            "factor": factor,
            "icon": icon ?? NSNull(),
            "iconKind": iconKind ?? NSNull(),
            "isDefault": isDefault ?? NSNull(),
            "hasRelay": hasRelay,
            "hasUpstream": hasUpstream,
        ]
    }
}

public struct StateResult {
    public var status: String
    public var errorCode: String?
    public var errorMessage: String?
    public var since: Int64?
    public var line: (id: Int, label: String)?
    public var bytesIn: Int64
    public var bytesOut: Int64
    public var activated: Bool

    public init(status: String, errorCode: String?, errorMessage: String?, since: Int64?,
                line: (id: Int, label: String)?, bytesIn: Int64, bytesOut: Int64, activated: Bool) {
        self.status = status
        self.errorCode = errorCode
        self.errorMessage = errorMessage
        self.since = since
        self.line = line
        self.bytesIn = bytesIn
        self.bytesOut = bytesOut
        self.activated = activated
    }

    public var json: [String: Any] {
        let error: Any
        if let errorCode {
            error = ["code": errorCode, "message": errorMessage ?? ""]
        } else {
            error = NSNull()
        }
        let lineJson: Any = line.map { ["id": $0.id, "label": $0.label] } ?? NSNull()
        return [
            "status": status,
            "error": error,
            "since": since ?? NSNull(),
            "line": lineJson,
            "bytesIn": bytesIn,
            "bytesOut": bytesOut,
            "activated": activated,
        ]
    }
}

public struct SplitResult {
    public var regionEnable: Bool
    public var regionCode: String
    public var ipEnable: Bool
    public var ipCidr: [String]
    public var domainEnable: Bool
    public var domain: [String]
    public var domainSuffix: [String]
    public var domainRegex: [String]

    public init(regionEnable: Bool, regionCode: String, ipEnable: Bool, ipCidr: [String],
                domainEnable: Bool, domain: [String], domainSuffix: [String], domainRegex: [String]) {
        self.regionEnable = regionEnable
        self.regionCode = regionCode.isEmpty ? "CN" : regionCode
        self.ipEnable = ipEnable
        self.ipCidr = ipCidr
        self.domainEnable = domainEnable
        self.domain = domain
        self.domainSuffix = domainSuffix
        self.domainRegex = domainRegex
    }

    public static func defaultSplit() -> SplitResult {
        .init(regionEnable: true, regionCode: "CN", ipEnable: false, ipCidr: [],
              domainEnable: false, domain: [], domainSuffix: [], domainRegex: [])
    }

    public static func from(json: Any?) -> SplitResult? {
        guard let value = json as? [String: Any],
              let region = value["region"] as? [String: Any],
              let ip = value["ip"] as? [String: Any],
              let domain = value["domain"] as? [String: Any] else { return nil }
        return SplitResult(
            regionEnable: region["enable"] as? Bool ?? false,
            regionCode: region["code"] as? String ?? "CN",
            ipEnable: ip["enable"] as? Bool ?? false,
            ipCidr: ip["ip_cidr"] as? [String] ?? [],
            domainEnable: domain["enable"] as? Bool ?? false,
            domain: domain["domain"] as? [String] ?? [],
            domainSuffix: domain["domain_suffix"] as? [String] ?? [],
            domainRegex: domain["domain_regex"] as? [String] ?? []
        )
    }

    public var json: [String: Any] {
        [
            "region": ["enable": regionEnable, "code": regionCode],
            "ip": ["enable": ipEnable, "ip_cidr": ipCidr],
            "domain": [
                "enable": domainEnable,
                "domain": domain,
                "domain_suffix": domainSuffix,
                "domain_regex": domainRegex,
            ],
        ]
    }
}

public struct SettingsResult {
    public var protocolName: String
    public var split: SplitResult

    public init(protocolName: String, split: SplitResult) {
        self.protocolName = protocolName
        self.split = split
    }

    public var json: [String: Any] {
        ["protocol": protocolName, "split": split.json]
    }
}

public struct CrmRequestInfo {
    public var method: String
    public var path: String
    public var headers: [String: String]?
    public var body: String?
    public var timeoutMs: Int
}

public struct CrmResultInfo {
    public var status: Int
    public var body: String

    public init(status: Int, body: String) {
        self.status = status
        self.body = body
    }

    public var json: [String: Any] { ["status": status, "body": body] }
}
