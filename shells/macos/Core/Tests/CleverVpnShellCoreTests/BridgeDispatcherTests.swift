import XCTest
@testable import CleverVpnShellCore

private final class FakeBackend: ShellBackend {
    var lastKey: String?
    var openedURL: String?
    var lastProtocol: String?
    var lastSplit: SplitResult?
    var lastLine: Int?
    var lastCrm: CrmRequestInfo?

    func capabilities() async -> [String: Any] { ["bridge": "3", "platform": "macos", "store": NSNull()] }
    func activate(key: String) async throws { lastKey = key }
    func deactivate() async throws {}
    func lines(refresh: Bool) async throws -> [LineInfo] {
        [LineInfo(id: 1, label: "香港 01", factor: 1, icon: "HK", iconKind: "flag", isDefault: true, hasRelay: true, hasUpstream: false)]
    }
    func setLine(id: Int) async throws { lastLine = id }
    func connect() async throws {}
    func disconnect() async throws {}
    func state() async throws -> StateResult {
        StateResult(status: "disconnected", errorCode: nil, errorMessage: nil, since: nil, line: nil, bytesIn: 0, bytesOut: 0, activated: false)
    }
    func settings() async throws -> SettingsResult {
        SettingsResult(protocolName: "auto", split: .defaultSplit())
    }
    func setProtocol(_ protocolName: String) async throws { lastProtocol = protocolName }
    func setSplit(_ split: SplitResult) async throws { lastSplit = split }
    func open(url: String) async throws { openedURL = url }
    func crmRequest(_ request: CrmRequestInfo) async throws -> CrmResultInfo {
        lastCrm = request
        return CrmResultInfo(status: 200, body: "{}")
    }
}

private final class ThrowingBackend: ShellBackend {
    func capabilities() async -> [String: Any] { [:] }
    func activate(key: String) async throws {}
    func deactivate() async throws {}
    func lines(refresh: Bool) async throws -> [LineInfo] { [] }
    func setLine(id: Int) async throws {}
    func connect() async throws { throw ShellError(.frozen, "account frozen") }
    func disconnect() async throws {}
    func state() async throws -> StateResult { StateResult(status: "disconnected", errorCode: nil, errorMessage: nil, since: nil, line: nil, bytesIn: 0, bytesOut: 0, activated: false) }
    func settings() async throws -> SettingsResult { SettingsResult(protocolName: "auto", split: .defaultSplit()) }
    func setProtocol(_ protocolName: String) async throws {}
    func setSplit(_ split: SplitResult) async throws {}
    func open(url: String) async throws {}
    func crmRequest(_ request: CrmRequestInfo) async throws -> CrmResultInfo { CrmResultInfo(status: 200, body: "{}") }
}

private func call(_ backend: ShellBackend, _ json: String) async throws -> [String: Any] {
    let response = await BridgeDispatcher(backend: backend).handle(json)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any])
}

private func req(_ id: String, _ method: String, _ args: [String: Any]? = nil) -> String {
    let object: [String: Any] = ["id": id, "method": method, "args": args ?? NSNull()]
    let data = try! JSONSerialization.data(withJSONObject: object)
    return String(data: data, encoding: .utf8)!
}

@MainActor
final class BridgeDispatcherTests: XCTestCase {
    func testMethodsAreThe14ContractMethods() {
        XCTAssertEqual(BridgeDispatcher.methods.count, 14)
        XCTAssertEqual(BridgeDispatcher.methods, [
            "capabilities", "activate", "deactivate", "lines", "setLine", "connect",
            "disconnect", "state", "settings", "setProtocol", "setSplit", "open", "on", "crmRequest",
        ])
    }

    func testEchoesIdAndWrapsResult() async throws {
        let root = try await call(FakeBackend(), req("17", "capabilities"))
        XCTAssertEqual(root["id"] as? String, "17")
        XCTAssertEqual(root["ok"] as? Bool, true)
        let result = try XCTUnwrap(root["result"] as? [String: Any])
        XCTAssertEqual(result["bridge"] as? String, "3")
        XCTAssertEqual(result["platform"] as? String, "macos")
        XCTAssertTrue(result["store"] is NSNull)
    }

