using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
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
    public string ticket { get; set; }
    public string status { get; set; }
    public int hubPid { get; set; }

    public string Text(string fr, string en) { return language == "en" ? en : fr; }
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

    static bool SamePath(string a, string b)
    {
        return String.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    public static void Validate(UpdateRequest job, string requestPath, string standardInstall)
    {
        Guid ticket;
        if (!Guid.TryParseExact(job.ticket, "D", out ticket) || job.hubPid <= 0 ||
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
        if (previous.ticket != job.ticket || previous.status != "installing") throw new InvalidOperationException("Update request replaced.");
        string temp = state + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, Json.Serialize(new {status, errorCode=code, error, ticket=job.ticket, version=job.version, pid=Process.GetCurrentProcess().Id}), new UTF8Encoding(false));
            File.Replace(temp, state, null);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    static bool DesktopOpen()
    {
        Mutex app;
        if (!Mutex.TryOpenExisting(@"Local\MStudio.Desktop.Running", out app)) return false;
        app.Dispose();
        return true;
    }

    static void WaitForDesktop(UpdateRequest job)
    {
        // Keep the original PID's process handle; never signal or kill a process.
        Process hub = null;
        try
        {
            try { hub = Process.GetProcessById(job.hubPid); var handle = hub.Handle; }
            catch (ArgumentException) { } // Already closed.
            catch (InvalidOperationException) { if (hub != null) hub.Dispose(); hub = null; }
            while (DesktopOpen()) Thread.Sleep(700);
            if (hub != null && !hub.WaitForExit(15000))
                throw new IOException(job.Text("La bibliothèque MStudio est encore ouverte. Ferme-la avant de réessayer.",
                    "The MStudio library is still open. Close it before retrying."));
        }
        finally { if (hub != null) hub.Dispose(); }
    }

    static int RunSetup(string path, string args)
    {
        // ShellExecute lets Windows apply its usual downloaded-file, signature
        // and application-control checks. Inno runs with its per-user manifest.
        using (var setup = Process.Start(new ProcessStartInfo(path, args) {UseShellExecute=true, WorkingDirectory=Path.GetDirectoryName(path)}))
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
        UpdateRequest job = null;
        bool accepted = false, reopen = false;
        try
        {
            if (args.Length != 1) return 2;
            job = Json.Deserialize<UpdateRequest>(File.ReadAllText(args[0]));
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Validate(job, args[0], Path.Combine(local, "Programs", "MStudio"));
            Receipt(job, "installing", null, null);
            accepted = true;
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
                try { Receipt(job, "error", "update-install", detail); } catch (IOException) { }
                if (reopen) MessageBox.Show(detail, "MStudio", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return 1;
        }
        finally
        {
            if (reopen)
            {
                string exe = Path.Combine(job.appDir, "MStudio.exe");
                try { Process.Start(new ProcessStartInfo(exe, job.projectId ?? "") {WorkingDirectory=job.appDir, UseShellExecute=true}); }
                catch (Exception e) { MessageBox.Show(e.Message, "MStudio", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            }
        }
    }
}
