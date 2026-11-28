import CleverVpnKit
import Foundation
import NetworkExtension

Variant.useSystemExtension = true

autoreleasepool {
    NEProvider.startSystemExtensionMode()
}

dispatchMain()
