import Foundation

/// bridge@3 的壳侧唯一判决点：方法白名单、参数校验、错误信封。
/// 与 Windows 的 `CleverVpn.Core.Bridge.BridgeDispatcher` 同构（同一份 docs/BRIDGE.md）。
@MainActor
public final class BridgeDispatcher {
    public static let methods = [
        "capabilities", "activate", "deactivate", "lines", "setLine", "connect",
        "disconnect", "state", "settings", "setProtocol", "setSplit", "open", "on",
        "crmRequest",
    ]

    private static let protocols: Set<String> = [
        "auto", "udpTunnel", "udpFast", "udpStable", "tcpFast", "tcpStable",
    ]

    private static let allowedHeaders: Set<String> = ["authorization", "accept", "content-type"]
    private static let crmBodyLimit = 64 * 1024
    private static let timeoutMin = 13_000
    private static let timeoutMax = 30_000
    private static let timeoutDefault = 15_000

    private let backend: ShellBackend
    public init(backend: ShellBackend) { self.backend = backend }

    public func handle(_ raw: String) async -> String {
        var id: String?
        do {
            guard let data = raw.data(using: .utf8),
                  let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw ShellError.internalError("请求必须是对象")
            }
            id = root["id"] as? String
            guard let method = root["method"] as? String, !method.isEmpty else {
                throw ShellError.internalError("缺少 method")
            }
            guard Self.methods.contains(method) else {
                throw ShellError.internalError("未知方法 \(method)")
            }
            let args = root["args"] as? [String: Any]
            let result = try await dispatch(method, args)
            return ok(id, result)
        } catch let error as ShellError {
            return fail(id, error.kind.code, error.message)
        } catch {
            return fail(id, "INTERNAL", error.localizedDescription)
        }
    }

    /// `state` 事件的一帧（App 负责在 UI 线程 evaluateJavaScript 投递）。
    public func stateEventJson() async throws -> String {
        let state = try await backend.state()
        return try serialize(["event": "state", "payload": state.json])
    }

    private func dispatch(_ method: String, _ args: [String: Any]?) async throws -> Any? {
        switch method {
        case "capabilities":
            return await backend.capabilities()
        case "activate":
            try await backend.activate(key: try requireString(args, "key"))
            return nil
        case "deactivate":
            try await backend.deactivate()
            return nil
        case "lines":
            let refresh = (args?["refresh"] as? Bool) ?? false
            let lines = try await backend.lines(refresh: refresh)
            return ["lines": lines.map { $0.json }]
        case "setLine":
            try await backend.setLine(id: try requireInt(args, "id"))
            return nil
        case "connect":
            try await backend.connect()
            return nil
        case "disconnect":
            try await backend.disconnect()
            return nil
        case "state":
            return try await backend.state().json
        case "settings":
            return try await backend.settings().json
        case "setProtocol":
            try await backend.setProtocol(try requireProtocol(args))
            return nil
        case "setSplit":
            guard let split = SplitResult.from(json: args?["split"]) else {
                throw ShellError.internalError("缺少参数 split")
            }
            try await backend.setSplit(split)
            return nil
        case "open":
            try await backend.open(url: try requireHttps(args))
            return nil
        case "on":
            return nil
        case "crmRequest":
            return try await backend.crmRequest(try parseCrmRequest(args)).json
        default:
            throw ShellError.internalError("未知方法 \(method)")
        }
    }

    // MARK: - 参数校验

    private func requireString(_ args: [String: Any]?, _ name: String) throws -> String {
        guard let value = args?[name] as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw ShellError.internalError("缺少参数 \(name)")
        }
        return value
    }

    private func requireInt(_ args: [String: Any]?, _ name: String) throws -> Int {
        if let value = args?[name] as? Int { return value }
        if let number = args?[name] as? NSNumber { return number.intValue }
        throw ShellError.internalError("参数 \(name) 必须是整数")
    }

    private func requireProtocol(_ args: [String: Any]?) throws -> String {
        let value = try requireString(args, "protocol")
        guard Self.protocols.contains(value) else {
            throw ShellError.internalError("未知协议 \(value)")
        }
        return value
    }

    private func requireHttps(_ args: [String: Any]?) throws -> String {
        let raw = try requireString(args, "url")
        guard let components = URLComponents(string: raw), components.scheme == "https", components.host != nil else {
            throw ShellError.internalError("只允许 https 链接")
        }
        return raw
    }

    private func parseCrmRequest(_ args: [String: Any]?) throws -> CrmRequestInfo {
        guard let args else { throw ShellError.internalError("缺少 CRM 请求参数") }
        let method = (args["method"] as? String ?? "").uppercased()
        guard method == "GET" || method == "POST" else {
            throw ShellError.internalError("CRM 请求方法只允许 GET/POST")
        }
        let path = args["path"] as? String ?? ""
        guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("://") else {
            throw ShellError.internalError("path 必须以 / 开头，且不能是绝对 URL")
        }
        guard path.count <= 2048 else { throw ShellError.internalError("path 过长") }

        var headers: [String: String] = [:]
        if let given = args["headers"] as? [String: Any] {
            for (name, value) in given {
                guard Self.allowedHeaders.contains(name.lowercased()) else {
                    throw ShellError.internalError("CRM 请求不接受头 \(name)（只允许 authorization / accept / content-type）")
                }
                guard let text = value as? String else {
                    throw ShellError.internalError("头 \(name) 必须是字符串")
                }
                headers[name] = text
            }
        }

        let body = args["body"] as? String
        if let body, body.utf8.count > Self.crmBodyLimit {
            throw ShellError.internalError("CRM 请求体过大")
        }

        let timeout = (args["timeoutMs"] as? Int).map { min(max($0, Self.timeoutMin), Self.timeoutMax) } ?? Self.timeoutDefault
        return CrmRequestInfo(method: method, path: path, headers: headers.isEmpty ? nil : headers, body: body, timeoutMs: timeout)
    }

    // MARK: - 信封

    private func ok(_ id: String?, _ result: Any?) -> String {
        let payload: [String: Any] = ["id": id ?? NSNull(), "ok": true, "result": result ?? NSNull()]
        return (try? serialize(payload)) ?? "{\"id\":null,\"ok\":false,\"error\":{\"code\":\"INTERNAL\",\"message\":\"序列化失败\"}}"
    }

    private func fail(_ id: String?, _ code: String, _ message: String) -> String {
        let payload: [String: Any] = [
            "id": id ?? NSNull(),
            "ok": false,
            "error": ["code": code, "message": message],
        ]
        return (try? serialize(payload)) ?? "{\"id\":null,\"ok\":false,\"error\":{\"code\":\"INTERNAL\",\"message\":\"序列化失败\"}}"
    }

    private func serialize(_ object: Any) throws -> String {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw ShellError.internalError("响应不是合法 JSON")
        }
        let data = try JSONSerialization.data(withJSONObject: object, options: [])
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
