using System.Diagnostics;
using Clever_Vpn_Windows_Kit.Data;
using KitIpRule = Clever_Vpn_Windows_Kit.Data.IpRule;
using KitDomainRule = Clever_Vpn_Windows_Kit.Data.DomainRule;
using BridgeIpRule = CleverVpn.Core.Bridge.IpRule;
using BridgeDomainRule = CleverVpn.Core.Bridge.DomainRule;
using CleverVpn.Core;
using CleverVpn.Core.Bridge;
using Microsoft.UI.Dispatching;
using Windows.System;

namespace CleverVpn.App.Kit;

/// <summary>
/// 把闭源 kit 的 `Client` 包成 bridge 的能力面。
///
/// 这里只做三件事：**映射**（类型/错误码）、**归一化**（region 代码兜底）、**订阅**（状态变化 → StateChanged）。
/// 任何业务判断都不在这里 —— 授权在服务端，线路是 kit 的运行时数据。
/// </summary>
public sealed class KitBackend : IShellBackend
{
    private readonly Clever_Vpn_Windows_Kit.Client.Client _client;
    private readonly string _crmBase;

    public event EventHandler? StateChanged;

    private KitBackend(Clever_Vpn_Windows_Kit.Client.Client client, string crmBase)
    {
        _client = client;
        _crmBase = crmBase;
    }

    /// <summary>初始化 kit（含 broker 服务自装）。失败抛 InvalidOperationException。</summary>
    public static async Task<KitBackend> CreateAsync(AppManifest manifest)
    {
        var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CleverVpn");
        Directory.CreateDirectory(dataDir);

        var initError = await Clever_Vpn_Windows_Kit.Client.Client.Init(dataDir, manifest.Version);
        if (initError is not null)
        {
            throw new InvalidOperationException($"闭源核心初始化失败：{initError.Message}");
        }

        var client = new Clever_Vpn_Windows_Kit.Client.Client();
        var backend = new KitBackend(client, manifest.CrmBase);

        client.VpnStateChanged += (_, _) => backend.RaiseStateChanged();
        client.LastErrorChanged += (_, _) => backend.RaiseStateChanged();
        client.UserInfoChanged += (_, _) => backend.RaiseStateChanged();
        client.ConnectionStartTimeChanged += (_, _) => backend.RaiseStateChanged();
        client.TrafficChanged += (_, _) => backend.RaiseStateChanged();

        try
        {
            await client.SetTrafficSubscriptionEnabled(true);
        }
        catch (Exception e)
        {
            Debug.WriteLine($"traffic subscription failed: {e.Message}");
        }

        return backend;
    }

    private void RaiseStateChanged() => StateChanged?.Invoke(this, EventArgs.Empty);

    public Task<CapabilitiesResult> CapabilitiesAsync() =>
        Task.FromResult(new CapabilitiesResult("3", "windows", null));

    public async Task ActivateAsync(string key)
    {
        var error = await _client.Activate(key);
        if (error is not null) throw ToShellException(error);
    }

    public Task DeactivateAsync() => _client.Deactivate();

    public async Task<IReadOnlyList<LineInfo>> LinesAsync(bool refresh)
    {
        var lines = refresh ? await _client.RefreshLines() : _client.Lines;
        return lines.Select(MapLine).ToList();
    }

    public Task SetLineAsync(int id) => _client.UpdateLine(id);

    public async Task ConnectAsync()
    {
        _client.ClearLastError();
        await _client.Start();
        if (_client.LastError is { } error) throw ToShellException(error);
    }

    public Task DisconnectAsync() => _client.Stop();

    public Task<StateResult> StateAsync()
    {
        var user = _client.UserInfo;
        var error = _client.LastError;
        var status = error is not null
            ? "error"
            : _client.VpnState switch
            {
                Clever_Vpn_Windows_Kit.Common.CleverVpnState.Starting => "connecting",
                Clever_Vpn_Windows_Kit.Common.CleverVpnState.Started => "connected",
                _ => "disconnected",
            };

        LineSummary? line = null;
        if (user is { Line: > 0 })
        {
            var label = _client.Lines.FirstOrDefault(l => l.Id == user.Line)?.Label ?? "";
            line = new LineSummary(user.Line, label);
        }

        var traffic = _client.Traffic;
        var started = _client.ConnectionStartTime;
        return Task.FromResult(new StateResult(
            status,
            status == "error" && error is not null ? new StateError(BridgeErrors.Code(ToKind(error)), error.Message) : null,
            started > 0 ? started : null,
            line,
            traffic.Rx,
            traffic.Tx,
            user?.Activated ?? false));
    }

