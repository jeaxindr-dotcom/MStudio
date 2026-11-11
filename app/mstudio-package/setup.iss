[Setup]
AppId={{5A077282-812B-4565-8022-75188B5E2D38}
AppName=MStudio
AppVersion={#ProductVersion}
AppPublisher=MStudio
VersionInfoVersion={#ProductVersion}.0
VersionInfoDescription=Installation de MStudio
VersionInfoProductName=MStudio
DefaultDirName={localappdata}\Programs\MStudio
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DefaultGroupName=MStudio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern
SetupIconFile={#SourceRoot}\app\mstudio.ico
UninstallDisplayIcon={app}\MStudio.exe
OutputDir={#ReleaseDir}
OutputBaseFilename=MStudio-Setup-{#ProductVersion}-win-x64
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=yes
AppMutex=Local\MStudio.Desktop.Running
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
french.LaunchMStudio=Ouvrir MStudio
english.LaunchMStudio=Open MStudio
french.RuntimeError=Le moteur Microsoft WebView2 n’a pas pu être installé. Code Windows %1.
english.RuntimeError=Microsoft WebView2 could not be installed. Windows error %1.
french.DestinationError=Le dossier d’installation doit être celui de MStudio dans les programmes de cet utilisateur.
english.DestinationError=MStudio must be installed in this user’s MStudio program directory.

[Files]
Source: "{#WebViewInstaller}"; Flags: dontcopy nocompression
Source: "{#SourceRoot}\*"; Excludes: "\runtime\node.exe"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs solidbreak
Source: "{#SourceRoot}\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion; Check: NeedNodeRuntime

[Icons]
Name: "{userprograms}\MStudio"; Filename: "{app}\MStudio.exe"; WorkingDir: "{app}"; AppUserModelID: "MStudio.Desktop"
Name: "{userdesktop}\MStudio"; Filename: "{app}\MStudio.exe"; WorkingDir: "{app}"; AppUserModelID: "MStudio.Desktop"

[Run]
Filename: "{app}\MStudio.exe"; WorkingDir: "{app}"; Description: "{cm:LaunchMStudio}"; Flags: postinstall nowait skipifsilent

[Code]
// A separate studio-cli wait session may still use this executable. Keep its
// file mapping when this release packages the exact same runtime.
function NeedNodeRuntime(): Boolean;
var
  Target: String;
begin
  Target := ExpandConstant('{app}\runtime\node.exe');
  Result := True;
  if FileExists(Target) then
    Result := CompareText(GetSHA256OfFile(Target), '{#BundledNodeSha256}') <> 0;
end;

function WebViewInstalledAt(Root: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root,
    'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Installer: String;
  Code: Integer;
begin
  Result := '';
  if CompareText(ExpandFileName(ExpandConstant('{app}')), ExpandFileName(ExpandConstant('{localappdata}\Programs\MStudio'))) <> 0 then
  begin
    Result := CustomMessage('DestinationError');
    Exit;
  end;
  if WebViewInstalledAt(HKLM32) or WebViewInstalledAt(HKCU) then Exit;
  ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  Installer := ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if not Exec(Installer, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    Result := FmtMessage(CustomMessage('RuntimeError'), [IntToStr(Code)]);
end;
