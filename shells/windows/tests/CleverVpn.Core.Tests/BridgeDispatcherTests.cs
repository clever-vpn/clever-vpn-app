using System.Text.Json;
using CleverVpn.Core.Bridge;
using Xunit;

namespace CleverVpn.Core.Tests;

public sealed class BridgeDispatcherTests
{
    private sealed class FakeBackend : IShellBackend
    {
        public CrmRequest? LastCrm;
        public string? OpenedUrl;
        public string? LastProtocol;
        public SplitResult? LastSplit;
        public int? LastLine;

        public event EventHandler? StateChanged;

        public Task<CapabilitiesResult> CapabilitiesAsync() => Task.FromResult(new CapabilitiesResult("3", "windows", null));
        public Task ActivateAsync(string key) => Task.CompletedTask;
        public Task DeactivateAsync() => Task.CompletedTask;
        public Task<IReadOnlyList<LineInfo>> LinesAsync(bool refresh) =>
            Task.FromResult<IReadOnlyList<LineInfo>>(new[] { new LineInfo(1, "香港 01", 1, "HK", "flag", true, true, false) });
        public Task SetLineAsync(int id) { LastLine = id; return Task.CompletedTask; }
        public Task ConnectAsync() => Task.CompletedTask;
        public Task DisconnectAsync() => Task.CompletedTask;
        public Task<StateResult> StateAsync() =>
            Task.FromResult(new StateResult("disconnected", null, null, null, 0, 0, false));
        public Task<SettingsResult> SettingsAsync() =>
            Task.FromResult(new SettingsResult("auto", new SplitResult(
                new RegionRule(true, "CN"),
                new IpRule(false, Array.Empty<string>()),
                new DomainRule(false, Array.Empty<string>(), Array.Empty<string>(), Array.Empty<string>()))));
        public Task SetProtocolAsync(string protocol) { LastProtocol = protocol; return Task.CompletedTask; }
        public Task SetSplitAsync(SplitResult split) { LastSplit = split; return Task.CompletedTask; }
        public Task OpenAsync(string url) { OpenedUrl = url; return Task.CompletedTask; }
        public Task<CrmResult> CrmRequestAsync(CrmRequest request) { LastCrm = request; return Task.FromResult(new CrmResult(200, "{}")); }

        public void Raise() => StateChanged?.Invoke(this, EventArgs.Empty);
    }

    private static async Task<(JsonElement root, FakeBackend backend)> Call(string json)
    {
        var backend = new FakeBackend();
        var dispatcher = new BridgeDispatcher(backend);
        var response = await dispatcher.HandleAsync(json);
        return (JsonDocument.Parse(response).RootElement, backend);
    }

    private static string Req(string id, string method, object? args = null) =>
        JsonSerializer.Serialize(new { id, method, args });

    [Fact]
    public void Methods_is_the_14_method_whitelist()
    {
        Assert.Equal(14, BridgeDispatcher.Methods.Length);
        Assert.Equal(
            new[]
            {
                "capabilities", "activate", "deactivate", "lines", "setLine", "connect",
                "disconnect", "state", "settings", "setProtocol", "setSplit", "open", "on", "crmRequest",
            },
            BridgeDispatcher.Methods);
    }

