package com.clevervpn.app.shell

import android.content.Context
import org.json.JSONObject

/** `dist/manifest.json`（壳唯一要读的构建产物）：页面不能指定 crm.base。 */
data class AppManifest(
    val name: String,
    val version: String,
    val crmBase: String,
    val crmId: String,
)

fun readManifest(context: Context): AppManifest {
    val raw = context.assets.open("manifest.json").bufferedReader().use { it.readText() }
    val root = JSONObject(raw)
    val crm = root.optJSONObject("crm") ?: JSONObject()
    val version = root.optString("version", "dev").removePrefix("v")
    return AppManifest(
        name = root.optString("name", "Clever VPN"),
        version = version,
        crmBase = crm.optString("base"),
        crmId = crm.optString("id"),
    )
}
