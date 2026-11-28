using Clever_Vpn_Windows_Kit.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace CleverVpn.App;

public static class Program
{
    [STAThread]
    private static void Main()
    {
        // 服务模式：SCM 用同一个 exe 拉起 broker（install-broker / broker 子命令）。
        if (Service.Run().GetAwaiter().GetResult()) return;

        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(_ =>
        {
            var context = new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App();
        });
    }
}
