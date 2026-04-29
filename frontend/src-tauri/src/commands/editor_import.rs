use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};

use crate::payloads::ProgressPayload;
use crate::state::EditorImportAbortState;
use crate::utils::logging::console_log;
use crate::utils::process::apply_no_window;

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorTarget {
    Premiere,
    AfterEffects,
    DavinciResolve,
}

fn normalize_editor_media_paths(media_paths: Vec<String>) -> Result<Vec<String>, String> {
    if media_paths.is_empty() {
        return Err("No exported media was provided for editor import.".to_string());
    }

    let normalized: Vec<String> = media_paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    if normalized.is_empty() {
        return Err("No valid exported media paths were provided.".to_string());
    }

    let missing: Vec<String> = normalized
        .iter()
        .filter(|p| !Path::new(p).exists())
        .take(5)
        .cloned()
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Some exported files are missing on disk: {}",
            missing.join(", ")
        ));
    }

    Ok(normalized)
}
#[tauri::command]
pub async fn import_media_to_editor(
    app: AppHandle,
    abort_state: State<'_, EditorImportAbortState>,
    editor_target: EditorTarget,
    media_paths: Vec<String>,
) -> Result<String, String> {
    abort_state.abort_requested.store(false, Ordering::SeqCst);
    let normalized = normalize_editor_media_paths(media_paths)?;

    match editor_target {
        EditorTarget::AfterEffects => {
            import_into_after_effects(&app, &normalized, &abort_state.abort_requested).await
        }
        EditorTarget::Premiere => {
            import_into_premiere(&app, &normalized, &abort_state.abort_requested).await
        }
        EditorTarget::DavinciResolve => {
            import_into_davinci_resolve(&app, &normalized, &abort_state.abort_requested).await
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn abort_editor_import(
    abort_state: State<'_, EditorImportAbortState>,
) -> Result<String, String> {
    abort_state.abort_requested.store(true, Ordering::SeqCst);
    Ok("Auto-import cancellation requested.".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn abort_editor_import(
    _abort_state: State<'_, EditorImportAbortState>,
) -> Result<String, String> {
    Ok("Auto-import cancellation requested.".to_string())
}

#[cfg(target_os = "windows")]
fn is_import_cancel_requested(abort_requested: &AtomicBool) -> bool {
    abort_requested.load(Ordering::SeqCst)
}

#[cfg(target_os = "windows")]
fn import_canceled_error() -> String {
    "AMVERGE_CANCELED: Auto-import canceled by user.".to_string()
}

#[cfg(target_os = "windows")]
async fn sleep_with_cancel(abort_requested: &AtomicBool, duration: Duration) -> Result<(), String> {
    let mut slept = Duration::ZERO;
    let tick = Duration::from_millis(100);
    while slept < duration {
        if is_import_cancel_requested(abort_requested) {
            return Err(import_canceled_error());
        }
        let wait = (duration - slept).min(tick);
        tokio::time::sleep(wait).await;
        slept += wait;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn run_windows_import_with_retries(
    app: Option<&AppHandle>,
    abort_requested: &AtomicBool,
    log_scope: &str,
    editor_name: &str,
    max_attempts: u32,
    launched_this_call: bool,
    process_name: Option<&str>,
    closed_early_error: &str,
    timeout_error: &str,
    mut run_once: impl FnMut() -> Result<String, String>,
) -> Result<String, String> {
    let mut last_err: Option<String> = None;

    for attempt in 0..max_attempts {
        if is_import_cancel_requested(abort_requested) {
            return Err(import_canceled_error());
        }

        emit_import_progress(
            app,
            99,
            &format!(
                "Waiting for {editor_name} to become ready (attempt {}/{max_attempts})",
                attempt + 1
            ),
        );

        if attempt > 0 {
            let delay_secs = if launched_this_call && attempt < 4 {
                3
            } else {
                2
            };
            sleep_with_cancel(abort_requested, Duration::from_secs(delay_secs)).await?;
        }

        if launched_this_call {
            if let Some(image_name) = process_name {
                if !is_windows_process_running(image_name) {
                    return Err(closed_early_error.to_string());
                }
            }
        }

        match run_once() {
            Ok(msg) => {
                emit_import_progress(app, 100, &msg);
                return Ok(msg);
            }
            Err(err) => {
                if is_import_cancel_requested(abort_requested) {
                    return Err(import_canceled_error());
                }
                let summarized = summarize_windows_import_error(&err);
                if max_attempts > 1 {
                    console_log(
                        log_scope,
                        &format!("attempt {}/{}: {}", attempt + 1, max_attempts, summarized),
                    );
                }
                emit_import_progress(
                    app,
                    99,
                    &format!(
                        "{} (attempt {}/{max_attempts})",
                        import_hint_for_error(editor_name, &err),
                        attempt + 1
                    ),
                );
                last_err = Some(summarized);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| timeout_error.to_string()))
}

#[cfg(target_os = "windows")]
fn emit_import_progress(app: Option<&AppHandle>, percent: u8, message: &str) {
    let Some(app) = app else {
        return;
    };

    let clean = message.replace('\n', " ").replace('\r', " ");
    let _ = app.emit(
        "scene_progress",
        ProgressPayload {
            percent: percent.min(100),
            message: clean,
        },
    );
}

#[cfg(target_os = "windows")]
fn summarize_windows_import_error(raw: &str) -> String {
    if raw.contains("AMVERGE_CANCELED") {
        return "AMVERGE_CANCELED: Auto-import canceled by user.".to_string();
    }
    if raw.contains("AMVERGE_NO_WINDOW") {
        return "AMVERGE_NO_WINDOW: Editor window not found yet.".to_string();
    }
    if raw.contains("AMVERGE_NO_PROJECT") {
        return "AMVERGE_NO_PROJECT: No project is open yet.".to_string();
    }
    if raw.contains("AMVERGE_FOCUS_FAILED") {
        return "AMVERGE_FOCUS_FAILED: Could not bring editor window to the foreground."
            .to_string();
    }
    if raw.contains("AMVERGE_WAITING") {
        return "AMVERGE_WAITING: Editor is still loading.".to_string();
    }

    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Unknown import error.".to_string())
}

#[cfg(target_os = "windows")]
fn import_hint_for_error(editor_name: &str, raw: &str) -> String {
    if raw.contains("AMVERGE_CANCELED") {
        return "Canceling auto-import...".to_string();
    }
    if raw.contains("AMVERGE_NO_WINDOW") {
        return format!("{editor_name} is still loading");
    }
    if raw.contains("AMVERGE_NO_PROJECT") {
        if editor_name == "After Effects" {
            return "Select an existing .aep project from the Home screen to continue auto-import"
                .to_string();
        }
        return format!("Open or create a project in {editor_name} to continue auto-import");
    }
    if raw.contains("AMVERGE_FOCUS_FAILED") {
        return format!("Click the {editor_name} window to bring it to front");
    }
    if raw.contains("AMVERGE_WAITING") {
        return format!("Waiting for {editor_name}");
    }

    format!("Waiting for {editor_name}")
}

#[cfg(target_os = "windows")]
fn spawn_editor_process(
    executable: &Path,
    editor_name: &str,
    log_scope: &str,
) -> Result<(), String> {
    console_log(
        log_scope,
        &format!("launching {editor_name}: {}", executable.display()),
    );

    let mut launch_cmd = Command::new(executable);
    apply_no_window(&mut launch_cmd);
    launch_cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    launch_cmd.spawn().map_err(|e| {
        format!(
            "Failed to launch {editor_name} ({}): {e}",
            executable.display()
        )
    })?;

    Ok(())
}

async fn import_into_after_effects(
    app: &AppHandle,
    media_paths: &[String],
    abort_requested: &AtomicBool,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = media_paths;
        let _ = abort_requested;
        return Err(
            "Auto-import for After Effects is currently implemented for Windows builds only."
                .to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        emit_import_progress(Some(app), 98, "Preparing After Effects auto-import...");

        // Use UI automation instead of AfterFX -r scripting because some AE
        // installations intermittently report "scripting plugin is not installed"
        // for command-line script execution.
        let script_path = write_temp_script(
            "amverge_afterfx_import_ui",
            "ps1",
            &build_after_effects_ui_import_ps(media_paths),
        )?;

        let afterfx_already_running = is_windows_process_running("AfterFX.exe");

        if !afterfx_already_running {
            emit_import_progress(Some(app), 98, "Launching After Effects...");
            let afterfx = resolve_afterfx_executable()
                .ok_or("After Effects executable was not found.".to_string())?;
            spawn_editor_process(&afterfx, "After Effects", "NLE|after_effects")?;
        }

        let max_attempts: u32 = 30;

        run_windows_import_with_retries(
            Some(app),
            abort_requested,
            "NLE|after_effects",
            "After Effects",
            max_attempts,
            !afterfx_already_running,
            Some("AfterFX.exe"),
            "After Effects was closed before the import could complete.",
            "After Effects did not become ready in time. Make sure a project is open, then retry.",
            || run_editor_ui_import_ps(&script_path, "After Effects"),
        )
        .await
    }
}

async fn import_into_premiere(
    app: &AppHandle,
    media_paths: &[String],
    abort_requested: &AtomicBool,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = media_paths;
        let _ = abort_requested;
        return Err(
            "Auto-import for Premiere Pro is currently implemented for Windows builds only."
                .to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        emit_import_progress(Some(app), 98, "Preparing Premiere Pro auto-import...");
        let script_path = write_temp_script(
            "amverge_premiere_import",
            "ps1",
            &build_premiere_ui_import_ps(media_paths),
        )?;

        let premiere_already_running = is_windows_process_running("Adobe Premiere Pro.exe");

        if !premiere_already_running {
            emit_import_progress(Some(app), 98, "Launching Premiere Pro...");
            let premiere = resolve_premiere_executable()
                .ok_or("Premiere Pro executable was not found.".to_string())?;
            spawn_editor_process(&premiere, "Premiere Pro", "NLE|premiere")?;
        }

        let max_attempts: u32 = 30;

        run_windows_import_with_retries(
            Some(app),
            abort_requested,
            "NLE|premiere",
            "Premiere Pro",
            max_attempts,
            !premiere_already_running,
            Some("Adobe Premiere Pro.exe"),
            "Premiere Pro was closed before the import could complete.",
            "Premiere Pro did not become ready in time. Make sure a project is open, then retry.",
            || run_editor_ui_import_ps(&script_path, "Premiere Pro"),
        )
        .await
    }
}

/// Execute the editor UI-import PowerShell script and return the result.
#[cfg(target_os = "windows")]
fn run_editor_ui_import_ps(script_path: &Path, editor_name: &str) -> Result<String, String> {
    let mut cmd = Command::new("powershell");
    apply_no_window(&mut cmd);
    let out = cmd
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-STA")
        .arg("-File")
        .arg(script_path)
        .output()
        .map_err(|e| format!("Failed to run {editor_name} importer script: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

    if out.status.success() {
        Ok(if stdout.is_empty() {
            format!("{editor_name} import complete.")
        } else {
            stdout
        })
    } else {
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "No error output.".to_string()
        };
        Err(detail)
    }
}

async fn import_into_davinci_resolve(
    app: &AppHandle,
    media_paths: &[String],
    abort_requested: &AtomicBool,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = abort_requested;
    }

    #[cfg(target_os = "windows")]
    emit_import_progress(Some(app), 98, "Preparing DaVinci Resolve auto-import...");

    let script_path = write_temp_script(
        "amverge_resolve_import",
        "py",
        &build_davinci_import_script(media_paths),
    )?;

    #[cfg(target_os = "windows")]
    {
        let resolve_running = is_windows_process_running("Resolve.exe");
        if !resolve_running {
            if let Some(resolve_exe) = resolve_davinci_executable() {
                emit_import_progress(Some(app), 98, "Launching DaVinci Resolve...");
                spawn_editor_process(&resolve_exe, "DaVinci Resolve", "NLE|davinci")?;
            } else {
                return Err("DaVinci Resolve executable was not found.".to_string());
            }
        }

        return run_windows_import_with_retries(
            Some(app),
            abort_requested,
            "NLE|davinci",
            "DaVinci Resolve",
            30,
            !resolve_running,
            Some("Resolve.exe"),
            "DaVinci Resolve was closed before the import could complete.",
            "DaVinci Resolve did not become ready for scripting in time.",
            || run_python_script(&script_path),
        )
        .await;
    }

    run_python_script(&script_path)
}

fn run_python_script(script_path: &Path) -> Result<String, String> {
    let mut launch_errors: Vec<String> = Vec::new();

    let candidates: Vec<(&str, Vec<&str>)> = if cfg!(target_os = "windows") {
        vec![("python", vec![]), ("py", vec!["-3"])]
    } else {
        vec![("python3", vec![]), ("python", vec![])]
    };

    for (exe, extra_args) in candidates {
        let mut cmd = Command::new(exe);
        apply_no_window(&mut cmd);
        cmd.args(extra_args)
            .arg(script_path)
            .env("PYTHONIOENCODING", "utf-8");

        #[cfg(target_os = "windows")]
        {
            if let Some(resolve_exe) = resolve_davinci_executable() {
                if let Some(resolve_dir) = resolve_exe.parent() {
                    let resolve_dir_str = resolve_dir.to_string_lossy().to_string();
                    let script_api_dir = PathBuf::from(
                        std::env::var("PROGRAMDATA")
                            .unwrap_or_else(|_| r"C:\ProgramData".to_string()),
                    )
                    .join("Blackmagic Design")
                    .join("DaVinci Resolve")
                    .join("Support")
                    .join("Developer")
                    .join("Scripting");
                    let modules_dir = script_api_dir.join("Modules");
                    let resolve_script_lib = resolve_dir.join("fusionscript.dll");

                    // Official Resolve scripting env.
                    cmd.env(
                        "RESOLVE_SCRIPT_API",
                        script_api_dir.to_string_lossy().to_string(),
                    );
                    cmd.env(
                        "RESOLVE_SCRIPT_LIB",
                        resolve_script_lib.to_string_lossy().to_string(),
                    );

                    // Ensure Python can import Resolve modules.
                    let mut pythonpath_parts: Vec<String> = Vec::new();
                    if let Ok(existing) = std::env::var("PYTHONPATH") {
                        if !existing.trim().is_empty() {
                            pythonpath_parts.push(existing);
                        }
                    }
                    pythonpath_parts.push(modules_dir.to_string_lossy().to_string());
                    cmd.env("PYTHONPATH", pythonpath_parts.join(";"));

                    // Ensure fusionscript.dll deps resolve.
                    let mut path_parts: Vec<String> = vec![resolve_dir_str];
                    if let Ok(existing_path) = std::env::var("PATH") {
                        if !existing_path.trim().is_empty() {
                            path_parts.push(existing_path);
                        }
                    }
                    cmd.env("PATH", path_parts.join(";"));
                }
            }
        }

        match cmd.output() {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

                if out.status.success() {
                    let msg = if stdout.is_empty() {
                        "DaVinci Resolve import command sent.".to_string()
                    } else {
                        stdout
                    };
                    return Ok(msg);
                }

                launch_errors.push(format!(
                    "{} exited with status {}{}{}",
                    exe,
                    out.status,
                    if stdout.is_empty() { "" } else { "\nstdout: " },
                    stdout
                ));
                if !stderr.is_empty() {
                    launch_errors.push(format!("stderr: {stderr}"));
                }
            }
            Err(e) => {
                launch_errors.push(format!("{exe} failed to start: {e}"));
            }
        }
    }

    Err(format!(
        "Failed to run DaVinci scripting bridge.\n{}",
        launch_errors.join("\n")
    ))
}

fn runtime_temp_path(prefix: &str, extension: &str) -> Result<PathBuf, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    let mut path = script_runtime_dir();
    fs::create_dir_all(&path).map_err(|e| {
        format!(
            "Failed to create script runtime directory ({}): {e}",
            path.display()
        )
    })?;

    path.push(format!(
        "{prefix}_{}_{}.{}",
        std::process::id(),
        ts,
        extension
    ));

    Ok(path)
}

fn write_temp_script(prefix: &str, extension: &str, content: &str) -> Result<PathBuf, String> {
    let path = runtime_temp_path(prefix, extension)?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write temp script {}: {e}", path.display()))?;
    Ok(path)
}

fn script_runtime_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data)
                .join("AMVerge")
                .join("runtime_scripts");
        }
    }

    std::env::temp_dir().join("amverge").join("runtime_scripts")
}

#[cfg(target_os = "windows")]
fn build_editor_ui_import_ps(
    media_paths: &[String],
    process_name: &str,
    editor_name: &str,
    no_window_error: &str,
    no_project_error: &str,
    window_title_match_expression: &str,
    project_ready_expression: &str,
    dialog_reject_expression: &str,
) -> String {
    let files = media_paths
        .iter()
        .map(|p| format!("'{}'", escape_ps_single_quoted(p)))
        .collect::<Vec<_>>()
        .join(",\n    ");

    let template = r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Focus {{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    public const int SW_RESTORE = 9;
}}
'@ -ErrorAction SilentlyContinue

$paths = @(
    __FILES__
)

function Get-EditorWindow([string]$processName) {{
    $procIds = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if (-not $procIds -or $procIds.Count -eq 0) {{
        return $null
    }}

    $script:windowMatches = New-Object 'System.Collections.Generic.List[object]'
    $callback = [Win32Focus+EnumWindowsProc] {{
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32Focus]::IsWindowVisible($hWnd)) {{
            return $true
        }}

        $len = [Win32Focus]::GetWindowTextLength($hWnd)
        if ($len -le 0) {{
            return $true
        }}

        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [void][Win32Focus]::GetWindowText($hWnd, $sb, $sb.Capacity)
        $title = $sb.ToString().Trim()
        if ([string]::IsNullOrWhiteSpace($title)) {{
            return $true
        }}

        $titleLower = $title.ToLowerInvariant()
        if (-not (__WINDOW_TITLE_MATCH_EXPRESSION__)) {{
            return $true
        }}

        $procId = [uint32]0
        [void][Win32Focus]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ($procIds -contains [int]$procId) {{
            $classSb = New-Object System.Text.StringBuilder 256
            [void][Win32Focus]::GetClassName($hWnd, $classSb, $classSb.Capacity)
            $className = $classSb.ToString()
            if ($className -eq '#32770') {{
                return $true
            }}

            $script:windowMatches.Add([pscustomobject]@{{
                Handle = $hWnd
                Title = $title
                ProcessId = [int]$procId
                ClassName = $className
            }}) | Out-Null
        }}

        return $true
    }}

    [void][Win32Focus]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:windowMatches.Count -eq 0) {{
        return $null
    }}

    $best = $script:windowMatches |
        Sort-Object -Property @{{
            Expression = {{
                $t = $_.Title.ToLowerInvariant()
                if (($t -match '\.aep') -and ($t -notmatch 'untitled|sans titre')) {{ 5 }}
                elseif ($t -match '\.prproj') {{ 5 }}
                elseif ($t -match 'home|accueil') {{ 0 }}
                elseif ($t -match 'untitled|sans titre') {{ 1 }}
                elseif ($t -match 'project|projet') {{ 2 }}
                else {{ 2 }}
            }}
        }}, @{{
            Expression = {{ $_.Title.Length }}
        }} -Descending |
        Select-Object -First 1

    return $best
}}