    [Fact]
    public async Task Echoes_id_and_wraps_result()
    {
        var (root, _) = await Call(Req("17", "capabilities"));
        Assert.Equal("17", root.GetProperty("id").GetString());
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("3", root.GetProperty("result").GetProperty("bridge").GetString());
        Assert.Equal("windows", root.GetProperty("result").GetProperty("platform").GetString());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("result").GetProperty("store").ValueKind);
    }

    [Fact]
    public async Task State_uses_camelCase_contract_fields()
    {
        var (root, _) = await Call(Req("1", "state"));
        var result = root.GetProperty("result");
        Assert.Equal("disconnected", result.GetProperty("status").GetString());
        Assert.True(result.TryGetProperty("bytesIn", out _));
        Assert.True(result.TryGetProperty("bytesOut", out _));
        Assert.True(result.TryGetProperty("activated", out _));
    }

    [Fact]
    public async Task Unknown_method_is_rejected_with_INTERNAL()
    {
        var (root, _) = await Call(Req("2", "readFile"));
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal("INTERNAL", root.GetProperty("error").GetProperty("code").GetString());
        Assert.Contains("未知方法", root.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public async Task Activate_requires_key()
    {
        var (root, _) = await Call(Req("3", "activate", new { key = "" }));
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal("INTERNAL", root.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task SetLine_requires_integer_id()
    {
        var (root, _) = await Call(Req("4", "setLine", new { id = "2" }));
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal("INTERNAL", root.GetProperty("error").GetProperty("code").GetString());

        var (ok, backend) = await Call(Req("5", "setLine", new { id = 2 }));
        Assert.True(ok.GetProperty("ok").GetBoolean());
        Assert.Equal(2, backend.LastLine);
    }

    [Fact]
    public async Task Lines_passes_refresh_flag()
    {
        var (root, _) = await Call(Req("6", "lines", new { refresh = true }));
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal(1, root.GetProperty("result").GetProperty("lines").GetArrayLength());
        Assert.Equal("HK", root.GetProperty("result").GetProperty("lines")[0].GetProperty("icon").GetString());
    }

    [Fact]
    public async Task SetSplit_normalizes_empty_region_code()
    {
        var split = new
        {
            region = new { enable = true, code = "" },
            ip = new { enable = false, ip_cidr = Array.Empty<string>() },
            domain = new { enable = false, domain = Array.Empty<string>(), domain_suffix = Array.Empty<string>(), domain_regex = Array.Empty<string>() },
        };
        var (root, backend) = await Call(Req("7", "setSplit", new { split }));
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("CN", backend.LastSplit!.Region.Code);
    }

    [Fact]
    public async Task SetProtocol_only_accepts_the_six_values()
    {
        var (bad, _) = await Call(Req("8", "setProtocol", new { protocol = "wireguard" }));
        Assert.False(bad.GetProperty("ok").GetBoolean());

        var (ok, backend) = await Call(Req("9", "setProtocol", new { protocol = "tcpFast" }));
        Assert.True(ok.GetProperty("ok").GetBoolean());
        Assert.Equal("tcpFast", backend.LastProtocol);
    }

    [Fact]
    public async Task Open_only_accepts_https()
    {
        var (bad, _) = await Call(Req("10", "open", new { url = "http://example.com" }));
        Assert.False(bad.GetProperty("ok").GetBoolean());

        var (ok, backend) = await Call(Req("11", "open", new { url = "https://example.com/terms" }));
        Assert.True(ok.GetProperty("ok").GetBoolean());
        Assert.StartsWith("https://example.com/terms", backend.OpenedUrl);
    }

    [Fact]
    public async Task CrmRequest_rejects_absolute_url_and_foreign_headers()
    {
        var (absolute, _) = await Call(Req("12", "crmRequest", new { method = "GET", path = "https://evil.example/plans" }));
        Assert.False(absolute.GetProperty("ok").GetBoolean());

        var (header, _) = await Call(Req("13", "crmRequest", new { method = "GET", path = "/plans", headers = new { cookie = "x" } }));
        Assert.False(header.GetProperty("ok").GetBoolean());

        var (put, _) = await Call(Req("14", "crmRequest", new { method = "PUT", path = "/plans" }));
        Assert.False(put.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task CrmRequest_passes_through_and_clamps_timeout()
    {
        var (root, backend) = await Call(Req("15", "crmRequest", new
        {
            method = "GET",
            path = "/plans",
            headers = new { accept = "application/json" },
            timeoutMs = 1000,
        }));
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal(200, root.GetProperty("result").GetProperty("status").GetInt32());
        Assert.Equal(13_000, backend.LastCrm!.TimeoutMs);
    }

    [Fact]
    public async Task Backend_shell_error_maps_to_bridge_code()
    {
        var backend = new ThrowingBackend(ShellErrorKind.Frozen, "account frozen");
        var response = await new BridgeDispatcher(backend).HandleAsync(Req("16", "connect"));
        var root = JsonDocument.Parse(response).RootElement;
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal("FROZEN", root.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task StateEvent_is_shaped_as_event_payload()
    {
        var backend = new FakeBackend();
        var json = await new BridgeDispatcher(backend).StateEventJsonAsync();
        var root = JsonDocument.Parse(json).RootElement;
        Assert.Equal("state", root.GetProperty("event").GetString());
        Assert.Equal("disconnected", root.GetProperty("payload").GetProperty("status").GetString());
    }

    private sealed class ThrowingBackend : FakeBackendBase
    {
        private readonly ShellErrorKind _kind;
        private readonly string _message;

        public ThrowingBackend(ShellErrorKind kind, string message)
        {
            _kind = kind;
            _message = message;
        }

        public override Task ConnectAsync() => throw new ShellException(_kind, _message);
    }

    private abstract class FakeBackendBase : IShellBackend
    {
        public event EventHandler? StateChanged;
        protected void Raise() => StateChanged?.Invoke(this, EventArgs.Empty);
        public virtual Task<CapabilitiesResult> CapabilitiesAsync() => Task.FromResult(new CapabilitiesResult("3", "windows", null));
        public virtual Task ActivateAsync(string key) => Task.CompletedTask;
        public virtual Task DeactivateAsync() => Task.CompletedTask;
        public virtual Task<IReadOnlyList<LineInfo>> LinesAsync(bool refresh) => Task.FromResult<IReadOnlyList<LineInfo>>(Array.Empty<LineInfo>());
        public virtual Task SetLineAsync(int id) => Task.CompletedTask;
        public virtual Task ConnectAsync() => Task.CompletedTask;
        public virtual Task DisconnectAsync() => Task.CompletedTask;
        public virtual Task<StateResult> StateAsync() => Task.FromResult(new StateResult("disconnected", null, null, null, 0, 0, false));
        public virtual Task<SettingsResult> SettingsAsync() => throw new NotSupportedException();
        public virtual Task SetProtocolAsync(string protocol) => Task.CompletedTask;
        public virtual Task SetSplitAsync(SplitResult split) => Task.CompletedTask;
        public virtual Task OpenAsync(string url) => Task.CompletedTask;
        public virtual Task<CrmResult> CrmRequestAsync(CrmRequest request) => Task.FromResult(new CrmResult(200, "{}"));
    }
}

public sealed class KitErrorCodesTests
{
    [Theory]
    [InlineData(2, ShellErrorKind.Frozen)]
    [InlineData(6, ShellErrorKind.Expired)]
    [InlineData(10, ShellErrorKind.Network)]
    [InlineData(11, ShellErrorKind.Network)]
    [InlineData(12, ShellErrorKind.Network)]
    [InlineData(0, ShellErrorKind.Internal)]
    [InlineData(3, ShellErrorKind.Internal)]
    public void Maps_kit_api_codes_to_shell_kinds(int code, ShellErrorKind expected)
    {
        Assert.Equal(expected, KitErrorCodes.FromApiCode(code));
    }

    [Fact]
    public void Bridge_codes_are_the_five_contract_values()
    {
        Assert.Equal("EXPIRED", BridgeErrors.Code(ShellErrorKind.Expired));
        Assert.Equal("FROZEN", BridgeErrors.Code(ShellErrorKind.Frozen));
        Assert.Equal("DEVICE_LIMIT", BridgeErrors.Code(ShellErrorKind.DeviceLimit));
        Assert.Equal("NETWORK", BridgeErrors.Code(ShellErrorKind.Network));
        Assert.Equal("INTERNAL", BridgeErrors.Code(ShellErrorKind.Internal));
    }
}
