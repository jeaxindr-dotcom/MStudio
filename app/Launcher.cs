// Coulisses.exe (formerly « Brambleshire Studio.exe ») — the review studio as a Windows app (user request: « je préférerais un .exe »).
// No console window. Starts the home screen (hub-server.mjs, hidden) unless one of this studio is already running,
// opens it in an app window (Chrome or Edge in --app mode: no tabs, no address bar, its own profile so the window is its
// own process), and when the last window of the app is closed, stops the home screen and every studio it started.
//   Coulisses.exe          the home screen (episodes and imported projects)
//   Coulisses.exe E03      straight into the studio of E03
//   Coulisses.exe "<folder or video>"   imports it (like opening a project in DaVinci Resolve), then opens it:
//                                    what Windows does when a folder or a video is dropped on the app's icon
//   Coulisses.exe --pick folder|video|project <out file> [<start folder>]   the Windows « open » dialog, for the home
//                                    screen's « Importer un projet… » and the menu bar's « Ouvrir un projet… » (a
//                                    .coulisses file or a video): the chosen path written to <out file> (UTF-8)
//   Coulisses.exe --lang <out file>  writes the language the app's dialogs use (fr | en): the tests
// The dialogs speak the language of the app (lib/i18n.mjs): COULISSES_LANG, else the choice kept in
// %LOCALAPPDATA%\Coulisses\settings.json, else the Windows display language (French -> fr, anything else -> en).
// Built by app\build.ps1 with the C# compiler of the .NET Framework (csc.exe, C# 5): no SDK, nothing to install.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