function Get-ProcessDialogWindow([int]$targetProcessId) {{
    $script:dialogMatches = New-Object 'System.Collections.Generic.List[object]'
    $callback = [Win32Focus+EnumWindowsProc] {{
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32Focus]::IsWindowVisible($hWnd)) {{
            return $true
        }}

        $procId = [uint32]0
        [void][Win32Focus]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ([int]$procId -ne $targetProcessId) {{
            return $true
        }}

        $classSb = New-Object System.Text.StringBuilder 256
        [void][Win32Focus]::GetClassName($hWnd, $classSb, $classSb.Capacity)
        $className = $classSb.ToString()
        if ($className -ne '#32770') {{
            return $true
        }}

        $len = [Win32Focus]::GetWindowTextLength($hWnd)
        $title = ''
        if ($len -gt 0) {{
            $sb = New-Object System.Text.StringBuilder ($len + 1)
            [void][Win32Focus]::GetWindowText($hWnd, $sb, $sb.Capacity)
            $title = $sb.ToString().Trim()
        }}

        $script:dialogMatches.Add([pscustomobject]@{{
            Handle = $hWnd
            Title = $title
            ProcessId = [int]$procId
            ClassName = $className
        }}) | Out-Null

        return $true
    }}

    [void][Win32Focus]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:dialogMatches.Count -eq 0) {{
        return $null
    }}

    return ($script:dialogMatches | Sort-Object -Property @{{
        Expression = {{ $_.Title.Length }}
    }} -Descending | Select-Object -First 1)
}}

