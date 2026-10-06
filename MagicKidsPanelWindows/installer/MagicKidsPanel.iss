#define AppName "Magic Kids Panel"
#define AppVersion "1.0.0"
#define AppExeName "MagicKidsPanel.exe"

[Setup]
AppId={{A6D08A44-3E75-4F38-AF45-EA4F58B7B8A9}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\MagicKidsPanel
DefaultGroupName={#AppName}
OutputDir=..\dist-installer
OutputBaseFilename=MagicKidsPanelSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}

[Files]
Source: "..\publish\MagicKidsPanel.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Magic Kids Panel"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Magic Kids Panel"; Filename: "{app}\{#AppExeName}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Abrir Magic Kids Panel"; Flags: postinstall nowait skipifsilent