    public Task<SettingsResult> SettingsAsync()
    {
        var user = _client.UserInfo;
        var protocol = ProtocolName(user?.ProtocolType ?? ProtocolType.Auto);
        var split = user?.SplitInfo is { } value ? MapSplit(value) : DefaultSplit();
        return Task.FromResult(new SettingsResult(protocol, split));
    }

    public async Task SetProtocolAsync(string protocol)
    {
        await _client.UpdateProtocolType(ParseProtocol(protocol));
    }

    public async Task SetSplitAsync(SplitResult split)
    {
        var mapped = new SplitInfo
        {
            Region = new RegionInfo
            {
                Enable = split.Region.Enable,
                Code = string.IsNullOrWhiteSpace(split.Region.Code) ? "CN" : split.Region.Code,
            },
            Ip = new KitIpRule
            {
                Enable = split.Ip.Enable,
                IpCidr = split.Ip.IpCidr.ToList(),
            },
            Domain = new KitDomainRule
            {
                Enable = split.Domain.Enable,
                Domain = split.Domain.Domain.ToList(),
                DomainSuffix = split.Domain.DomainSuffix.ToList(),
                DomainRegex = split.Domain.DomainRegex.ToList(),
            },
        };
        await _client.UpdateSplit(mapped);
    }

    public async Task OpenAsync(string url)
    {
        if (!await Launcher.LaunchUriAsync(new Uri(url)))
        {
            throw ShellException.Internal("没能在系统浏览器里打开链接");
        }
    }

    public async Task<CrmResult> CrmRequestAsync(CrmRequest request)
    {
        if (string.IsNullOrWhiteSpace(_crmBase))
        {
            throw ShellException.Internal("app.json 的 crm.base 为空：这个 App 没有接 CRM");
        }

        try
        {
            var headers = request.Headers is null
                ? null
                : new Dictionary<string, string>(request.Headers, StringComparer.OrdinalIgnoreCase);
            var response = await _client.CrmRequestAsync(
                _crmBase,
                request.Method,
                request.Path,
                headers,
                request.Body,
                request.TimeoutMs);
            return new CrmResult(response.Status, response.Body);
        }
        catch (Exception e)
        {
            // 4xx/5xx 在 CrmResponse.Status 里；能走到这里的都是传输失败。
            throw new ShellException(ShellErrorKind.Network, e.Message);
        }
    }

    // ── 映射 ─────────────────────────────────────────────────

    private static LineInfo MapLine(Clever_Vpn_Windows_Kit.Data.Line line) =>
        new(line.Id, line.Label, line.Factor, line.Icon, line.IconKind, line.IsDefault, line.HasRelay, line.HasUpstream);

    private static SplitResult MapSplit(SplitInfo split) =>
        new(
            new RegionRule(split.Region.Enable, string.IsNullOrWhiteSpace(split.Region.Code) ? "CN" : split.Region.Code),
            new BridgeIpRule(split.Ip.Enable, split.Ip.IpCidr.ToList()),
            new BridgeDomainRule(
                split.Domain.Enable,
                split.Domain.Domain.ToList(),
                split.Domain.DomainSuffix.ToList(),
                split.Domain.DomainRegex.ToList()));

    private static SplitResult DefaultSplit() =>
        new(
            new RegionRule(true, "CN"),
            new BridgeIpRule(false, Array.Empty<string>()),
            new BridgeDomainRule(false, Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>()));

    private static string ProtocolName(ProtocolType protocol) => protocol switch
    {
        ProtocolType.UdpTunnel => "udpTunnel",
        ProtocolType.UdpFast => "udpFast",
        ProtocolType.UdpStable => "udpStable",
        ProtocolType.TcpFast => "tcpFast",
        ProtocolType.TcpStable => "tcpStable",
        _ => "auto",
    };

    private static ProtocolType ParseProtocol(string protocol) => protocol switch
    {
        "udpTunnel" => ProtocolType.UdpTunnel,
        "udpFast" => ProtocolType.UdpFast,
        "udpStable" => ProtocolType.UdpStable,
        "tcpFast" => ProtocolType.TcpFast,
        "tcpStable" => ProtocolType.TcpStable,
        _ => ProtocolType.Auto,
    };

    /// <summary>
    /// kit 的错误码 → 壳的中性分类（bridge 五码见 `BridgeErrors`）。
    /// `DEVICE_LIMIT` 在 Windows kit 里没有对应码：v1 不产生（页面按 CRM 响应自己呈现）。
    /// </summary>
    public static ShellErrorKind ToKind(Clever_Vpn_Windows_Kit.Common.CleverVpnError error) =>
        KitErrorCodes.FromApiCode((int)error.Code);

    private static ShellException ToShellException(Clever_Vpn_Windows_Kit.Common.CleverVpnError error) =>
        new(ToKind(error), error.Message);
}