function Test-IsForegroundProcess([int]$targetProcessId) {{
    $foreground = [Win32Focus]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) {{
        return $false
    }}

    $foregroundProcessId = [uint32]0
    [void][Win32Focus]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId)
    return ([int]$foregroundProcessId -eq $targetProcessId)
}}

function Set-EditorForeground([IntPtr]$hwnd, [int]$targetProcessId) {{
    if ([Win32Focus]::IsIconic($hwnd)) {{
        [Win32Focus]::ShowWindow($hwnd, [Win32Focus]::SW_RESTORE) | Out-Null
        Start-Sleep -Milliseconds 250
    }}

    [Win32Focus]::SetForegroundWindow($hwnd) | Out-Null
    [Win32Focus]::BringWindowToTop($hwnd) | Out-Null
    Start-Sleep -Milliseconds 250

    if (Test-IsForegroundProcess $targetProcessId) {{
        return $true
    }}

    try {{
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.AppActivate($targetProcessId)
    }} catch {{
    }}
    Start-Sleep -Milliseconds 250

    if (Test-IsForegroundProcess $targetProcessId) {{
        return $true
    }}

    $foreground = [Win32Focus]::GetForegroundWindow()
    $scratch = [uint32]0
    $foregroundThread = [Win32Focus]::GetWindowThreadProcessId($foreground, [ref]$scratch)
    $appThread = [Win32Focus]::GetWindowThreadProcessId($hwnd, [ref]$scratch)

    if ($foregroundThread -ne $appThread) {{
        [Win32Focus]::AttachThreadInput($foregroundThread, $appThread, $true) | Out-Null
        [Win32Focus]::SetForegroundWindow($hwnd) | Out-Null
        [Win32Focus]::BringWindowToTop($hwnd) | Out-Null
        [Win32Focus]::AttachThreadInput($foregroundThread, $appThread, $false) | Out-Null
        Start-Sleep -Milliseconds 250
    }}

    return (Test-IsForegroundProcess $targetProcessId)
}}

