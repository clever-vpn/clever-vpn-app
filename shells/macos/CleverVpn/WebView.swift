import AppKit
import CleverVpnKit
import CleverVpnShellCore
import SwiftUI
import WebKit

/// SwiftUI 的容器：窗口里只有一个 WKWebView，承载 bundle 里的 `web/`。
struct WebViewContainer: NSViewControllerRepresentable {
    func makeNSViewController(context: Context) -> WebViewController {
        WebViewController()
    }

    func updateNSViewController(_ nsViewController: WebViewController, context: Context) {}
}

final class WebViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var dispatcher: BridgeDispatcher?
    private var backend: KitBackend?

    override func loadView() {
        let webRoot = Bundle.main.resourceURL?.appendingPathComponent("web") ?? Bundle.main.bundleURL
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(LocalWebSchemeHandler(root: webRoot), forURLScheme: "clevervpn")
        configuration.userContentController.addUserScript(
            WKUserScript(source: BridgeShim.source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        configuration.userContentController.add(self, name: "bridge")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        do {
            let manifestPath = Bundle.main.url(forResource: "manifest", withExtension: "json")?.path ?? ""
            let manifest = try AppManifest.load(path: manifestPath)
            let backend = KitBackend(manifest: manifest)
            self.backend = backend
            self.dispatcher = BridgeDispatcher(backend: backend)
            backend.onStateChanged = { [weak self] in self?.pushState() }
            webView.load(URLRequest(url: URL(string: "clevervpn://local/index.html")!))
        } catch {
            presentStartupError(error)
        }
    }

    private func pushState() {
        Task { @MainActor in
            guard let dispatcher, let webView else { return }
            guard let json = try? await dispatcher.stateEventJson() else { return }
            webView.evaluateJavaScript("window.__bridgeReceive(\(json))", completionHandler: nil)
        }
    }

    private func presentStartupError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "启动失败"
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: body),
              let raw = String(data: data, encoding: .utf8),
              let dispatcher else { return }

        Task { @MainActor in
            let response = await dispatcher.handle(raw)
            webView.evaluateJavaScript("window.__bridgeReceive(\(response))", completionHandler: nil)
        }
    }

    // MARK: - WKNavigationDelegate（内部导航锁）

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "clevervpn" || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "https" || url.scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

/// `clevervpn://local/<path>` → bundle 里的 `web/<path>`。
final class LocalWebSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            fail(urlSchemeTask, 400)
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            fail(urlSchemeTask, 404)
            return
        }
        let response = URLResponse(url: url, mimeType: Self.mime(file.pathExtension), expectedContentLength: data.count, textEncodingName: "utf-8")
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ status: Int) {
        let response = HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        task.didReceive(response)
        task.didReceive(Data())
        task.didFinish()
    }

    private static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "text/javascript"
        case "json", "webmanifest": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
