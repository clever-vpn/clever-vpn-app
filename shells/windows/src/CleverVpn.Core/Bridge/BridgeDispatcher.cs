using System.Text.Json;

namespace CleverVpn.Core.Bridge;

/// <summary>
/// bridge@3 的**唯一判决点**（壳侧）：方法白名单、参数校验、错误信封。
///
/// 输入是 WebView 发来的 `{id, method, args}`；输出是 `{id, ok, result|error}`。
/// `args` 的形状与 `docs/BRIDGE.md` 一一对应（`setLine` 传 `{id}`、`activate` 传 `{key}`…）。
/// 这个类不碰 WebView、不碰 kit：App 负责把消息接进来、把 state 事件推出去。
/// </summary>
public sealed class BridgeDispatcher
{
    public static readonly string[] Methods =
    {
        "capabilities", "activate", "deactivate", "lines", "setLine", "connect",
        "disconnect", "state", "settings", "setProtocol", "setSplit", "open", "on",
        "crmRequest",
    };

    private static readonly HashSet<string> AllowedMethods = new(Methods, StringComparer.Ordinal);

    private static readonly HashSet<string> AllowedProtocols = new(StringComparer.Ordinal)
    {
        "auto", "udpTunnel", "udpFast", "udpStable", "tcpFast", "tcpStable",
    };