$window = Get-EditorWindow '__PROCESS_NAME__'
if (-not $window) {{
    throw '__NO_WINDOW_ERROR__'
}}

$title = [string]$window.Title
$titleLower = $title.ToLowerInvariant()
$projectReady = __PROJECT_READY_EXPRESSION__
if (-not $projectReady) {{
    throw ('__NO_PROJECT_ERROR__ (window title: ' + $title + ')')
}}

if (-not (Set-EditorForeground $window.Handle $window.ProcessId)) {{
    throw 'AMVERGE_FOCUS_FAILED: Could not bring __EDITOR_NAME__ to foreground.'
}}

# --- Import each file via Ctrl+I shortcut ---
foreach ($p in $paths) {{
    if (-not (Test-Path -LiteralPath $p)) {{
        throw ('File not found: ' + $p)
    }}

    if (-not (Set-EditorForeground $window.Handle $window.ProcessId)) {{
        throw 'AMVERGE_FOCUS_FAILED: Could not keep __EDITOR_NAME__ in foreground.'
    }}

    # Open Import dialog
    [System.Windows.Forms.SendKeys]::SendWait('^i')
    Start-Sleep -Milliseconds 200

    $dialog = $null
    for ($i = 0; $i -lt 18; $i++) {{
        $dialog = Get-ProcessDialogWindow $window.ProcessId
        if ($dialog) {{
            break
        }}
        Start-Sleep -Milliseconds 120
    }}

    if (-not $dialog) {{
        throw '__NO_PROJECT_ERROR__'
    }}

    $dialogTitleLower = [string]$dialog.Title
    $dialogTitleLower = $dialogTitleLower.ToLowerInvariant()
    if (__DIALOG_REJECT_EXPRESSION__) {{
        throw ('__NO_PROJECT_ERROR__ (dialog title: ' + $dialog.Title + ')')
    }}

    [Win32Focus]::SetForegroundWindow($dialog.Handle) | Out-Null
    Start-Sleep -Milliseconds 120

    # Paste the full file path into the filename field
    [System.Windows.Forms.Clipboard]::SetText($p)
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 220

    # Confirm
    [System.Windows.Forms.SendKeys]::SendWait('~')
    Start-Sleep -Milliseconds 250

    for ($i = 0; $i -lt 30; $i++) {{
        $stillOpen = Get-ProcessDialogWindow $window.ProcessId
        if (-not $stillOpen) {{
            break
        }}
        Start-Sleep -Milliseconds 120
    }}

    if ($stillOpen) {{
        throw 'AMVERGE_WAITING: Import dialog did not close after confirming file import.'
    }}

    Start-Sleep -Milliseconds 350
}}

