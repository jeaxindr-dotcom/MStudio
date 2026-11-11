using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;

// Test-only worker. It takes the same handoff as the shipped helper and never
// starts Setup or opens a desktop app.
static class HandoffFixture
{
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
        job.projectId = project;

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
    }
}
