namespace CleverVpn.Core.Bridge;

/// <summary>
/// 壳内部的中性错误分类。kit 的具体错误码在 `KitBackend` 里映射到这里，
/// bridge 的五码由 <see cref="BridgeErrors.Code"/> 决定 —— 这样 Core 不依赖 kit，能单测。
/// </summary>
public enum ShellErrorKind
{
    Expired,
    Frozen,
    DeviceLimit,
    Network,
    Internal,
}

public static class BridgeErrors
{
    public static string Code(ShellErrorKind kind) => kind switch
    {
        ShellErrorKind.Expired => "EXPIRED",
        ShellErrorKind.Frozen => "FROZEN",
        ShellErrorKind.DeviceLimit => "DEVICE_LIMIT",
        ShellErrorKind.Network => "NETWORK",
        _ => "INTERNAL",
    };
}

/// <summary>壳内部抛给 dispatcher 的错误；dispatcher 统一翻成 bridge 的错误信封。</summary>
public sealed class ShellException : Exception
{
    public ShellErrorKind Kind { get; }

    public ShellException(ShellErrorKind kind, string message) : base(message)
    {
        Kind = kind;
    }

    public static ShellException Internal(string message) => new(ShellErrorKind.Internal, message);
    public static ShellException Network(string message) => new(ShellErrorKind.Network, message);
}