Write-Output '__EDITOR_NAME__ import complete.'
"#;

    let normalized_template = template.replace("{{", "{").replace("}}", "}");

    normalized_template
        .replace("__FILES__", &files)
        .replace("__PROCESS_NAME__", process_name)
        .replace("__EDITOR_NAME__", editor_name)
        .replace("__NO_WINDOW_ERROR__", no_window_error)
        .replace("__NO_PROJECT_ERROR__", no_project_error)
        .replace(
            "__WINDOW_TITLE_MATCH_EXPRESSION__",
            window_title_match_expression,
        )
        .replace("__PROJECT_READY_EXPRESSION__", project_ready_expression)
        .replace("__DIALOG_REJECT_EXPRESSION__", dialog_reject_expression)
}

#[cfg(target_os = "windows")]
fn build_after_effects_ui_import_ps(media_paths: &[String]) -> String {
    let project_ready_expr = "($titleLower -match '\\.aep') -and ($titleLower -notmatch 'untitled|sans titre') -and ($titleLower -notmatch 'home|accueil')";
    let window_title_match_expr = "($titleLower -match 'after effects')";
    let dialog_reject_expr =
        "($dialogTitleLower -match 'project|projet') -and ($dialogTitleLower -notmatch 'import|importer')";

    build_editor_ui_import_ps(
        media_paths,
        "AfterFX",
        "After Effects",
        "AMVERGE_NO_WINDOW: After Effects window not found. After Effects may still be loading.",
        "AMVERGE_NO_PROJECT: No opened .aep project yet. Select a project from the Home screen.",
        window_title_match_expr,
        project_ready_expr,
        dialog_reject_expr,
    )
}

