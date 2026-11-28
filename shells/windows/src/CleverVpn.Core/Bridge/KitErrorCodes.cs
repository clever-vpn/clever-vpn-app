namespace CleverVpn.Core.Bridge;

/// <summary>
/// 三端 kit 共用的 `ApiErrorCode` 数值 → 壳的中性分类。
///
/// 数值是 libbox 契约的一部分（0 unknown / 1 provider frozen / 2 customer frozen /
/// 3 no server / 4 no customer / 5 no provider / 6 no licence / 7 no relay / 8 no line /
/// 9 no activation code / 10 network / 11 http / 12 connection）。
/// Windows kit 直接暴露这个 int；这里映射，避免 App 层散落 switch。
/// </summary>
public static class KitErrorCodes
{
    public static ShellErrorKind FromApiCode(int code) => code switch
    {
        2 => ShellErrorKind.Frozen,     // CustomerFrozen
        6 => ShellErrorKind.Expired,    // NoLicence
        10 or 11 or 12 => ShellErrorKind.Network, // Network / Http / Connection
        _ => ShellErrorKind.Internal,
    };
}