    private static readonly HashSet<string> AllowedCrmHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorization", "accept", "content-type",
    };

    private const int CrmBodyLimit = 64 * 1024;
    private const int CrmTimeoutMin = 13_000;
    private const int CrmTimeoutMax = 30_000;
    private const int CrmTimeoutDefault = 15_000;

    private readonly IShellBackend _backend;

    public BridgeDispatcher(IShellBackend backend)
    {
        _backend = backend;
    }

    /// <summary>处理一条 WebView 消息，返回要 `PostWebMessageAsJson` 的响应。</summary>
    public async Task<string> HandleAsync(string raw)
    {
        string? id = null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw ShellException.Internal("请求必须是对象");

            id = root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String
                ? idEl.GetString()
                : null;

            var method = root.TryGetProperty("method", out var methodEl) && methodEl.ValueKind == JsonValueKind.String
                ? methodEl.GetString()
                : null;
            if (string.IsNullOrEmpty(method)) throw ShellException.Internal("缺少 method");
            if (!AllowedMethods.Contains(method)) throw ShellException.Internal($"未知方法 {method}");

            JsonElement? args = root.TryGetProperty("args", out var argsEl) && argsEl.ValueKind != JsonValueKind.Null
                ? argsEl
                : null;

            var result = await DispatchAsync(method, args);
            return Ok(id, result);
        }
        catch (ShellException e)
        {
            return Fail(id, BridgeErrors.Code(e.Kind), e.Message);
        }
        catch (JsonException)
        {
            return Fail(id, "INTERNAL", "请求不是合法 JSON");
        }
        catch (Exception e)
        {
            // 不把激活码之类的东西写进日志/消息：这里只沿用异常自身的 message（kit 的 message 不含 key）。
            return Fail(id, "INTERNAL", e.Message);
        }
    }

    /// <summary>`state` 事件的一帧（App 负责在 UI 线程 PostWebMessageAsJson）。</summary>
    public async Task<string> StateEventJsonAsync()
    {
        var state = await _backend.StateAsync();
        return JsonSerializer.Serialize(new { @event = "state", payload = state }, BridgeJson.Options);
    }

    private async Task<object?> DispatchAsync(string method, JsonElement? args)
    {
        switch (method)
        {
            case "capabilities":
                return await _backend.CapabilitiesAsync();

            case "activate":
                await _backend.ActivateAsync(RequireString(args, "key"));
                return null;

            case "deactivate":
                await _backend.DeactivateAsync();
                return null;

            case "lines":
                return new { lines = await _backend.LinesAsync(IsRefresh(args)) };

            case "setLine":
                await _backend.SetLineAsync(RequireInt(args, "id"));
                return null;

            case "connect":
                await _backend.ConnectAsync();
                return null;

            case "disconnect":
                await _backend.DisconnectAsync();
                return null;

            case "state":
                return await _backend.StateAsync();

            case "settings":
                return await _backend.SettingsAsync();

            case "setProtocol":
                await _backend.SetProtocolAsync(RequireProtocol(args));
                return null;

            case "setSplit":
                await _backend.SetSplitAsync(RequireSplit(args));
                return null;

            case "open":
                await _backend.OpenAsync(RequireHttps(args));
                return null;

            case "on":
                // 事件订阅由 WebView 侧的 shim 管理；壳侧不记录任何页面状态。
                return null;

            case "crmRequest":
                return await _backend.CrmRequestAsync(ParseCrmRequest(args));

            default:
                throw ShellException.Internal($"未知方法 {method}");
        }
    }

    // ── 参数校验 ─────────────────────────────────────────────

    private static bool IsRefresh(JsonElement? args)
    {
        return args is { ValueKind: JsonValueKind.Object } el
            && el.TryGetProperty("refresh", out var refresh)
            && refresh.ValueKind == JsonValueKind.True;
    }

    private static string RequireString(JsonElement? args, string name)
    {
        if (args is { ValueKind: JsonValueKind.Object } el
            && el.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString();
            if (!string.IsNullOrWhiteSpace(text)) return text;
        }
        throw ShellException.Internal($"缺少参数 {name}");
    }

    private static int RequireInt(JsonElement? args, string name)
    {
        if (args is { ValueKind: JsonValueKind.Object } el
            && el.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out var number))
        {
            return number;
        }
        throw ShellException.Internal($"参数 {name} 必须是整数");
    }

    private static string RequireProtocol(JsonElement? args)
    {
        var protocol = RequireString(args, "protocol");
        if (!AllowedProtocols.Contains(protocol)) throw ShellException.Internal($"未知协议 {protocol}");
        return protocol;
    }

    private static SplitResult RequireSplit(JsonElement? args)
    {
        if (args is not { ValueKind: JsonValueKind.Object } el || !el.TryGetProperty("split", out var split)
            || split.ValueKind != JsonValueKind.Object)
        {
            throw ShellException.Internal("缺少参数 split");
        }

        SplitResult? parsed;
        try
        {
            parsed = split.Deserialize<SplitResult>(BridgeJson.Options);
        }
        catch (JsonException)
        {
            throw ShellException.Internal("split 的形状不对");
        }
        if (parsed is null) throw ShellException.Internal("split 的形状不对");

        // region 代码永远不能为空（与 kit 的归一化同口径）。
        var code = string.IsNullOrWhiteSpace(parsed.Region.Code) ? "CN" : parsed.Region.Code;
        return parsed with { Region = parsed.Region with { Code = code } };
    }

    private static string RequireHttps(JsonElement? args)
    {
        var url = RequireString(args, "url");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw ShellException.Internal("只允许 https 链接");
        }
        return uri.ToString();
    }

    private static CrmRequest ParseCrmRequest(JsonElement? args)
    {
        if (args is not { ValueKind: JsonValueKind.Object } el) throw ShellException.Internal("缺少 CRM 请求参数");

        var method = el.TryGetProperty("method", out var methodEl) && methodEl.ValueKind == JsonValueKind.String
            ? methodEl.GetString()!.ToUpperInvariant()
            : "";
        if (method != "GET" && method != "POST") throw ShellException.Internal("CRM 请求方法只允许 GET/POST");

        var path = el.TryGetProperty("path", out var pathEl) && pathEl.ValueKind == JsonValueKind.String
            ? pathEl.GetString()!
            : "";
        if (!path.StartsWith('/') || path.StartsWith("//") || path.Contains("://", StringComparison.Ordinal))
        {
            throw ShellException.Internal("path 必须以 / 开头，且不能是绝对 URL");
        }
        if (path.Length > 2048) throw ShellException.Internal("path 过长");

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (el.TryGetProperty("headers", out var headersEl) && headersEl.ValueKind == JsonValueKind.Object)
        {
            foreach (var header in headersEl.EnumerateObject())
            {
                if (!AllowedCrmHeaders.Contains(header.Name))
                {
                    throw ShellException.Internal($"CRM 请求不接受头 {header.Name}（只允许 authorization / accept / content-type）");
                }
                if (header.Value.ValueKind != JsonValueKind.String) throw ShellException.Internal($"头 {header.Name} 必须是字符串");
                headers[header.Name] = header.Value.GetString()!;
            }
        }

        var body = el.TryGetProperty("body", out var bodyEl) && bodyEl.ValueKind == JsonValueKind.String
            ? bodyEl.GetString()!
            : null;
        if (body is { Length: > CrmBodyLimit }) throw ShellException.Internal("CRM 请求体过大");

        var timeout = CrmTimeoutDefault;
        if (el.TryGetProperty("timeoutMs", out var timeoutEl) && timeoutEl.ValueKind == JsonValueKind.Number
            && timeoutEl.TryGetInt32(out var given))
        {
            timeout = Math.Clamp(given, CrmTimeoutMin, CrmTimeoutMax);
        }

        return new CrmRequest(method, path, headers, body, timeout);
    }

    // ── 信封 ─────────────────────────────────────────────────

    private static string Ok(string? id, object? result) =>
        JsonSerializer.Serialize(new { id, ok = true, result }, BridgeJson.Options);

    private static string Fail(string? id, string code, string message) =>
        JsonSerializer.Serialize(new { id, ok = false, error = new BridgeErrorBody(code, message) }, BridgeJson.Options);
}
