using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Test-only worker. It takes the same handoff as the shipped helper and never
// starts Setup or opens a desktop app.
static class HandoffFixture
{
    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfo
    {
        public int cb;
        public IntPtr reserved, desktop, title;
        public int x, y, width, height, charWidth, charHeight, fill, flags;
        public short show, reservedSize;
        public IntPtr reservedData, input, output, error;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    static extern void GetStartupInfo(out StartupInfo info);
    public static void Main(string[] args)
    {
        var json = new JavaScriptSerializer();
        var job = json.Deserialize<UpdateRequest>(File.ReadAllText(args[0]));
        string folder = Path.Combine(job.dataDir, "updates");
        string state = Path.Combine(folder, "install-state.json");
        string temporary = state + ".fixture";
        File.WriteAllText(temporary, json.Serialize(new {ticket=job.ticket, version=job.version, status="installing", pid=Process.GetCurrentProcess().Id}));
        File.Replace(temporary, state, null);
        File.WriteAllText(Path.Combine(folder, "worker"), Process.GetCurrentProcess().MainModule.FileName);
        StartupInfo startup; GetStartupInfo(out startup);
        File.WriteAllText(Path.Combine(folder, "shell-visible"), ((startup.flags & 1) == 0 || startup.show != 0) ? "yes" : "no");
        for (int i=0; i<200 && !File.Exists(Path.Combine(folder, "finish")); i++) Thread.Sleep(100);
        File.WriteAllText(temporary, json.Serialize(new {ticket=job.ticket, version=job.version, status="done"}));
        File.Replace(temporary, state, null);
    }
}

static class NativeUpdateTests
{
    static void Expect<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new Exception("Missing exception: " + typeof(T));
    }

    public static void Main(string[] args)
    {
        var json = new JavaScriptSerializer();
        var job = json.Deserialize<UpdateRequest>(File.ReadAllText(args[0]));
        MStudioUpdate.Validate(job, args[0], job.appDir);
        string file = job.installerPath;
        job.installerPath = Path.Combine(job.dataDir, "other.exe");
        Expect<InvalidDataException>(() => MStudioUpdate.Validate(job, args[0], job.appDir));
        job.installerPath = file;
        string project = job.projectId;
        job.projectId = "--other";
        Expect<InvalidDataException>(() => MStudioUpdate.Validate(job, args[0], job.appDir));
        job.projectId = "--home";
        Expect<InvalidDataException>(() => MStudioUpdate.Validate(job, args[0], job.appDir));
        job.projectId = project;
        var resume = typeof(MStudioUpdate).GetMethod("ValidResumeArgument", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        if (!(bool)resume.Invoke(null, new object[] { "--home" })) throw new Exception("Explicit home resume was refused.");
        foreach (var invalid in new[] { "--other", "--HOME", "--home extra", "--home\"", "--home\n" })
        {
            try { if ((bool)resume.Invoke(null, new object[] { invalid })) throw new Exception("An arbitrary resume option was accepted."); }
            catch (System.Reflection.TargetInvocationException error) { if (!(error.InnerException is ArgumentException)) throw; }
        }

        string hash = job.sha256;
        job.sha256 = new String('0', 64);
        Expect<InvalidDataException>(() => MStudioUpdate.Install(job, delegate { throw new Exception("Unchecked installer"); }));
        job.sha256 = hash;
        Expect<IOException>(() => MStudioUpdate.Install(job, delegate { return 2; }));
        Expect<IOException>(() => MStudioUpdate.Install(job, delegate { return 0; }));

        int calls = 0;
        MStudioUpdate.Install(job, delegate(string p, string options) {
            calls++;
            if (p != file || !options.Contains("/NOCLOSEAPPLICATIONS") || options.Contains("/VERYSILENT"))
                throw new Exception("Wrong Setup options");
            Expect<IOException>(delegate { using (File.Open(p, FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { } });
            File.WriteAllText(Path.Combine(job.appDir, "mstudio.json"), json.Serialize(new {name="MStudio", version=job.version}));
            return 0;
        });
        MStudioUpdate.Install(job, delegate { throw new Exception("Duplicate installation"); });
        job.version = "1.0.0";
        MStudioUpdate.Install(job, delegate { throw new Exception("Downgrade"); });
        if (calls != 1) throw new Exception("Setup call count");
        LifecycleWindow a = new LifecycleWindow(true), b = new LifecycleWindow(false);
        if (MStudioUpdate.SaveAndCloseWindows(new IUpdateWindow[] {a,b}, () => true).Result || a.IsDisposed || b.IsDisposed ||
            !a.Enabled || !b.Enabled || !a.Saved || !b.Saved) throw new Exception("A failed save closed a window.");
        b.CanSave = true;
        if (!MStudioUpdate.SaveAndCloseWindows(new IUpdateWindow[] {a,b}, () => true).Result || !a.IsDisposed || !b.IsDisposed)
            throw new Exception("Saved windows did not close.");
    }
}

sealed class LifecycleWindow : IUpdateWindow
{
    public bool IsDisposed { get; private set; }
    public bool Enabled { get; set; }
    public bool Saved, CanSave;
    public LifecycleWindow(bool canSave) { CanSave=canSave; Enabled=true; }
    public async Task<bool> SaveForUpdate() { await Task.Delay(40); Saved=true; return CanSave; }
    public void Close() { if (!Saved || Enabled) throw new Exception("Unexpected close"); IsDisposed=true; }
}

// These executables are compiled against unique named Windows objects for this
// test run. They share no desktop state or files with the installed application.
static class LifecycleFixture
{
    public static string Root { get { return Environment.GetEnvironmentVariable("MSTUDIO_TEST_LIFECYCLE"); } }
    public static string App { get { return Path.Combine(Root, "program"); } }
    static void Log(string file, string line) { File.AppendAllText(Path.Combine(Root,file), line + Environment.NewLine); }
    public static void Main(string[] args)
    {
        using (var desktop = MStudioUpdate.BeginDesktop(Path.Combine(Root,"data"), App, args))
        {
            if (desktop == null) return;
            if (args.Length != 1 || args[0] != "--hold")
            {
                Log("opened.txt", String.Join(" ", args));
                return;
            }
            using (var close = new EventWaitHandle(false, EventResetMode.AutoReset, MStudioUpdate.CloseEvent))
            {
                Log("host-ready","ready");
                for (var i=0; i<600 && !File.Exists(Path.Combine(Root,"close-host")); i++)
                {
                    if (!close.WaitOne(50)) continue;
                    LifecycleWindow a = new LifecycleWindow(true), b = new LifecycleWindow(true);
                    if (MStudioUpdate.SaveAndCloseWindows(new IUpdateWindow[] {a,b}, MStudioUpdate.AssistantRunning).Result)
                        Log("saved.txt", "2 saved and closed");
                    break;
                }
            }
        }
    }
}
static class LifecycleWorker
{
    [STAThread]
    public static int Main(string[] args) { return MStudioUpdate.Run(args, LifecycleFixture.App); }
}
static class LifecycleInstaller
{
    public static int Main(string[] args)
    {
        string root = LifecycleFixture.Root;
        File.AppendAllText(Path.Combine(root,"setup-count"), "setup\n");
        for (var i=0; i<600 && !File.Exists(Path.Combine(root,"allow-setup")); i++) Thread.Sleep(50);
        if (!File.Exists(Path.Combine(root,"allow-setup"))) return 2;
        File.WriteAllText(Path.Combine(LifecycleFixture.App,"mstudio.json"), "{\"name\":\"MStudio\",\"version\":\"2.3.4\"}");
        return 0;
    }
}
