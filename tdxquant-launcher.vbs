' TdxQuant 静默后台启动器 (VBScript)
' 双击本文件可在后台启动 TdxQuant 服务,不弹 cmd 黑窗
' 启动后弹提示框,5 秒后自动打开浏览器
'
' R18-B: 设置 PYTHONUTF8=1 / PYTHONIOENCODING=utf-8 解决 Windows 默认 GBK 中文乱码

Option Explicit

On Error Resume Next

Dim objShell, objEnv, scriptDir, cmdLine, exitCode

' ---------- 定位脚本所在目录(项目根) ----------
Set objShell = WScript.CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

' ---------- 设置 UTF-8 环境变量 (影响子进程 python/uvicorn) ----------
Set objEnv = objShell.Environment("Process")
objEnv.Item("PYTHONUTF8") = "1"
objEnv.Item("PYTHONIOENCODING") = "utf-8"

' ---------- 拼接命令: python scripts\dev.py start ----------
cmdLine = "python scripts\dev.py start"

' 切到项目根,避免从其他目录启动失败
objShell.CurrentDirectory = scriptDir

' ---------- 后台启动 (窗口模式 0 = 隐藏) ----------
' Run 返回进程退出码;但因为 start 会派生子进程并立即返回,这里仅用于触发
exitCode = objShell.Run(cmdLine, 0, False)

If Err.Number <> 0 Then
    MsgBox "启动失败:" & vbCrLf & Err.Description & vbCrLf & vbCrLf & _
           "请确认 python 已加入 PATH,且项目目录可访问:" & vbCrLf & scriptDir, _
           vbCritical, "TdxQuant 启动器"
    WScript.Quit 1
End If

' ---------- 弹出提示 ----------
MsgBox "TdxQuant 已后台启动,5 秒后打开浏览器" & vbCrLf & vbCrLf & _
       "前端大屏: http://127.0.0.1:3000" & vbCrLf & _
       "API 健康检查: http://127.0.0.1:8000/health" & vbCrLf & _
       "QuestDB 控制台: http://127.0.0.1:9000 (如已启动)" & vbCrLf & vbCrLf & _
       "停止服务: 双击 stop.bat", _
       vbInformation, "TdxQuant 启动器"

' ---------- 等待 5 秒 ----------
WScript.Sleep 5000

' ---------- 打开浏览器 ----------
On Error Resume Next
objShell.Run "http://127.0.0.1:3000"
If Err.Number <> 0 Then
    ' 浏览器打开失败,不中断,提示用户手动访问
    MsgBox "浏览器未自动打开,请手动访问: http://127.0.0.1:3000", _
           vbExclamation, "TdxQuant 启动器"
    Err.Clear
End If

Set objShell = Nothing
WScript.Quit 0
