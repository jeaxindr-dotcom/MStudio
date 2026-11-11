using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.VisualBasic.ApplicationServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("MStudio")]
[assembly: AssemblyProduct("MStudio")]
[assembly: AssemblyDescription("Montage et revue de projets Remotion")]
[assembly: AssemblyVersion("0.2.5.0")]
[assembly: AssemblyFileVersion("0.2.5.0")]
[assembly: Guid("1832da9f-bb81-469a-8b74-87bb72e405a6")]

static class MStudioProgram
{
    public static readonly string InstallDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    public static readonly string DataDir = Path.GetFullPath(Environment.GetEnvironmentVariable("MSTUDIO_DATA_DIR") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MStudio"));

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string id);

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            Environment.SetEnvironmentVariable("COULISSES_SETTINGS", Path.Combine(DataDir, "settings.json"));
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (args.Length >= 3 && args[0] == "--pick")
                return Picker.Pick(args[1], args[2], args.Length > 3 ? args[3] : null);
            if (args.Length == 2 && args[0] == "--lang")
            {
                File.WriteAllText(args[1], L.Lang, new UTF8Encoding(false));
                return 0;
            }
            SetCurrentProcessExplicitAppUserModelID("MStudio.Desktop");
            CoreWebView2Environment.SetLoaderDllFolderPath(InstallDir);
            using (var running = MStudioUpdate.BeginDesktop(DataDir, InstallDir, args))
            {
                if (running == null) return 0;
                using (var hub = new DesktopHub())
                {
                    var app = new DesktopApplication(hub);
                    app.Run(args);
                }
            }
            return 0;
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            MessageBox.Show(ex.Message, "MStudio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    public static void Log(string text)
    {
        try { File.AppendAllText(Path.Combine(DataDir, "desktop.log"), DateTime.Now.ToString("s") + "  " + text + Environment.NewLine); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

sealed class DesktopApplication : WindowsFormsApplicationBase
{
    readonly DesktopHub hub;
    EventWaitHandle closeForUpdate;
    RegisteredWaitHandle updateListener;
    Control dispatcher;
    bool closingForUpdate;

    public DesktopApplication(DesktopHub hub)
    {
        this.hub = hub;
        IsSingleInstance = true;
        EnableVisualStyles = true;
        ShutdownStyle = ShutdownMode.AfterAllFormsClose;
    }

    protected override void OnCreateMainForm()
    {
        hub.Start();
        MainForm = new StudioWindow(hub.Address(CommandLineArgs));
        dispatcher = new Control();
        dispatcher.CreateControl();
        closeForUpdate = new EventWaitHandle(false, EventResetMode.AutoReset, MStudioUpdate.CloseEvent);
        updateListener = ThreadPool.RegisterWaitForSingleObject(closeForUpdate, delegate {
            try { dispatcher.BeginInvoke(new Action(CloseForUpdate)); } catch (InvalidOperationException) { }
        }, null, Timeout.Infinite, false);
    }

    async void CloseForUpdate()
    {
        if (closingForUpdate || !MStudioUpdate.AssistantRunning()) return;
        closingForUpdate = true;
        var windows = Application.OpenForms.OfType<StudioWindow>().Where(w => !w.IsDisposed).ToArray();
        bool ready = false;
        try
        {
            ready = await MStudioUpdate.SaveAndCloseWindows(windows, MStudioUpdate.AssistantRunning);
        }
        catch (Exception error) { MStudioProgram.Log(error.ToString()); }
        if (!ready)
        {
            EventWaitHandle refused;
            if (EventWaitHandle.TryOpenExisting(MStudioUpdate.RefusedEvent, out refused))
                using (refused) refused.Set();
            closingForUpdate = false;
        }
    }

    protected override void OnShutdown()
    {
        if (updateListener != null) updateListener.Unregister(null);
        if (closeForUpdate != null) closeForUpdate.Dispose();
        if (dispatcher != null) dispatcher.Dispose();
        base.OnShutdown();
    }

    // A double click activates the existing window. Opening another file keeps the
    // current edit available in its own window and reuses the same project library.
    protected override void OnStartupNextInstance(StartupNextInstanceEventArgs e)
    {
        if (closingForUpdate || MStudioUpdate.AssistantRunning()) { e.BringToForeground = false; return; }
        if (e.CommandLine.Count > 0)
        {
            var next = new StudioWindow(hub.Address(e.CommandLine));
            next.Show();
            next.Activate();
            e.BringToForeground = false;
        }
        else
        {
            Form current = Form.ActiveForm ?? Application.OpenForms.Cast<Form>().LastOrDefault();
            if (current != null)
            {
                if (current.WindowState == FormWindowState.Minimized) current.WindowState = FormWindowState.Normal;
                current.Activate();
            }
            e.BringToForeground = true;
        }
        base.OnStartupNextInstance(e);
    }
}

sealed class DesktopHub : IDisposable
{
    readonly string dir = MStudioProgram.InstallDir;
    readonly string data = MStudioProgram.DataDir;
    readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
    Process child;
    int hubPid;
    int port;
    string LockFile { get { return Path.Combine(data, "hub.json"); } }

    static bool SameFolder(string x, string y)
    {
        return !String.IsNullOrEmpty(x) && String.Equals(Path.GetFullPath(x).TrimEnd('\\'), Path.GetFullPath(y).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    static string Quote(string path) { return "\"" + path + "\""; }

    public void Start()
    {
        if (TryRecover()) return;
        string server = Path.Combine(dir, "hub-server.mjs");
        string runtime = Path.Combine(dir, "runtime");
        string node = Path.Combine(runtime, "node.exe");
        if (!File.Exists(server) || !File.Exists(node))
            throw new IOException(L.T("L'installation de MStudio est incomplète. Relance l'installeur.", "The MStudio installation is incomplete. Run Setup again."));
        var start = new ProcessStartInfo(node, Quote(server) + " --port 4510 --studio-port 4520 --lock " + Quote(LockFile));
        start.CreateNoWindow = true;
        start.UseShellExecute = false;
        start.WorkingDirectory = dir;
        start.EnvironmentVariables["PATH"] = runtime + ";" + Environment.GetEnvironmentVariable("PATH");
        start.EnvironmentVariables["MSTUDIO_APP"] = "1";
        start.EnvironmentVariables["MSTUDIO_UPDATE_PROTOCOL"] = "2";
        start.EnvironmentVariables["MSTUDIO_DATA_DIR"] = data;
        start.EnvironmentVariables["COULISSES_SETTINGS"] = Path.Combine(data, "settings.json");
        start.EnvironmentVariables["STUDIO_PROJECTS"] = Path.Combine(data, "projets.json");
        start.EnvironmentVariables["COULISSES_V2_OWN_STUDIOS"] = "1";
        string picker = Application.ExecutablePath;
        start.EnvironmentVariables["COULISSES_PICKER_EXE"] = picker;
        start.EnvironmentVariables["MSTUDIO_PICKER_EXE"] = picker;
        string engine = Environment.GetEnvironmentVariable("MSTUDIO_ENGINE_DIR") ?? Path.Combine(dir, "engine");
        start.EnvironmentVariables["MSTUDIO_ENGINE_DIR"] = engine;
        start.EnvironmentVariables["COULISSES_REVERSE_ENGINE"] = engine;
        // With no explicit override the library remembers the chosen project folder in
        // MStudio's settings, including when the user changes the interface language.
        string projects = Environment.GetEnvironmentVariable("MSTUDIO_PROJECTS_ROOT");
        if (String.IsNullOrWhiteSpace(projects)) start.EnvironmentVariables.Remove("COULISSES_PROJECTS_ROOT");
        else start.EnvironmentVariables["COULISSES_PROJECTS_ROOT"] = projects;
        child = Process.Start(start);
        var watch = Stopwatch.StartNew();
        while (!child.HasExited && watch.Elapsed.TotalSeconds < 30)
        {
            if (TryRecover()) return;
            Thread.Sleep(110);
        }
        throw new IOException(L.T("L'accueil de MStudio n'a pas pu démarrer. Journaux dans ", "The MStudio library did not start. Logs in ") + data);
    }

    bool OwnsEndpoint(int candidate, int pid)
    {
        if (candidate <= 0 || candidate > 65535 || pid <= 0) return false;
        var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + candidate + "/api/ping");
        req.Proxy = null;
        req.Timeout = req.ReadWriteTimeout = 1000;
        using (var response = req.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream()))
        {
            var info = serializer.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            return Convert.ToBoolean(info["hub"]) && Convert.ToString(info["app"]) == "MStudio"
                && Convert.ToInt32(info["pid"]) == pid && SameFolder(Convert.ToString(info["studioDir"]), dir)
                && SameFolder(Convert.ToString(info["dataDir"]), data);
        }
    }

    bool TryRecover()
    {
        try
        {
            var entry = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(LockFile));
            int candidate = Convert.ToInt32(entry["port"]), pid = Convert.ToInt32(entry["pid"]);
            if (!SameFolder(Convert.ToString(entry["studio"]), dir) || (child != null && child.Id != pid)) return false;
            using (var process = Process.GetProcessById(pid))
            {
                if (process.HasExited || !OwnsEndpoint(candidate, pid)) return false;
            }
            port = candidate;
            hubPid = pid;
            return true;
        }
        catch (Exception e)
        {
            if (e is IOException || e is UnauthorizedAccessException || e is KeyNotFoundException || e is WebException ||
                e is InvalidOperationException || e is ArgumentException || e is FormatException) return false;
            throw;
        }
    }

    public Uri Address(IEnumerable<string> args)
    {
        string route = "";
        foreach (var arg in args)
        {
            if (File.Exists(arg) || Directory.Exists(arg)) { route = "import?path=" + Uri.EscapeDataString(Path.GetFullPath(arg)); break; }
            if (Regex.IsMatch(arg, @"^[EP](?:\d+|[a-f0-9]{8})$", RegexOptions.IgnoreCase))
                route = "go/" + Uri.EscapeDataString(arg);
        }
        return new Uri("http://127.0.0.1:" + port + "/" + route);
    }

    public void Dispose()
    {
        try
        {
            if (port != 0 && OwnsEndpoint(port, hubPid))
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/quit");
                req.Method = "POST";
                req.ContentLength = 0;
                req.Proxy = null;
                req.Timeout = 3000;
                using (req.GetResponse()) { }
            }
        }
        catch (Exception e) { MStudioProgram.Log(e.Message); }
        if (child != null)
        {
            if (!child.HasExited && !child.WaitForExit(8000))
            {
                var stop = new ProcessStartInfo("taskkill.exe", "/PID " + child.Id + " /T /F");
                stop.UseShellExecute = false;
                stop.CreateNoWindow = true;
                using (var task = Process.Start(stop)) task.WaitForExit(5000);
            }
            child.Dispose();
        }
    }
}

sealed class StudioWindow : Form, IUpdateWindow
{
    readonly Uri home;
    WebView2 view;
    readonly Label loading = new Label();
    Process fallback;

    public StudioWindow(Uri address)
    {
        home = address;
        Text = "MStudio";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(16,20,23);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1320, 880);
        MinimumSize = new Size(540, 400);
        WindowState = FormWindowState.Maximized;
        loading.Text = L.T("Ouverture de MStudio…", "Opening MStudio…");
        loading.TextAlign = ContentAlignment.MiddleCenter;
        loading.ForeColor = Color.WhiteSmoke;
        loading.Dock = DockStyle.Fill;
        Controls.Add(loading);
        Shown += Open;
    }

    async void Open(object sender, EventArgs ev)
    {
        try
        {
            var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(MStudioProgram.DataDir, "WebView2"), options);
            if (IsDisposed) return;
            view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
            Controls.Add(view);
            await view.EnsureCoreWebView2Async(env);
            if (IsDisposed) return;
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.DocumentTitleChanged += delegate {
                string page = core.DocumentTitle;
                Text = String.IsNullOrWhiteSpace(page) || page == "MStudio" ? "MStudio" : page.StartsWith("MStudio") ? page : "MStudio · " + page;
            };
            core.NewWindowRequested += delegate(object _, CoreWebView2NewWindowRequestedEventArgs e) {
                e.Handled = true;
                if (MStudioUpdate.AssistantRunning()) return;
                Uri destination;
                if (!e.IsUserInitiated || !Uri.TryCreate(e.Uri, UriKind.Absolute, out destination)) return;
                if (LocalPage(destination)) new StudioWindow(destination).Show();
                else OpenWebsite(destination);
            };
            core.NavigationStarting += delegate(object _, CoreWebView2NavigationStartingEventArgs e) {
                Uri destination;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out destination) && LocalPage(destination)) return;
                e.Cancel = true;
                if (e.IsUserInitiated && destination != null) OpenWebsite(destination);
            };
            core.WindowCloseRequested += delegate { Close(); };
            core.ProcessFailed += delegate(object _, CoreWebView2ProcessFailedEventArgs e) {
                MStudioProgram.Log("WebView2: " + e.ProcessFailedKind);
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited && !IsDisposed) core.Reload();
            };
            view.BringToFront();
            view.Source = home;
        }
        catch (Exception e)
        {
            if (IsDisposed) return;
            MStudioProgram.Log(e.ToString());
            if (view != null) { view.Dispose(); view = null; }
            if (!OpenEdgeWindow()) {
                MessageBox.Show(this, L.T("La fenêtre de MStudio nécessite Microsoft Edge WebView2 ou un navigateur Edge ou Chrome installé. ", "MStudio needs Microsoft Edge WebView2 or an installed Edge or Chrome browser. ") + e.Message,
                    "MStudio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }
    }

    static bool LocalPage(Uri uri)
    {
        return uri.Scheme == Uri.UriSchemeHttp && (uri.IsLoopback || uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase));
    }

    static void OpenWebsite(Uri uri)
    {
        if (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    bool OpenEdgeWindow()
    {
        var roots = new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) };
        string exe = roots.SelectMany(root => new[] { Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe"), Path.Combine(root, @"Google\Chrome\Application\chrome.exe") }).FirstOrDefault(File.Exists);
        if (exe == null) return false;
        string profile = Path.Combine(MStudioProgram.DataDir, "Browser");
        string args = "--app=\"" + home.AbsoluteUri + "\" --user-data-dir=\"" + profile + "\" --no-first-run --disable-background-mode --autoplay-policy=no-user-gesture-required";
        fallback = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false });
        Hide();
        fallback.EnableRaisingEvents = true;
        fallback.Exited += delegate { if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(Close)); };
        if (fallback.HasExited) Close();
        return true;
    }

    public async Task<bool> SaveForUpdate()
    {
        // A fallback browser has its own windows and unsaved work. Never force
        // them closed when the desktop cannot request an acknowledged save.
        if (fallback != null && !fallback.HasExited) return false;
        if (IsDisposed || view == null || view.CoreWebView2 == null || view.Source == null) return true;
        var core = view.CoreWebView2;
        string page = core.Source, nonce = "mstudio-update-" + Guid.NewGuid().ToString("N");
        var result = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2WebMessageReceivedEventArgs> receive = delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
            if (e.Source != page) return;
            string reply;
            try { reply = e.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
            if (reply == nonce + ":ok" || reply == nonce + ":failed") result.TrySetResult(reply == nonce + ":ok");
        };
        core.WebMessageReceived += receive;
        try
        {
            // ExecuteScriptAsync does not await JavaScript promises. The page
            // acknowledges only after the actual save and draft writes finish.
            var timeout = Task.Delay(15000);
            var dispatch = core.ExecuteScriptAsync("(async()=>{let ok=false;try{" +
                "if(typeof window.MStudioBeforeUpdate==='function') await window.MStudioBeforeUpdate();" +
                "ok=true;}finally{chrome.webview.postMessage('" + nonce + ":'+(ok?'ok':'failed'));}})().catch(()=>{})");
            if (await Task.WhenAny(dispatch, timeout) != dispatch) return false;
            await dispatch;
            return await Task.WhenAny(result.Task, timeout) == result.Task && result.Task.Result;
        }
        finally { if (!IsDisposed) core.WebMessageReceived -= receive; }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && fallback != null) { fallback.Dispose(); fallback = null; }
        base.Dispose(disposing);
    }
}
