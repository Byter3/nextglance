@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Use an existing Node runtime without requiring pnpm or changing global PATH.
set "NEXTGLANCE_NODE="
for %%N in (node.exe) do set "NEXTGLANCE_NODE=%%~$PATH:N"
if defined NEXTGLANCE_NODE goto runtime_found
set "NEXTGLANCE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NEXTGLANCE_NODE%" goto missing_runtime

:runtime_found
set "NEXTGLANCE_VITE=%~dp0android\node_modules\vite\bin\vite.js"
if not exist "%NEXTGLANCE_VITE%" goto missing_dependencies
pushd "%~dp0android"
if errorlevel 1 exit /b 1
echo Starting NextGlance Android browser preview at http://127.0.0.1:5174
echo Keep this terminal open. Press Ctrl+C to stop the preview.
"%NEXTGLANCE_NODE%" "%NEXTGLANCE_VITE%" --host 127.0.0.1 --port 5174 --strictPort
set "NEXTGLANCE_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %NEXTGLANCE_EXIT_CODE%

:missing_runtime
echo ERROR: Node.js was not found on PATH or in the provisioned Codex runtime. 1>&2
echo Make Node.js available, then rerun this launcher. 1>&2
exit /b 1

:missing_dependencies
echo ERROR: Android preview dependencies are missing: 1>&2
echo "%NEXTGLANCE_VITE%" 1>&2
echo Restore the workspace dependencies before retrying. This launcher does not install them. 1>&2
exit /b 1