#[cfg(target_os = "windows")]
fn build_premiere_ui_import_ps(media_paths: &[String]) -> String {
    let project_ready_expr = "($titleLower -match '\\.prproj') -or (($titleLower -match 'premiere') -and ($title -match '\\s[-–—]\\s') -and ($titleLower -notmatch 'home|accueil|learn|importer|import'))";
    let window_title_match_expr = "($titleLower -match 'premiere')";
    let dialog_reject_expr = "$false";

    build_editor_ui_import_ps(
        media_paths,
        "Adobe Premiere Pro",
        "Premiere Pro",
        "AMVERGE_NO_WINDOW: Adobe Premiere Pro window not found. Premiere may still be loading.",
        "AMVERGE_NO_PROJECT: No Premiere project is open yet.",
        window_title_match_expr,
        project_ready_expr,
        dialog_reject_expr,
    )
}

fn build_davinci_import_script(media_paths: &[String]) -> String {
    let files = media_paths
        .iter()
        .map(|p| format!("r'{}'", escape_py_single_quoted(p)))
        .collect::<Vec<_>>()
        .join(",\n    ");

    [
        "import os".to_string(),
        "import sys".to_string(),
        "".to_string(),
        "MEDIA_FILES = [".to_string(),
        format!("    {files}"),
        "]".to_string(),
        "".to_string(),
        "def ensure_resolve_module():".to_string(),
        "    try:".to_string(),
        "        import DaVinciResolveScript as dvr_script".to_string(),
        "        return dvr_script".to_string(),
        "    except Exception:".to_string(),
        "        pass".to_string(),
        "".to_string(),
        "    candidates = []".to_string(),
        "    if os.name == 'nt':".to_string(),
        "        program_data = os.environ.get('PROGRAMDATA', r'C:\\\\ProgramData')".to_string(),
        "        candidates.append(os.path.join(program_data, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting', 'Modules'))".to_string(),
        "    elif sys.platform == 'darwin':".to_string(),
        "        candidates.append('/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules')".to_string(),
        "    else:".to_string(),
        "        candidates.append('/opt/resolve/Developer/Scripting/Modules')".to_string(),
        "".to_string(),
        "    for path in candidates:".to_string(),
        "        if os.path.isdir(path) and path not in sys.path:".to_string(),
        "            sys.path.append(path)".to_string(),
        "".to_string(),
        "    import DaVinciResolveScript as dvr_script".to_string(),
        "    return dvr_script".to_string(),
        "".to_string(),
        "dvr_script = ensure_resolve_module()".to_string(),
        "resolve = dvr_script.scriptapp('Resolve')".to_string(),
        "if not resolve:".to_string(),
        "    raise RuntimeError('Could not connect to DaVinci Resolve. Open Resolve and enable external scripting.')"
            .to_string(),
        "".to_string(),
        "pm = resolve.GetProjectManager()".to_string(),
        "project = pm.GetCurrentProject() if pm else None".to_string(),
        "if not project:".to_string(),
        "    project = pm.CreateProject('AMVerge Auto Import') if pm else None".to_string(),
        "if not project:".to_string(),
        "    raise RuntimeError('No Resolve project is currently open, and AMVerge could not create one automatically.')"
            .to_string(),
        "".to_string(),
        "media_pool = project.GetMediaPool()".to_string(),
        "if not media_pool:".to_string(),
        "    raise RuntimeError('Could not access Resolve media pool.')".to_string(),
        "".to_string(),
        "normalized = []".to_string(),
        "for p in MEDIA_FILES:".to_string(),
        "    ap = os.path.abspath(p)".to_string(),
        "    normalized.append(ap.replace('\\\\\\\\', '/'))".to_string(),
        "".to_string(),
        "missing = [p for p in normalized if not os.path.exists(p)]".to_string(),
        "if missing:".to_string(),
        "    raise RuntimeError('Resolve import paths not found: ' + '; '.join(missing))".to_string(),
        "".to_string(),
        "result = media_pool.ImportMedia(normalized)".to_string(),
        "if not result:".to_string(),
        "    clip_infos = [{'FilePath': p} for p in normalized]".to_string(),
        "    result = media_pool.ImportMedia(clip_infos)".to_string(),
        "".to_string(),
        "if not result:".to_string(),
        "    imported_any = False".to_string(),
        "    failed = []".to_string(),
        "    for p in normalized:".to_string(),
        "        r = media_pool.ImportMedia([p])".to_string(),
        "        if r:".to_string(),
        "            imported_any = True".to_string(),
        "        else:".to_string(),
        "            failed.append(p)".to_string(),
        "    if not imported_any:".to_string(),
        "        raise RuntimeError('Resolve failed to import media into current project. Failed paths: ' + '; '.join(failed))"
            .to_string(),
        "".to_string(),
        "print('DaVinci Resolve import complete.')".to_string(),
    ]
    .join("\n")
}

