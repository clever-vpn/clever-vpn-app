namespace CleverVpn.Core.Bridge;

/// <summary>
/// 壳的能力面（kit 的真实实现是 App 里的 `KitBackend`；单测用假的实现）。
/// dispatcher 只依赖这个接口，所以 14 个方法的参数校验 / 错误信封可以脱离 kit 测。
/// </summary>
public interface IShellBackend
{
    Task<CapabilitiesResult> CapabilitiesAsync();

    Task ActivateAsync(string key);
    Task DeactivateAsync();

    Task<IReadOnlyList<LineInfo>> LinesAsync(bool refresh);
    Task SetLineAsync(int id);

    Task ConnectAsync();
    Task DisconnectAsync();

    Task<StateResult> StateAsync();

    Task<SettingsResult> SettingsAsync();
    Task SetProtocolAsync(string protocol);
    Task SetSplitAsync(SplitResult split);

    Task OpenAsync(string url);

    /// <summary>`base` 由壳持有（dist/manifest.json 的 crm.base），页面不能指定。</summary>
    Task<CrmResult> CrmRequestAsync(CrmRequest request);

    /// <summary>任何状态变化时触发；App 负责把它翻成 bridge 的 state 事件。</summary>
    event EventHandler? StateChanged;
}
