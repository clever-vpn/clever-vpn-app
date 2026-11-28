import CleverVpnKit
import NetworkExtension

/// 系统扩展的入口：kit 提供完整的 `CleverVpnPacketTunnelProvider`，这里只做子类接线。
final class PacketTunnelProvider: CleverVpnPacketTunnelProvider {}
