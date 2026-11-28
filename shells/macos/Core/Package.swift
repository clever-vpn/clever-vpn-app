// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CleverVpnShellCore",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "CleverVpnShellCore", targets: ["CleverVpnShellCore"]),
    ],
    targets: [
        .target(name: "CleverVpnShellCore"),
        .testTarget(name: "CleverVpnShellCoreTests", dependencies: ["CleverVpnShellCore"]),
    ]
)
