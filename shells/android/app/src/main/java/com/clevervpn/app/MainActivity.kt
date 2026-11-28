package com.clevervpn.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.clevervpn.app.bridge.BridgeDispatcher
import com.clevervpn.app.bridge.ShellErrorKind
import com.clevervpn.app.bridge.ShellException
import com.clevervpn.app.kit.KitBackend
import com.clevervpn.app.shell.AppManifest
import com.clevervpn.app.shell.BridgeShim
import com.clevervpn.app.shell.readManifest
import com.clevervpn.kit.VpnClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Android 壳：一个全屏 WebView + bridge + VpnService 授权。
 * 页面用 WebViewAssetLoader 以 https origin 加载 assets 里的 `web/`（localStorage 可用）。
 */
class MainActivity : Activity() {

    private val origin = "https://appassets.androidplatform.net"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private lateinit var manifest: AppManifest
    private lateinit var client: VpnClient
    private lateinit var dispatcher: BridgeDispatcher
    private lateinit var webView: WebView
    private var replyProxy: JavaScriptReplyProxy? = null
    private var permissionContinuation: ((Result<Unit>) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        setContentView(root)

        manifest = runCatching { readManifest(this) }.getOrElse {
            showError(root, "读不到 dist/manifest.json：${it.message}")
            return
        }
        @Suppress("UNCHECKED_CAST")
        val activityClass = MainActivity::class.java as Class<Activity>
        client = runCatching { VpnClient.init(applicationContext, activityClass) }.getOrElse {
            showError(root, "闭源核心初始化失败：${it.message}")
            return
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            showError(root, "系统 WebView 太旧：需要支持 WebMessageListener / DocumentStartScript 的版本")
            return
        }

        val backend = KitBackend(
            client = client,
            manifest = manifest,
            ensureVpnPermission = ::ensureVpnPermission,
            openExternal = ::openExternal,
        )
        dispatcher = BridgeDispatcher(backend)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            setBackgroundColor(Color.WHITE)
        }
        root.addView(webView)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.toString().startsWith(origin)) return false
                if (url.scheme == "https" || url.scheme == "http") openExternal(url.toString())
                return true
            }
        }

        WebViewCompat.addDocumentStartJavaScript(webView, BridgeShim.SOURCE, setOf(origin))
        WebViewCompat.addWebMessageListener(
            webView,
            "bridgeNative",
            setOf(origin),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy,
                ) {
                    if (!isMainFrame) return
                    this@MainActivity.replyProxy = replyProxy
                    val data = message.data ?: return
                    scope.launch {
                        replyProxy.postMessage(dispatcher.handle(data))
                    }
                }
            },
        )

        collectShellState()
        webView.loadUrl("$origin/assets/web/index.html")
    }

    /** 状态变化 → 推一帧 state 事件（页面以 state() 为准）。 */
    private fun collectShellState() {
        val flows: List<suspend () -> Unit> = listOf(
            { client.statusFlow.collect { pushState() } },
            { client.errorFlow.collect { pushState() } },
            { client.connInfoFlow.collect { pushState() } },
            { client.trafficFlow.collect { pushState() } },
            { client.startedAtFlow.collect { pushState() } },
            { client.userInfo.collect { pushState() } },
            { client.lines.collect { pushState() } },
        )
        flows.forEach { flow -> scope.launch { flow() } }
    }

    private fun pushState() {
        val proxy = replyProxy ?: return
        scope.launch {
            proxy.postMessage(dispatcher.stateEventJson())
        }
    }

    /** VpnService 授权：kit 的 start() 之前必须先拿到用户同意。 */
    private suspend fun ensureVpnPermission() {
        val intent = VpnService.prepare(this) ?: return
        suspendCancellableCoroutine<Unit> { continuation ->
            permissionContinuation = { result ->
                result.fold(
                    onSuccess = { if (continuation.isActive) continuation.resume(Unit) },
                    onFailure = { error -> if (continuation.isActive) continuation.resumeWithException(error) },
                )
            }
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST_VPN)
        }
    }

    @Deprecated("Activity#onActivityResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_VPN) return
        val continuation = permissionContinuation ?: return
        permissionContinuation = null
        if (resultCode == RESULT_OK) {
            continuation(Result.success(Unit))
        } else {
            continuation(Result.failure(ShellException(ShellErrorKind.INTERNAL, "用户没有授权 VPN 连接")))
        }
    }

    private fun openExternal(url: String) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    @Deprecated("Activity#onBackPressed")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
            return
        }
        super.onBackPressed()
    }

    override fun onDestroy() {
        scope.cancel()
        replyProxy = null
        if (this::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun showError(root: FrameLayout, message: String) {
        root.addView(
            TextView(this).apply {
                text = message
                textSize = 16f
                setPadding(48, 48, 48, 48)
            },
        )
    }

    companion object {
        private const val REQUEST_VPN = 1001
    }
}
