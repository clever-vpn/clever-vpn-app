using System.Text.Json;
using System.Text.Json.Serialization;

namespace CleverVpn.Core.Bridge;

// ── 与 docs/BRIDGE.md 一一对应的数据形状（序列化用 camelCase，下划线字段单独标注）──

public sealed record CapabilitiesResult(
    [property: JsonPropertyName("bridge")] string Bridge,
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("store")] string? Store);

public sealed record LineSummary(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("label")] string Label);

public sealed record LineInfo(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("factor")] double Factor,
    [property: JsonPropertyName("icon")] string? Icon,
    [property: JsonPropertyName("iconKind")] string? IconKind,
    [property: JsonPropertyName("isDefault")] bool? IsDefault,
    [property: JsonPropertyName("hasRelay")] bool HasRelay,
    [property: JsonPropertyName("hasUpstream")] bool HasUpstream);

public sealed record StateError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message);

public sealed record StateResult(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("error")] StateError? Error,
    [property: JsonPropertyName("since")] long? Since,
    [property: JsonPropertyName("line")] LineSummary? Line,
    [property: JsonPropertyName("bytesIn")] long BytesIn,
    [property: JsonPropertyName("bytesOut")] long BytesOut,
    [property: JsonPropertyName("activated")] bool Activated);

public sealed record RegionRule(
    [property: JsonPropertyName("enable")] bool Enable,
    [property: JsonPropertyName("code")] string Code);

public sealed record IpRule(
    [property: JsonPropertyName("enable")] bool Enable,
    [property: JsonPropertyName("ip_cidr")] IReadOnlyList<string> IpCidr);

public sealed record DomainRule(
    [property: JsonPropertyName("enable")] bool Enable,
    [property: JsonPropertyName("domain")] IReadOnlyList<string> Domain,
    [property: JsonPropertyName("domain_suffix")] IReadOnlyList<string> DomainSuffix,
    [property: JsonPropertyName("domain_regex")] IReadOnlyList<string> DomainRegex);

public sealed record SplitResult(
    [property: JsonPropertyName("region")] RegionRule Region,
    [property: JsonPropertyName("ip")] IpRule Ip,
    [property: JsonPropertyName("domain")] DomainRule Domain);

public sealed record SettingsResult(
    [property: JsonPropertyName("protocol")] string Protocol,
    [property: JsonPropertyName("split")] SplitResult Split);

public sealed record CrmRequest(
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("headers")] IReadOnlyDictionary<string, string>? Headers,
    [property: JsonPropertyName("body")] string? Body,
    [property: JsonPropertyName("timeoutMs")] int TimeoutMs);

public sealed record CrmResult(
    [property: JsonPropertyName("status")] int Status,
    [property: JsonPropertyName("body")] string Body);

public sealed record BridgeErrorBody(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message);

/// <summary>bridge 的 JSON 约定：字段一律 camelCase；空值保留（页面按字段存在与否判断）。</summary>
public static class BridgeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };
}
