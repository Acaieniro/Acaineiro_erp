Set oShell = CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")
scriptDir = oFSO.GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = scriptDir
oShell.Run "node print-agent.js", 0, False