#if !MSTUDIO
[assembly: System.Reflection.AssemblyTitle("Coulisses")]
[assembly: System.Reflection.AssemblyProduct("Coulisses")]
[assembly: System.Reflection.AssemblyDescription("Coulisses : relire et annoter ses vidéos avant l'export")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class Launcher
{
    const string App = "Coulisses";

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--lang") { File.WriteAllText(args[1], L.Lang, new UTF8Encoding(false)); return 0; }
        if (args.Length >= 3 && args[0] == "--pick")
        {
            try { return Picker.Pick(args[1], args[2], args.Length > 3 ? args[3] : null); }
            catch (Exception e) { Fail(L.T("La fenêtre de choix n'a pas pu s'ouvrir :\n", "The file dialog could not open:\n") + e.Message); return 1; }
        }
        try { return Run(args); }
        catch (Exception e) { Fail(L.T("Erreur inattendue :\n", "Unexpected error:\n") + e.Message); return 1; }
    }

    static int Run(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string ep = null, import = null;
        foreach (string a in args)
        {
            if (Regex.IsMatch(a, "^[Ee]\\d+$")) ep = a.ToUpperInvariant();
            else if (Directory.Exists(a) || File.Exists(a)) import = Path.GetFullPath(a);   // dropped on the icon
        }
        string hubScript = Path.Combine(dir, "hub-server.mjs");
        if (!File.Exists(hubScript)) { Fail(L.T("Le studio est introuvable à côté de l'application :\n", "The studio cannot be found next to the app:\n") + hubScript); return 1; }
        string node = FindNode();
        if (node == null) { Fail(L.T("Node.js est introuvable (node.exe).\nInstalle Node.js ou ajoute-le au PATH, puis relance.", "Node.js cannot be found (node.exe).\nInstall Node.js or add it to the PATH, then start again.")); return 1; }

        string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Coulisses");
        Directory.CreateDirectory(local);
        string tag = Tag(dir);
        string lockFile = Path.Combine(local, "hub-" + tag + ".json");
        string profile = Path.Combine(local, "window-" + tag);

        Process hub = null;
        int port = RunningHub(lockFile);
        if (port == 0)
        {
            if (File.Exists(lockFile)) File.Delete(lockFile);
            ProcessStartInfo psi = new ProcessStartInfo(node, Q(hubScript) + " --lock " + Q(lockFile));
            psi.WorkingDirectory = dir; psi.UseShellExecute = false; psi.CreateNoWindow = true;
            hub = Process.Start(psi);
            DateTime t0 = DateTime.Now;
            while (port == 0 && (DateTime.Now - t0).TotalSeconds < 40)
            {
                if (hub.HasExited) { Fail(L.T("Le studio n'a pas pu démarrer.\nJournal : ", "The studio could not start.\nLog: ") + Path.Combine(local, "cache-*", "logs", "hub.log")); return 1; }
                Thread.Sleep(150);
                port = RunningHub(lockFile);
            }
            if (port == 0) { KillTree(hub.Id); Fail(L.T("Le studio ne répond pas (délai dépassé).", "The studio does not answer (timed out).")); return 1; }
        }

        string url = "http://127.0.0.1:" + port + "/" + (import != null ? "import?path=" + Uri.EscapeDataString(import) : ep != null ? "go/" + ep : "");
        string browser = FindBrowser();
        if (browser == null)
        {
            Process.Start(url);
            if (hub != null) { MessageBox.Show(L.T("Le studio est ouvert dans ton navigateur.\nClique sur OK pour l'arrêter.", "The studio is open in your browser.\nClick OK to stop it."), App, MessageBoxButtons.OK, MessageBoxIcon.Information); KillTree(hub.Id); }
            return 0;
        }
        ProcessStartInfo w = new ProcessStartInfo(browser,
            "--app=" + Q(url) + " --user-data-dir=" + Q(profile) + " --coulisses-role=interactive-preview" +
            " --no-first-run --no-default-browser-check --disable-features=Translate,TranslateUI,msUndersideButton --autoplay-policy=no-user-gesture-required --window-size=1680,1020" +
            // tests (tests/app.mjs): the same window, invisible and driven through the DevTools protocol
            (TestPort() != null ? " --headless=new --remote-debugging-port=" + TestPort() : ""));
        w.UseShellExecute = false;
        Process win = Process.Start(w);
        if (hub == null) return 0;   // another launcher owns the home screen: it stops it when the last window closes

        // wait for the last window of the app: the browser process of this profile (it may be another process than the
        // one just started, when the profile was already open), then stop the home screen and its studios
        win.WaitForExit();
        Thread.Sleep(1500);
        while (ProfileOpen(profile)) Thread.Sleep(1000);
        try { using (WebClient wc = new WebClient()) wc.UploadString("http://127.0.0.1:" + port + "/api/quit", ""); } catch { }
        Thread.Sleep(800);
        if (!hub.HasExited) KillTree(hub.Id);
        return 0;
    }

    // a home screen of THIS studio already running? (lock file written by hub-server.mjs, process alive, answers /api/ping)
    static int RunningHub(string lockFile)
    {
        try
        {
            if (!File.Exists(lockFile)) return 0;
            string j = File.ReadAllText(lockFile);
            Match mp = Regex.Match(j, "\"port\"\\s*:\\s*(\\d+)"), mi = Regex.Match(j, "\"pid\"\\s*:\\s*(\\d+)");
            if (!mp.Success || !mi.Success) return 0;
            try { Process.GetProcessById(int.Parse(mi.Groups[1].Value)); } catch { return 0; }
            int port = int.Parse(mp.Groups[1].Value);
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/ping");
            r.Timeout = 1500; r.Proxy = null;
            using (WebResponse resp = r.GetResponse()) using (StreamReader sr = new StreamReader(resp.GetResponseStream()))
                return sr.ReadToEnd().Contains("\"hub\":true") ? port : 0;
        }
        catch { return 0; }
    }

    static bool ProfileOpen(string profile)
    {
        try
        {
            string needle = profile.ToLowerInvariant();
            using (ManagementObjectSearcher s = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name = 'chrome.exe' OR Name = 'msedge.exe'"))
                foreach (ManagementObject o in s.Get())
                {
                    object cl = o["CommandLine"];
                    if (cl != null && cl.ToString().ToLowerInvariant().Contains(needle) && !cl.ToString().Contains("--type=")) return true;
                }
        }
        catch { }
        return false;
    }

    static string FindNode()
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string d in path.Split(';'))
        {
            try { string f = Path.Combine(d.Trim().Trim('"'), "node.exe"); if (d.Trim().Length > 0 && File.Exists(f)) return f; } catch { }
        }
        string[] known = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
        };
        return known.FirstOrDefault(File.Exists);
    }

    static string FindBrowser()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), la = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] c = {
            Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"), Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"), Path.Combine(la, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        return c.FirstOrDefault(File.Exists);
    }

    static void KillTree(int pid)
    {
        try
        {
            ProcessStartInfo k = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
            k.UseShellExecute = false; k.CreateNoWindow = true;
            Process.Start(k).WaitForExit(5000);
        }
        catch { }
    }

    static string Tag(string dir)
    {
        using (SHA1 h = SHA1.Create())
            return string.Concat(h.ComputeHash(Encoding.UTF8.GetBytes(dir.ToLowerInvariant())).Take(4).Select(b => b.ToString("x2")));
    }
    static string Q(string s) { return "\"" + s + "\""; }
    // tests (tests/app.mjs): COULISSES_TEST_PORT, or the old BRAMBLESHIRE_STUDIO_TEST_PORT
    static string TestPort() { return Environment.GetEnvironmentVariable("COULISSES_TEST_PORT") ?? Environment.GetEnvironmentVariable("BRAMBLESHIRE_STUDIO_TEST_PORT"); }
    static void Fail(string m) { MessageBox.Show(m, App, MessageBoxButtons.OK, MessageBoxIcon.Error); }
}

