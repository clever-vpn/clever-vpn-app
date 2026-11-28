using System.Text.Json;
using CleverVpn.App.Bridge;
using CleverVpn.App.Kit;
using CleverVpn.Core;
using CleverVpn.Core.Bridge;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.System;

namespace CleverVpn.App;

/// <summary>
/// 唯一的窗口：一个 WebView2 承载 `dist/web`，注入 bridge shim，并在 UI 线程上派发消息。
/// 窗口本身不做业务判断 —— 方法校验在 <see cref="BridgeDispatcher"/>，能力在 <see cref="KitBackend"/>。
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly AppManifest _manifest;
    private WebView2? _web;
    private KitBackend? _backend;
    private BridgeDispatcher? _dispatcher;

    public MainWindow()
    {
        InitializeComponent();
        _manifest = ManifestReader.Load(Path.Combine(AppContext.BaseDirectory, "manifest.json"));
        Title = _manifest.Name;
        Root.Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            Loading.Text = "正在启动闭源核心…";
            _backend = await KitBackend.CreateAsync(_manifest);
            _dispatcher = new BridgeDispatcher(_backend);
            _backend.StateChanged += OnBackendStateChanged;

            _web = new WebView2();
            Root.Children.Clear();
            Root.Children.Add(_web);
            await _web.EnsureCoreWebView2Async();

            var core = _web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;

            var webDir = Path.Combine(AppContext.BaseDirectory, "web");
            core.SetVirtualHostNameToFolderMapping(
                "appassets.local",
                webDir,
                CoreWebView2HostResourceAccessKind.DenyCors);

            await core.AddScriptToExecuteOnDocumentCreatedAsync(JavascriptShim.Source);

            // 内部导航锁：页面之间只允许相对路径；外部链接一律交给系统浏览器。
            core.NavigationStarting += (_, args) =>
            {
                var internalUri = args.Uri.StartsWith("https://appassets.local/", StringComparison.OrdinalIgnoreCase)
                                  || string.Equals(args.Uri, "about:blank", StringComparison.OrdinalIgnoreCase);
                if (!internalUri)
                {
                    args.Cancel = true;
                }
            };
            core.NewWindowRequested += (s, args) =>
            {
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps)
                {
                    _ = Launcher.LaunchUriAsync(uri);
                }
            };
            core.WebMessageReceived += OnWebMessageReceived;

            core.Navigate("https://appassets.local/index.html");
        }
        catch (Exception ex)
        {
            Root.Children.Clear();
            Root.Children.Add(new TextBlock
            {
                Text = $"启动失败：{ex.Message}",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(24),
            });
        }
    }

    private async void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (_dispatcher is null || _web?.CoreWebView2 is null) return;
        try
        {
            var response = await _dispatcher.HandleAsync(args.WebMessageAsJson);
            _web.CoreWebView2.PostWebMessageAsJson(response);
        }
        catch (Exception ex)
        {
            // handler 自己出错时也要回一个合法信封（否则页面的 Promise 永远悬着）。
            _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(
                new { id = (string?)null, ok = false, error = new BridgeErrorBody("INTERNAL", ex.Message) },
                BridgeJson.Options));
        }
    }

    private void OnBackendStateChanged(object? sender, EventArgs e)
    {
        var dispatcher = _dispatcher;
        var webView = _web;
        if (dispatcher is null || webView is null) return;

        // kit 的事件可能在后台线程；WebView 的投递必须在 UI 线程。
        webView.DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                var json = await dispatcher.StateEventJsonAsync();
                webView.CoreWebView2?.PostWebMessageAsJson(json);
            }
            catch
            {
                // 窗口已关：不再投递。
            }
        });
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        if (_backend is not null) _backend.StateChanged -= OnBackendStateChanged;
        _web?.Close();
    }

}
