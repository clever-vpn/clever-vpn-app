import SwiftUI

@main
struct CleverVpnApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            WebViewContainer()
                .frame(minWidth: 360, minHeight: 600)
        }
        .windowResizability(.contentMinSize)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 系统扩展的激活由 App 发起；用户未批准时连接会失败，壳只负责引导。
        KitBackend.installExtensionIfNeeded()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
