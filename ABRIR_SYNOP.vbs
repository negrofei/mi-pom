' ABRIR_SYNOP.vbs - Visor SYNOP/METAR Argentina
' Abre el navegador y ejecuta el servidor Flask en segundo plano

Option Explicit

Dim WshShell, fso, scriptPath, appPath, venvPython, batPath

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Obtener la ruta donde está este script
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)
appPath = scriptPath
venvPython = appPath & "\venv\Scripts\python.exe"

' Verificar que existe el entorno virtual
If Not fso.FileExists(venvPython) Then
    MsgBox "Error: Entorno virtual no encontrado." & vbCrLf & vbCrLf & _
           "Ejecutar INSTALAR_WINDOWS.bat primero.", vbCritical, "Visor SYNOP/METAR"
    WScript.Quit 1
End If

' Crear un BAT temporal para ejecutar el servidor
batPath = appPath & "\run_server_temp.bat"
Dim batFile
Set batFile = fso.CreateTextFile(batPath, True)
batFile.WriteLine "@echo off"
batFile.WriteLine "cd /d """ & appPath & """"
batFile.WriteLine "call venv\Scripts\activate.bat"
batFile.WriteLine "python app.py"
batFile.Close

' Ejecutar el servidor en segundo plano (ventana minimizada)
WshShell.Run """" & batPath & """", 7, False

' Esperar a que el servidor arranque
WScript.Sleep 2500

' Abrir el navegador
WshShell.Run "http://localhost:8080/synop", 1, False

Set WshShell = Nothing
Set fso = Nothing
