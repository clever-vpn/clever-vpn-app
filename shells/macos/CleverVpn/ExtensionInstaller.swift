import CleverVpnKit
import Foundation
import SystemExtensions

/// macOS 的系统扩展必须由 App 发起激活（首次会引导用户到「系统设置 → 隐私与安全性」批准）。
/// 不在这里做重试/静默安装：那条路只在「已经批准过」时才安全。
final class ExtensionInstaller: NSObject, OSSystemExtensionRequestDelegate {
    func activateIfNeeded() {
        let request = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: AppConfiguration.systemExtensionBundleID,
            queue: .main
        )
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplaceAction {
        .replace
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        NSLog("[CleverVpn] system extension 需要用户在系统设置里批准")
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        NSLog("[CleverVpn] system extension 激活结果：\(result.rawValue)")
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        NSLog("[CleverVpn] system extension 激活失败：\(error.localizedDescription)")
    }
}
