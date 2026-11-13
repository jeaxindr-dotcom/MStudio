using System;
using System.IO;

// Compiled with the production desktop sources. No form, hub, or installed app
// is created: this fixture exercises the native request contract directly.
static class MStudioLauncherArguments
{
    static int checks;
    static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
        checks++;
    }
    static void Reject<T>(string[] args) where T : Exception
    {
        try { DesktopOpenRequest.Parse(args); }
        catch (T) { checks++; return; }
        throw new Exception("The native launcher accepted invalid arguments.");
    }
    public static void Main(string[] args)
    {
        string root = Path.GetFullPath(args[0]);
        string project = Path.Combine(root, "Scène 日本 & test.coulisses");
        File.WriteAllText(project, "{}");
        string review = Path.Combine(root, "revue avec espaces");
        Directory.CreateDirectory(review);

        var current = DesktopOpenRequest.Parse(new string[0]);
        Check(current.ActivateExisting && current.Route == "", "No arguments must activate the current window.");
        Check(current.Arguments.Length == 0, "A plain launch remains argument-free when forwarded.");
        var home = DesktopOpenRequest.Parse(new[] { "--home" });
        Check(!home.ActivateExisting && home.Route == "", "--home must request a new library window.");
        Check(home.Arguments.Length == 1 && home.Arguments[0] == "--home", "Explicit home must survive forwarding.");
        Check(!DesktopOpenRequest.Parse(new[] { "--HOME" }).ActivateExisting, "Windows option casing.");
        Check(DesktopOpenRequest.Parse(new[] { "e19" }).Route == "go/E19", "Episode ID normalization.");
        Check(DesktopOpenRequest.Parse(new[] { "pABCDEF12" }).Route == "go/Pabcdef12", "Project ID normalization.");
        Check(DesktopOpenRequest.Parse(new[] { project }).Route == "import?path=" + Uri.EscapeDataString(project), "Absolute path must be safely encoded.");
        Check(DesktopOpenRequest.Parse(new[] { Path.GetFileName(project) }).Route == "import?path=" + Uri.EscapeDataString(project), "Relative file must resolve in the calling working directory.");
        Check(DesktopOpenRequest.Parse(new[] { Path.GetFileName(project) }).Arguments[0] == project, "Forward a relative request as an absolute path to another process.");
        Check(DesktopOpenRequest.Parse(new[] { review }).Route == "import?path=" + Uri.EscapeDataString(review), "Review directory must be accepted.");
        Reject<ArgumentException>(new[] { "--unknown" });
        Reject<ArgumentException>(new[] { "--home", project });
        Reject<ArgumentException>(new[] { project, review });
        Reject<ArgumentException>(new[] { "   " });
        Reject<ArgumentException>(new[] { "a\nb" });
        Reject<ArgumentException>(new string[] { null });
        Reject<FileNotFoundException>(new[] { Path.Combine(root, "missing.coulisses") });
        Reject<FileNotFoundException>(new[] { "P123" });
        Reject<FileNotFoundException>(new[] { "Eabcdef12" });
        Reject<FileNotFoundException>(new[] { "https://example.com/" });
        Console.WriteLine(checks + " ok, 0 ko");
    }
}
