// Windows renvoie les métadonnées de plusieurs centaines de médias par lecture de répertoire.
// FILE_ID_BOTH_DIR_INFO inclut ChangeTime et FileId, même si la taille et LastWriteTime sont conservés.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class LotMediaStamps {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass, IntPtr buffer, uint size);

    private static List<string> Enumerate(string dir, List<string> rows, IntPtr buffer) {
        var children = new List<string>();
        using (var handle = CreateFile(dir, 1, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), dir);
            while (GetFileInformationByHandleEx(handle, 10, buffer, 65536)) {
                IntPtr record = buffer;
                for (;;) {
                    string name = Marshal.PtrToStringUni(IntPtr.Add(record, 104), Marshal.ReadInt32(record, 60) / 2);
                    bool cache = name == ".cache" && String.Equals(Path.GetFileName(dir), "node_modules", StringComparison.OrdinalIgnoreCase);
                    if (name != "." && name != ".." && !cache) {
                        string path = Path.Combine(dir, name);
                        var flags = (FileAttributes)Marshal.ReadInt32(record, 56);
                        // Le client Node traverse lui-même les liens imbriqués via realpath, avec détection des cycles.
                        if ((flags & FileAttributes.ReparsePoint) != 0) throw new NotSupportedException("REPARSE");
                        else if ((flags & FileAttributes.Directory) != 0) children.Add(path);
                        else rows.Add(path + "\0" + Marshal.ReadInt64(record, 96) + ":" + Marshal.ReadInt64(record, 40)
                            + ":" + Marshal.ReadInt64(record, 24) + ":" + Marshal.ReadInt64(record, 32));
                    }
                    int next = Marshal.ReadInt32(record, 0);
                    if (next == 0) break;
                    record = IntPtr.Add(record, next);
                }
            }
            int error = Marshal.GetLastWin32Error();
            if (error != 18 && error != 38) throw new Win32Exception(error, dir);
        }
        return children;
    }
    private static void Walk(string dir, List<string> rows, IntPtr buffer) {
        foreach (var child in Enumerate(dir, rows, buffer)) Walk(child, rows, buffer);
    }

    public static string Fingerprint(string[] roots) {
        var rows = new List<string>();
        IntPtr buffer = Marshal.AllocHGlobal(65536);
        var children = new List<string>();
        try { foreach (string root in roots) children.AddRange(Enumerate(root, rows, buffer)); }
        finally { Marshal.FreeHGlobal(buffer); }
        Parallel.ForEach(children, new ParallelOptions { MaxDegreeOfParallelism = 3 }, dir => {
            var local = new List<string>();
            var block = Marshal.AllocHGlobal(65536);
            try { Walk(dir, local, block); }
            finally { Marshal.FreeHGlobal(block); }
            lock (rows) rows.AddRange(local);
        });
        rows.Sort(StringComparer.Ordinal);
        using (var sha = SHA256.Create()) {
            return rows.Count + ":" + Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(String.Join("\0", rows))));
        }
    }
    public static int Main(string[] roots) {
        try { Console.WriteLine(Fingerprint(roots)); return 0; }
        catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
    }
}
