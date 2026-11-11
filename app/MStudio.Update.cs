using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Unlike the desktop host this worker runs from the per-user update cache.
// The user closes the editor normally, including its other open projects.
sealed class UpdateRequest
{
    public string installerPath { get; set; }
    public string sha256 { get; set; }
    public string version { get; set; }
    public string appDir { get; set; }
    public string dataDir { get; set; }
    public string projectId { get; set; }
    public string language { get; set; }
    public string mode { get; set; }
    public string ticket { get; set; }
    public string status { get; set; }
    public int hubPid { get; set; }

    public string Text(string fr, string en) { return language == "en" ? en : fr; }
}

interface IUpdateWindow
{
    bool IsDisposed { get; }
    bool Enabled { get; set; }
    Task<bool> SaveForUpdate();
    void Close();
}

sealed class UpdateMarker
{
    public string name { get; set; }
    public string version { get; set; }
}

static class MStudioUpdate
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly Regex Release = new Regex(@"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$");
    const string Options = "/SILENT /NORESTART /NOCLOSEAPPLICATIONS /NORESTARTAPPLICATIONS";
    const string DesktopMutex = @"Local\MStudio.Desktop.Running";
    const string WorkerMutex = @"Local\MStudio.Update.Worker";
    public const string CloseEvent = @"Local\MStudio.Update.CloseDesktop";
    public const string RefusedEvent = @"Local\MStudio.Update.SaveFailed";

    static bool SamePath(string a, string b)
    {
        return String.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    public static void Validate(UpdateRequest job, string requestPath, string standardInstall)
    {
        Guid ticket;
        if (!Guid.TryParseExact(job.ticket, "D", out ticket) || (job.mode != "defer" && job.hubPid <= 0) ||
            job.mode != null && job.mode != "defer" && job.mode != "install" ||
            !Release.IsMatch(job.version ?? "") || !Regex.IsMatch(job.sha256 ?? "", @"\A[0-9a-fA-F]{64}\z") ||
            !String.IsNullOrEmpty(job.projectId) && !Regex.IsMatch(job.projectId, @"\A(?:E\d+|P[0-9a-fA-F]{8})\z"))
            throw new InvalidDataException("Invalid update request.");
        string folder = Path.Combine(job.dataDir, "updates");
        if (!SamePath(requestPath, Path.Combine(folder, "request-" + job.ticket + ".json")) ||
            !SamePath(job.installerPath, Path.Combine(folder, "MStudio-Setup-" + job.version + "-win-x64.exe")) ||
            !SamePath(job.appDir, standardInstall)) throw new InvalidDataException("Invalid MStudio update location.");
        ReadVersion(job.appDir);
    }

    static Version ReadVersion(string appDir)
    {
        var marker = Json.Deserialize<UpdateMarker>(File.ReadAllText(Path.Combine(appDir, "mstudio.json")));
        Version value;
        if (marker.name != "MStudio" || !Version.TryParse(marker.version, out value))
            throw new InvalidDataException("Invalid MStudio installation.");
        return value;
    }

    static void Receipt(UpdateRequest job, string status, string code, string error)
    {
        string state = Path.Combine(job.dataDir, "updates", "install-state.json");
        var previous = Json.Deserialize<UpdateRequest>(File.ReadAllText(state));
        if (previous.ticket != job.ticket || (previous.status != "installing" &&
            !(previous.status == "scheduled" && job.mode == "defer"))) throw new InvalidOperationException("Update request replaced.");
        string temp = state + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, Json.Serialize(new {status, errorCode=code, error, ticket=job.ticket, version=job.version, pid=Process.GetCurrentProcess().Id}), new UTF8Encoding(false));
            File.Replace(temp, state, null);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    static bool ExistsMutex(string name)
    {
        Mutex app;
        if (!Mutex.TryOpenExisting(name, out app)) return false;
        app.Dispose();
        return true;
    }

    public static bool AssistantRunning() { return ExistsMutex(WorkerMutex); }

    public static async Task<bool> SaveAndCloseWindows(IUpdateWindow[] windows, Func<bool> updateActive)
    {
        try
        {
            foreach (var window in windows) window.Enabled = false;
            var results = await Task.WhenAll(windows.Select(w => w.SaveForUpdate()));
            if (!results.All(saved => saved) || !updateActive()) return false;
            foreach (var window in windows) if (!window.IsDisposed) window.Close();
            return true;
        }
        finally
        {
            foreach (var window in windows) if (!window.IsDisposed) window.Enabled = true;
        }
    }

    // Serialize ordinary launches so two desktop shortcuts cannot both consume
    // a scheduled update. Keep the desktop mutex alive until the hub has exited.
    public static Mutex BeginDesktop(string dataDir, string appDir, string[] launchArgs)
    {
        using (var gate = new Mutex(false, @"Local\MStudio.Update.DesktopEntry"))
        {
            try { gate.WaitOne(); } catch (AbandonedMutexException) { }
            try
            {
                if (AssistantRunning()) return null;
                if (!ExistsMutex(DesktopMutex) && TryStartScheduled(dataDir, appDir, launchArgs)) return null;
                return new Mutex(false, DesktopMutex);
            }
            finally { gate.ReleaseMutex(); }
        }
    }

    static string CacheHelper(string appDir, string dir)
    {
        byte[] source = File.ReadAllBytes(Path.Combine(appDir, "MStudio.Update.exe"));
        using (var sha = SHA256.Create())
        {
            string digest = BitConverter.ToString(sha.ComputeHash(source)).Replace("-", "").ToLowerInvariant();
            string cache = Path.Combine(dir, "assistant", digest);
            Directory.CreateDirectory(cache);
            string helper = Path.Combine(cache, "MStudio.Update.exe");
            if (!File.Exists(helper))
            {
                using (var stream = new FileStream(helper, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    stream.Write(source, 0, source.Length);
            }
            return helper;
        }
    }

    // The signed-in user's desktop app loads only a worker identical to its
    // installed helper. A scheduled request never supplies an executable path.
    public static bool TryStartScheduled(string dataDir, string appDir, string[] launchArgs)
    {
        string dir = Path.Combine(dataDir, "updates"), state = Path.Combine(dir, "install-state.json");
        if (!File.Exists(state)) return false;
        UpdateRequest saved;
        try { saved = Json.Deserialize<UpdateRequest>(File.ReadAllText(state)); }
        catch (Exception e) { if (e is IOException || e is ArgumentException || e is InvalidOperationException) return false; throw; }
        Guid id;
        if (saved == null || saved.status != "scheduled" || !Guid.TryParseExact(saved.ticket, "D", out id)) return false;
        string requestPath = Path.Combine(dir, "request-" + saved.ticket + ".json");
        saved.dataDir = dataDir; saved.mode = "defer";
        try
        {
            var job = Json.Deserialize<UpdateRequest>(File.ReadAllText(requestPath));
            if (job != null && !SamePath(job.appDir, appDir)) return false; // A development checkout must not claim the desktop's request.
            if (job == null || job.ticket != saved.ticket || job.mode != "defer" || !SamePath(job.dataDir, dataDir) || job.version != saved.version)
                throw new InvalidDataException("Invalid scheduled MStudio update.");
            Validate(job, requestPath, appDir);
            string helper = CacheHelper(appDir, dir);
            using (var verified = File.Open(helper, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var installed = File.OpenRead(Path.Combine(appDir, "MStudio.Update.exe")))
            using (var sha = SHA256.Create())
            {
                if (Convert.ToBase64String(sha.ComputeHash(verified)) != Convert.ToBase64String(sha.ComputeHash(installed)))
                    throw new IOException("MStudio update helper verification failed.");
                var resume = launchArgs.Length == 1 && ValidResumeArgument(launchArgs[0]) ? launchArgs[0] : null;
                var start = new ProcessStartInfo(helper, Quote(requestPath) + (resume == null ? "" : " " + Quote(resume))) {
                    WorkingDirectory=Path.GetDirectoryName(helper), UseShellExecute=false
                };
                using (var child = Process.Start(start))
                {
                    var deadline = Stopwatch.StartNew();
                    while (!child.HasExited && deadline.ElapsedMilliseconds < 10000)
                    {
                        if (AssistantRunning()) return true;
                        Thread.Sleep(30);
                    }
                    // A worker that already finished reopens the requested project itself.
                    if (child.HasExited && child.ExitCode == 0) return true;
                    if (!child.HasExited) return true;
                    throw new IOException("MStudio update helper could not start.");
                }
            }
        }
        catch (Exception error)
        {
            try { Receipt(saved, "error", "update-install", error.Message); }
            catch (Exception e) { if (!(e is IOException || e is InvalidOperationException)) throw; }
            return false; // The previous version opens with the recorded error.
        }
    }

    static bool ValidResumeArgument(string value)
    {
        return !String.IsNullOrEmpty(value) && value.IndexOf('"') < 0 &&
            (Regex.IsMatch(value, @"\A(?:E\d+|P[0-9a-fA-F]{8})\z") ||
             Path.IsPathRooted(value) && (File.Exists(value) || Directory.Exists(value)));
    }

    static string Quote(string value) { return "\"" + Regex.Replace(value, @"(\\+)\z", "$1$1") + "\""; }

    static void WaitForDesktop(UpdateRequest job)
    {
        // Keep the original PID's process handle; never signal or kill a process.
        if (job.mode == "defer") return; // A scheduled update is claimed before creating the desktop or its hub.
        Process hub = null;
        EventWaitHandle refused = null;
        try
        {
            try { hub = Process.GetProcessById(job.hubPid); var handle = hub.Handle; }
            catch (ArgumentException) { } // Already closed.
            catch (InvalidOperationException) { if (hub != null) hub.Dispose(); hub = null; }
            if (job.mode == "install" && ExistsMutex(DesktopMutex))
            {
                EventWaitHandle close;
                if (EventWaitHandle.TryOpenExisting(CloseEvent, out close))
                {
                    using (close)
                    {
                        refused = new EventWaitHandle(false, EventResetMode.ManualReset, RefusedEvent);
                        refused.Reset();
                        close.Set();
                    }
                }
                else if (ExistsMutex(DesktopMutex)) throw new IOException(job.Text(
                    "La fenêtre MStudio ne répond pas à la demande de redémarrage. Tu peux programmer cette mise à jour pour le prochain lancement.",
                    "The MStudio window did not receive the restart request. You can schedule the update for the next launch."));
            }
            var closing = Stopwatch.StartNew();
            while (ExistsMutex(DesktopMutex))
            {
                if (job.mode == "install" && closing.Elapsed.TotalSeconds > 45) throw new IOException(job.Text(
                    "Une fenêtre MStudio est toujours ouverte. Termine ton travail et réessaie.",
                    "A MStudio window is still open. Finish your work and retry."));
                if (refused == null) Thread.Sleep(180);
                else if (refused.WaitOne(180)) throw new IOException(job.Text(
                    "MStudio n’a pas pu enregistrer et fermer toutes les fenêtres. Elles restent ouvertes.",
                    "MStudio could not save and close all windows. They remain open."));
            }
            if (hub != null && !hub.WaitForExit(15000))
                throw new IOException(job.Text("La bibliothèque MStudio est encore ouverte. Ferme-la avant de réessayer.",
                    "The MStudio library is still open. Close it before retrying."));
        }
        finally { if (refused != null) refused.Dispose(); if (hub != null) hub.Dispose(); }
    }

    static int RunSetup(string path, string args)
    {
        // ShellExecute lets Windows apply its usual downloaded-file, signature
        // and application-control checks. Inno runs with its per-user manifest.
        using (var setup = Process.Start(new ProcessStartInfo(path, args) {UseShellExecute=true, WindowStyle=ProcessWindowStyle.Normal, WorkingDirectory=Path.GetDirectoryName(path)}))
        {
            if (setup == null) throw new IOException("Setup did not start.");
            setup.WaitForExit();
            return setup.ExitCode;
        }
    }

    public static void Install(UpdateRequest job, Func<string,string,int> startSetup)
    {
        Version target = Version.Parse(job.version);
        if (ReadVersion(job.appDir) >= target) return;
        using (var input = new FileStream(job.installerPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var sha = SHA256.Create())
        {
            string actual = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
            if (!String.Equals(actual, job.sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException(job.Text("L’empreinte de l’installeur a changé. Télécharge à nouveau la mise à jour.",
                    "The installer checksum changed. Download the update again."));
            // Hold the verified bytes read-only until Setup exits. /SILENT keeps
            // Inno's progress visible. It never restarts Windows or closes apps.
            int exit = startSetup(job.installerPath, Options);
            if (exit != 0) throw new IOException(job.Text("Installation interrompue (code Windows ", "Setup stopped (Windows code ") + exit + ").");
        }
        if (ReadVersion(job.appDir) != target)
            throw new IOException(job.Text("Windows n’a pas installé la version attendue.", "Windows did not install the expected version."));
    }

    [STAThread]
    static int Main(string[] args)
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Run(args, Path.Combine(local, "Programs", "MStudio"));
    }

    public static int Run(string[] args, string standardInstall)
    {
        UpdateRequest job = null;
        bool accepted = false, reopen = false;
        Mutex worker = null;
        try
        {
            if (args.Length < 1 || args.Length > 2 || (args.Length == 2 && !ValidResumeArgument(args[1]))) return 2;
            job = Json.Deserialize<UpdateRequest>(File.ReadAllText(args[0]));
            Validate(job, args[0], standardInstall);
            bool first;
            worker = new Mutex(false, WorkerMutex, out first);
            if (!first) return 3;
            Receipt(job, "installing", null, null);
            accepted = true;
            if (job.mode == "defer") { try { File.Delete(args[0]); } catch (IOException) { } }
            WaitForDesktop(job);
            reopen = true;
            Install(job, RunSetup);
            Receipt(job, "done", null, null);
            return 0;
        }
        catch (Exception error)
        {
            var denied = error as Win32Exception;
            string detail = denied != null && denied.NativeErrorCode == 1223 && job != null ?
                job.Text("La confirmation Windows a été annulée.", "Windows confirmation was cancelled.") : error.Message;
            if (accepted)
            {
                try { Receipt(job, "error", "update-install", detail); }
                catch (Exception receiptError) { if (!(receiptError is IOException || receiptError is InvalidOperationException)) throw; }
                if (reopen) MessageBox.Show(detail, "MStudio", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return 1;
        }
        finally
        {
            if (worker != null) worker.Dispose(); // The replacement host may now take the desktop mutex.
            if (reopen)
            {
                string exe = Path.Combine(job.appDir, "MStudio.exe");
                string argument = args.Length == 2 ? Quote(args[1]) : job.projectId ?? "";
                try { Process.Start(new ProcessStartInfo(exe, argument) {WorkingDirectory=job.appDir, UseShellExecute=true}); }
                catch (Exception e) { MessageBox.Show(e.Message, "MStudio", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            }
        }
    }
}
