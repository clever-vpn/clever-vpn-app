using System.Text.Json;

namespace CleverVpn.Core;

/// <summary>
/// `dist/manifest.json`（壳唯一要读的构建产物）。页面不能指定 crm.base；壳从这里取。
/// </summary>
public sealed record AppManifest(
    string Name,
    string Version,
    string CrmBase,
    string CrmId,
    IReadOnlyDictionary<string, string> BundleId);

public static class ManifestReader
{
    public static AppManifest Load(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;

        string ReadString(JsonElement el, string name, string fallback = "")
        {
            return el.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? fallback
                : fallback;
        }

        var crmBase = "";
        var crmId = "";
        if (root.TryGetProperty("crm", out var crm) && crm.ValueKind == JsonValueKind.Object)
        {
            crmBase = ReadString(crm, "base");
            crmId = ReadString(crm, "id");
        }

        var bundle = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("bundle_id", out var bundleEl) && bundleEl.ValueKind == JsonValueKind.Object)
        {
            foreach (var entry in bundleEl.EnumerateObject())
            {
                if (entry.Value.ValueKind == JsonValueKind.String) bundle[entry.Name] = entry.Value.GetString() ?? "";
            }
        }

        var version = ReadString(root, "version", "dev");
        return new AppManifest(
            ReadString(root, "name", "Clever VPN"),
            version.StartsWith('v') ? version[1..] : version,
            crmBase,
            crmId,
            bundle);
    }
}