    func testUnknownMethodIsRejected() async throws {
        let root = try await call(FakeBackend(), req("2", "readFile"))
        XCTAssertEqual(root["ok"] as? Bool, false)
        let error = try XCTUnwrap(root["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "INTERNAL")
    }

    func testActivateRequiresKey() async throws {
        let root = try await call(FakeBackend(), req("3", "activate", ["key": ""]))
        XCTAssertEqual(root["ok"] as? Bool, false)
    }

    func testSetLineRequiresInteger() async throws {
        let bad = try await call(FakeBackend(), req("4", "setLine", ["id": "2"]))
        XCTAssertEqual(bad["ok"] as? Bool, false)
        let backend = FakeBackend()
        let ok = try await call(backend, req("5", "setLine", ["id": 2]))
        XCTAssertEqual(ok["ok"] as? Bool, true)
        XCTAssertEqual(backend.lastLine, 2)
    }

    func testLinesPassesRefresh() async throws {
        let root = try await call(FakeBackend(), req("6", "lines", ["refresh": true]))
        let result = try XCTUnwrap(root["result"] as? [String: Any])
        let lines = try XCTUnwrap(result["lines"] as? [[String: Any]])
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0]["icon"] as? String, "HK")
    }

    func testSetSplitNormalizesEmptyRegion() async throws {
        let backend = FakeBackend()
        let split: [String: Any] = [
            "region": ["enable": true, "code": ""],
            "ip": ["enable": false, "ip_cidr": [String]()],
            "domain": ["enable": false, "domain": [String](), "domain_suffix": [String](), "domain_regex": [String]()],
        ]
        let root = try await call(backend, req("7", "setSplit", ["split": split]))
        XCTAssertEqual(root["ok"] as? Bool, true)
        XCTAssertEqual(backend.lastSplit?.regionCode, "CN")
    }

    func testSetProtocolOnlySixValues() async throws {
        let bad = try await call(FakeBackend(), req("8", "setProtocol", ["protocol": "wireguard"]))
        XCTAssertEqual(bad["ok"] as? Bool, false)
        let backend = FakeBackend()
        let ok = try await call(backend, req("9", "setProtocol", ["protocol": "tcpFast"]))
        XCTAssertEqual(ok["ok"] as? Bool, true)
        XCTAssertEqual(backend.lastProtocol, "tcpFast")
    }

    func testOpenOnlyHttps() async throws {
        let bad = try await call(FakeBackend(), req("10", "open", ["url": "http://example.com"]))
        XCTAssertEqual(bad["ok"] as? Bool, false)
        let backend = FakeBackend()
        let ok = try await call(backend, req("11", "open", ["url": "https://example.com/terms"]))
        XCTAssertEqual(ok["ok"] as? Bool, true)
        XCTAssertEqual(backend.openedURL, "https://example.com/terms")
    }

    func testCrmRejectsAbsoluteURLAndForeignHeaders() async throws {
        let absolute = try await call(FakeBackend(), req("12", "crmRequest", ["method": "GET", "path": "https://evil.example/plans"]))
        XCTAssertEqual(absolute["ok"] as? Bool, false)
        let header = try await call(FakeBackend(), req("13", "crmRequest", ["method": "GET", "path": "/plans", "headers": ["cookie": "x"]]))
        XCTAssertEqual(header["ok"] as? Bool, false)
        let put = try await call(FakeBackend(), req("14", "crmRequest", ["method": "PUT", "path": "/plans"]))
        XCTAssertEqual(put["ok"] as? Bool, false)
    }

    func testCrmClampsTimeoutAndPassesThrough() async throws {
        let backend = FakeBackend()
        let root = try await call(backend, req("15", "crmRequest", [
            "method": "GET", "path": "/plans", "headers": ["accept": "application/json"], "timeoutMs": 1000,
        ]))
        XCTAssertEqual(root["ok"] as? Bool, true)
        XCTAssertEqual((root["result"] as? [String: Any])?["status"] as? Int, 200)
        XCTAssertEqual(backend.lastCrm?.timeoutMs, 13_000)
    }

    func testBackendErrorMapsToBridgeCode() async throws {
        let root = try await call(ThrowingBackend(), req("16", "connect"))
        XCTAssertEqual(root["ok"] as? Bool, false)
        XCTAssertEqual((root["error"] as? [String: Any])?["code"] as? String, "FROZEN")
    }

    func testStateEventShape() async throws {
        let json = try await BridgeDispatcher(backend: FakeBackend()).stateEventJson()
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(root["event"] as? String, "state")
        XCTAssertEqual((root["payload"] as? [String: Any])?["status"] as? String, "disconnected")
    }
}
