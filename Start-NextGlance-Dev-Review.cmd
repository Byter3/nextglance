@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Reuse an installed runtime without pnpm, installation or global PATH changes.
set "NEXTGLANCE_NODE="
for %%N in (node.exe) do set "NEXTGLANCE_NODE=%%~$PATH:N"
if defined NEXTGLANCE_NODE goto runtime_found
set "NEXTGLANCE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NEXTGLANCE_NODE%" goto missing_runtime

:runtime_found
if not exist "%~dp0node_modules\vite\package.json" goto missing_dependencies
if not exist "%~dp0node_modules\@vitejs\plugin-vue\package.json" goto missing_dependencies
pushd "%~dp0"
if errorlevel 1 exit /b 1
echo Starting the NextGlance development review at http://127.0.0.1:5186/
echo Example data only. Keep this terminal open; press Ctrl+C to stop.
"%NEXTGLANCE_NODE%" "%~dp0scripts\dev-review.mjs"
set "NEXTGLANCE_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %NEXTGLANCE_EXIT_CODE%

:missing_runtime
echo ERROR: Node.js was not found on PATH or in the provisioned Codex runtime. 1>&2
echo Make Node.js available, then rerun this launcher. 1>&2
exit /b 1

:missing_dependencies
echo ERROR: Development review dependencies are missing from this project. 1>&2
echo Restore the workspace dependencies before retrying. This launcher does not install them. 1>&2
exit /b 1