fn escape_py_single_quoted(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('\'', "\\'")
}

#[cfg(target_os = "windows")]
fn is_windows_process_running(image_name: &str) -> bool {
    let mut cmd = Command::new("tasklist");
    apply_no_window(&mut cmd);

    let output = cmd
        .arg("/FI")
        .arg(format!("IMAGENAME eq {image_name}"))
        .arg("/FO")
        .arg("CSV")
        .arg("/NH")
        .output();

    let Ok(out) = output else {
        return false;
    };

    if !out.status.success() {
        return false;
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let image_name_lower = image_name.to_ascii_lowercase();

    stdout.lines().any(|line| {
        line.trim()
            .to_ascii_lowercase()
            .starts_with(&format!("\"{image_name_lower}\""))
    })
}

#[cfg(target_os = "windows")]
fn escape_ps_single_quoted(raw: &str) -> String {
    raw.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn resolve_afterfx_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_AFTERFX_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    find_latest_adobe_executable(
        "Adobe After Effects",
        Path::new("Support Files").join("AfterFX.exe"),
    )
}

#[cfg(target_os = "windows")]
fn resolve_premiere_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_PREMIERE_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    find_latest_adobe_executable(
        "Adobe Premiere Pro",
        PathBuf::from("Adobe Premiere Pro.exe"),
    )
}

#[cfg(target_os = "windows")]
fn resolve_davinci_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_RESOLVE_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    let candidates = [
        r"C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe",
        r"C:\Program Files\blackmagic design\DaVinci Resolve\Resolve.exe",
    ];
    candidates.iter().map(PathBuf::from).find(|p| p.exists())
}

#[cfg(target_os = "windows")]
fn find_latest_adobe_executable(
    prefix: &str,
    executable_relative_path: PathBuf,
) -> Option<PathBuf> {
    let bases = [
        PathBuf::from(r"C:\Program Files\Adobe"),
        PathBuf::from(r"C:\Program Files (x86)\Adobe"),
    ];

    for base in bases {
        let Ok(entries) = fs::read_dir(&base) else {
            continue;
        };

        let mut candidates: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .filter(|path| {
                path.file_name()
                    .and_then(|n| n.to_str())
                    .map(|name| name.starts_with(prefix))
                    .unwrap_or(false)
            })
            .collect();

        candidates.sort_by(|a, b| {
            let an = a.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            let bn = b.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            an.cmp(bn)
        });

        for dir in candidates.into_iter().rev() {
            let exe = dir.join(&executable_relative_path);
            if exe.exists() {
                return Some(exe);
            }
        }
    }

    None
}