#endif

// The Windows « open » dialog (the modern one, IFileOpenDialog), to import a project: a folder, or a video file.
// The home screen runs it in the background, so it is owned by an invisible topmost window brought to the front:
// otherwise Windows would leave it behind the studio's window.
static class Picker
{
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCom { }
    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, [MarshalAs(UnmanagedType.LPArray)] FilterSpec[] rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FilterSpec { [MarshalAs(UnmanagedType.LPWStr)] public string Name; [MarshalAs(UnmanagedType.LPWStr)] public string Spec; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800, FOS_FILEMUSTEXIST = 0x1000;
    const uint SIGDN_FILESYSPATH = 0x80058000;
    const int ERROR_CANCELLED = unchecked((int)0x800704C7);

    // mode = folder | video | project (a .coulisses file, or a video) | check / project-check (creates the dialog without
    // showing it: the tests)
    public static int Pick(string mode, string outFile, string startFolder)
    {
        IFileDialog d = (IFileDialog)new FileOpenDialogCom();
        bool proj = mode == "project" || mode == "project-check", folder = mode != "video" && !proj;
#if MSTUDIO
        const string VIDEOS = "*.mp4;*.mov;*.m4v;*.mkv;*.webm;*.avi;*.mts;*.m2ts";
        const string product = "MStudio";
#else
        const string VIDEOS = "*.mp4;*.mov;*.m4v;*.mkv;*.webm";
        const string product = "Coulisses";
#endif
        d.SetOptions(FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | (folder ? FOS_PICKFOLDERS : FOS_FILEMUSTEXIST));
        d.SetTitle(proj ? L.T("Ouvrir un projet : un fichier .coulisses ou une vidéo", "Open a project: a .coulisses file or a video")
            : folder ? L.T("Importer un projet : choisis son dossier", "Import a project: choose its folder") : L.T("Importer une vidéo", "Import a video"));
        d.SetOkButtonLabel(proj ? L.T("Ouvrir", "Open") : L.T("Importer", "Import"));
        if (proj) d.SetFileTypes(4, new[] {
            new FilterSpec { Name = L.T("Projets " + product + " et vidéos", product + " projects and videos"), Spec = "*.coulisses;" + VIDEOS },
            new FilterSpec { Name = L.T("Projets " + product, product + " projects"), Spec = "*.coulisses" },
            new FilterSpec { Name = L.T("Vidéos", "Videos"), Spec = VIDEOS }, new FilterSpec { Name = L.T("Tous les fichiers", "All files"), Spec = "*.*" } });
        else if (!folder) d.SetFileTypes(2, new[] { new FilterSpec { Name = L.T("Vidéos", "Videos"), Spec = VIDEOS }, new FilterSpec { Name = L.T("Tous les fichiers", "All files"), Spec = "*.*" } });
        if (!string.IsNullOrEmpty(startFolder) && Directory.Exists(startFolder))
        {
            try { IShellItem start; SHCreateItemFromParsingName(startFolder, IntPtr.Zero, typeof(IShellItem).GUID, out start); d.SetFolder(start); } catch { }
        }
        if (mode == "check" || mode == "project-check") { File.WriteAllText(outFile, "ok", new UTF8Encoding(false)); return 0; }

        using (Form owner = new Form())
        {
            owner.TopMost = true; owner.ShowInTaskbar = false; owner.FormBorderStyle = FormBorderStyle.None; owner.Opacity = 0;
            owner.StartPosition = FormStartPosition.CenterScreen; owner.Size = new System.Drawing.Size(1, 1);
            owner.Show();
            // the foreground belongs to the studio's window: share its input queue a moment to take the front
            IntPtr fg = GetForegroundWindow();
            uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero), me = GetCurrentThreadId();
            if (fgThread != me) AttachThreadInput(me, fgThread, true);
            SetForegroundWindow(owner.Handle); owner.Activate();
            if (fgThread != me) AttachThreadInput(me, fgThread, false);
            int hr = d.Show(owner.Handle);
            if (hr == ERROR_CANCELLED) return 2;
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            IShellItem item; d.GetResult(out item);
            string path; item.GetDisplayName(SIGDN_FILESYSPATH, out path);
            File.WriteAllText(outFile, path, new UTF8Encoding(false));
            return 0;
        }
    }
}
