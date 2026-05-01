use super::*;

pub(super) async fn import_into_capcut(
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
            "CapCut workflow integration is currently implemented for Windows builds only."
                .to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        emit_import_progress(Some(app), 98, "Preparing CapCut media import...");
        let mut capcut_media_paths: Vec<String> = Vec::new();
        let mut skipped_paths: Vec<String> = Vec::new();
        for raw_path in media_paths {
            let normalized = normalize_windows_editor_import_path(raw_path);
            if normalized.is_empty() {
                continue;
            }
            if is_capcut_media_extension_supported(&normalized) {
                capcut_media_paths.push(normalized);
            } else {
                skipped_paths.push(normalized);
            }
        }

        if capcut_media_paths.is_empty() {
            let detail = if skipped_paths.is_empty() {
                "No files were provided.".to_string()
            } else {
                format!("Unsupported paths: {}", skipped_paths.join(", "))
            };
            return Err(format!(
                "CapCut import expects media files only (MP4/MOV/JPG/PNG/MP3). {detail}"
            ));
        }

        if !skipped_paths.is_empty() {
            console_log(
                "NLE|capcut",
                &format!(
                    "skipping unsupported CapCut imports (non-media): {}",
                    skipped_paths.join(" | ")
                ),
            );
        }

        let script_path = write_temp_script(
            "amverge_capcut_import",
            "ps1",
            &build_capcut_ui_import_ps(&capcut_media_paths),
        )?;

        let capcut_running = is_capcut_app_process_running();
        if !capcut_running {
            let capcut_exe = resolve_capcut_executable()
                .ok_or("CapCut executable was not found.".to_string())?;
            emit_import_progress(Some(app), 98, "Launching CapCut...");
            spawn_editor_process(&capcut_exe, "CapCut", "NLE|capcut")?;
        }

        let import_result = run_windows_import_with_retries(
            Some(app),
            abort_requested,
            "NLE|capcut",
            "CapCut",
            30,
            !capcut_running,
            None,
            "CapCut was closed before the import could complete.",
            "CapCut did not become ready in time. Open a project in CapCut and retry.",
            || run_editor_ui_import_ps(&script_path, "CapCut"),
        )
        .await;

        import_result
    }
}

pub(super) fn build_capcut_ui_import_ps(media_paths: &[String]) -> String {
    let files = media_paths
        .iter()
        .map(|p| normalize_windows_editor_import_path(p))
        .map(|p| format!("'{}'", escape_ps_single_quoted(&p)))
        .collect::<Vec<_>>()
        .join(",\n    ");

    let template = r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win32CapCut {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public const int SW_RESTORE = 9;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
'@ -ErrorAction SilentlyContinue

$paths = @(
    __FILES__
)

function Get-CapCutProcesses {
    return @(Get-Process -Name 'CapCut*' -ErrorAction SilentlyContinue | Where-Object {
        ($_.ProcessName -like 'CapCut*') -and ($_.ProcessName -notmatch 'Service|Update|Crash|Helper')
    })
}

function Get-CapCutWindow {
    $procs = Get-CapCutProcesses
    $procIds = @($procs | Select-Object -ExpandProperty Id)
    if (-not $procIds -or $procIds.Count -eq 0) {
        return $null
    }

    $script:capCutProcessById = @{}
    foreach ($proc in $procs) {
        $script:capCutProcessById[[int]$proc.Id] = [string]$proc.ProcessName
    }

    $script:windowMatches = New-Object 'System.Collections.Generic.List[object]'
    $callback = [Win32CapCut+EnumWindowsProc] {
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32CapCut]::IsWindowVisible($hWnd)) {
            return $true
        }

        $procId = [uint32]0
        [void][Win32CapCut]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ($procIds -notcontains [int]$procId) {
            return $true
        }

        $classSb = New-Object System.Text.StringBuilder 256
        [void][Win32CapCut]::GetClassName($hWnd, $classSb, $classSb.Capacity)
        $className = $classSb.ToString()
        if ($className -eq '#32770') {
            return $true
        }

        $len = [Win32CapCut]::GetWindowTextLength($hWnd)
        $title = ''
        if ($len -gt 0) {
            $sb = New-Object System.Text.StringBuilder ($len + 1)
            [void][Win32CapCut]::GetWindowText($hWnd, $sb, $sb.Capacity)
            $title = $sb.ToString().Trim()
        }

        $script:windowMatches.Add([pscustomobject]@{
            Handle = $hWnd
            Title = $title
            ProcessId = [int]$procId
            ProcessName = [string]$script:capCutProcessById[[int]$procId]
            ClassName = $className
        }) | Out-Null
        return $true
    }

    [void][Win32CapCut]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:windowMatches.Count -eq 0) {
        return $null
    }

    return ($script:windowMatches | Sort-Object -Property @{
        Expression = {
            $t = [string]$_.Title
            $lower = $t.ToLowerInvariant()
            $procName = ([string]$_.ProcessName).ToLowerInvariant()
            if (($procName -eq 'capcut') -and ($lower -match 'untitled|sans titre|project|projet|capcut')) { 6 }
            elseif ($lower -match 'untitled|sans titre|project|projet') { 5 }
            elseif ($lower -match 'capcut') { 4 }
            elseif ($procName -eq 'capcut') { 3 }
            elseif ($t.Length -gt 0) { 2 }
            else { 1 }
        }
    }, @{
        Expression = { $_.Title.Length }
    } -Descending | Select-Object -First 1)
}

function Get-ProcessDialogWindow([int]$targetProcessId) {
    $targetProcessIds = @(Get-CapCutProcesses | Select-Object -ExpandProperty Id)
    if (-not $targetProcessIds -or $targetProcessIds.Count -eq 0) {
        $targetProcessIds = @($targetProcessId)
    }

    $script:dialogMatches = New-Object 'System.Collections.Generic.List[object]'
    $callback = [Win32CapCut+EnumWindowsProc] {
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [Win32CapCut]::IsWindowVisible($hWnd)) {
            return $true
        }

        $procId = [uint32]0
        [void][Win32CapCut]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        if ($targetProcessIds -notcontains [int]$procId) {
            return $true
        }

        $classSb = New-Object System.Text.StringBuilder 256
        [void][Win32CapCut]::GetClassName($hWnd, $classSb, $classSb.Capacity)
        $className = $classSb.ToString()
        if ($className -ne '#32770') {
            return $true
        }

        $len = [Win32CapCut]::GetWindowTextLength($hWnd)
        $title = ''
        if ($len -gt 0) {
            $sb = New-Object System.Text.StringBuilder ($len + 1)
            [void][Win32CapCut]::GetWindowText($hWnd, $sb, $sb.Capacity)
            $title = $sb.ToString().Trim()
        }

        $script:dialogMatches.Add([pscustomobject]@{
            Handle = $hWnd
            Title = $title
            ProcessId = [int]$procId
            ClassName = $className
        }) | Out-Null
        return $true
    }

    [void][Win32CapCut]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:dialogMatches.Count -eq 0) {
        return $null
    }

    return ($script:dialogMatches | Sort-Object -Property @{
        Expression = { $_.Title.Length }
    } -Descending | Select-Object -First 1)
}

function Set-CapCutForeground($window) {
    if ([Win32CapCut]::IsIconic($window.Handle)) {
        [Win32CapCut]::ShowWindow($window.Handle, [Win32CapCut]::SW_RESTORE) | Out-Null
        Start-Sleep -Milliseconds 300
    }

    [Win32CapCut]::SetForegroundWindow($window.Handle) | Out-Null
    [Win32CapCut]::BringWindowToTop($window.Handle) | Out-Null
    Start-Sleep -Milliseconds 350
}

function Click-Point([int]$x, [int]$y) {
    [Win32CapCut]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 80
    [Win32CapCut]::mouse_event([Win32CapCut]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [Win32CapCut]::mouse_event([Win32CapCut]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Get-AutomationRoot($window) {
    return [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
}

function Find-ElementByRegex($root, [string[]]$patterns) {
    if (-not $root) {
        return $null
    }

    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )

    foreach ($element in $all) {
        try {
            $name = [string]$element.Current.Name
            $automationId = [string]$element.Current.AutomationId
            $controlType = [string]$element.Current.ControlType.ProgrammaticName
            $text = ($name + ' ' + $automationId + ' ' + $controlType).ToLowerInvariant()
            foreach ($pattern in $patterns) {
                if ($text -match $pattern) {
                    return $element
                }
            }
        } catch {
        }
    }

    return $null
}

function Invoke-AutomationElement($element) {
    if (-not $element) {
        return $false
    }

    try {
        $invoke = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        Start-Sleep -Milliseconds 600
        return $true
    } catch {
    }

    try {
        $element.SetFocus()
        $rect = $element.Current.BoundingRectangle
        if ($rect.Width -gt 1 -and $rect.Height -gt 1) {
            Click-Point ([int]($rect.Left + ($rect.Width / 2))) ([int]($rect.Top + ($rect.Height / 2)))
            Start-Sleep -Milliseconds 600
            return $true
        }
    } catch {
    }

    return $false
}

function Wait-CapCutImportDialog([int]$targetProcessId, [int]$attempts, [int]$delayMs) {
    for ($i = 0; $i -lt $attempts; $i++) {
        $dialog = Get-ProcessDialogWindow $targetProcessId
        if ($dialog) {
            return $dialog
        }
        Start-Sleep -Milliseconds $delayMs
    }

    return $null
}

function Click-CapCutImportFallback($window) {
    $rect = New-Object 'Win32CapCut+RECT'
    if ([Win32CapCut]::GetWindowRect($window.Handle, [ref]$rect)) {
        # CapCut's import button lives in the upper-left media panel in current desktop builds.
        Click-Point ($rect.Left + 130) ($rect.Top + 155)
        Start-Sleep -Milliseconds 700
        return $true
    }
    return $false
}

function Open-CapCutImportDialog($window) {
    Set-CapCutForeground $window
    $root = Get-AutomationRoot $window

    [System.Windows.Forms.SendKeys]::SendWait('^i')
    Start-Sleep -Milliseconds 350
    if (Wait-CapCutImportDialog $window.ProcessId 4 150) {
        return $true
    }

    $importPatterns = @(
        '(^|\s)import($|\s)',
        'import\s*media',
        'media\s*import',
        'add\s*media',
        'import\s*from\s*device',
        'upload\s*media',
        '(^|\s)importer($|\s)',
        'importer.*m.dia',
        'm.dia.*importer',
        'ajouter.*m.dia',
        'm.dia.*ajouter'
    )

    $newProjectPatterns = @(
        'new\s*project',
        'create\s*project',
        'start\s*creating',
        'start\s*editing',
        'blank\s*project',
        'untitled\s*project',
        'nouveau\s*projet',
        'cr.er\s*un\s*projet',
        'creer\s*un\s*projet',
        'commencer.*montage',
        'projet\s*vierge'
    )

    $importButton = Find-ElementByRegex $root $importPatterns
    if (-not $importButton) {
        $newProjectButton = Find-ElementByRegex $root $newProjectPatterns
        if ($newProjectButton) {
            [void](Invoke-AutomationElement $newProjectButton)
            Start-Sleep -Milliseconds 3000
            Set-CapCutForeground $window
            $root = Get-AutomationRoot $window
            $importButton = Find-ElementByRegex $root $importPatterns
        }
    }

    if ($importButton) {
        return (Invoke-AutomationElement $importButton)
    }

    return (Click-CapCutImportFallback $window)
}

function Set-DialogFileName($dialog, [string]$value) {
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($dialog.Handle)
        $dialogRect = New-Object 'Win32CapCut+RECT'
        $hasDialogRect = [Win32CapCut]::GetWindowRect($dialog.Handle, [ref]$dialogRect)
        $minInputTop = [double]::NegativeInfinity
        if ($hasDialogRect) {
            $dialogHeight = [Math]::Max(1, $dialogRect.Bottom - $dialogRect.Top)
            $minInputTop = $dialogRect.Top + ($dialogHeight * 0.55)
        }

        $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        $candidates = New-Object 'System.Collections.Generic.List[object]'

        foreach ($edit in $edits) {
            try {
                $name = ([string]$edit.Current.Name).ToLowerInvariant()
                $rect = $edit.Current.BoundingRectangle
                if ($hasDialogRect -and $rect.Top -lt $minInputTop) {
                    continue
                }
                $score = 0
                if ($name -match 'file\s*name|nom.*fichier|filename') {
                    $score += 100
                }
                if ($hasDialogRect) {
                    $score += [int][Math]::Max(0, $rect.Bottom - $minInputTop)
                }
                if ($rect.Width -gt 120) {
                    $score += 10
                }
                $candidates.Add([pscustomobject]@{
                    Element = $edit
                    Score = $score
                    Bottom = $rect.Bottom
                }) | Out-Null
            } catch {
            }
        }

        $target = $candidates |
            Sort-Object -Property @{ Expression = { $_.Score } }, @{ Expression = { $_.Bottom } } -Descending |
            Select-Object -First 1

        if ($target) {
            $valuePattern = $target.Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $valuePattern.SetValue($value)
            return $true
        }
    } catch {
    }

    return $false
}

function Submit-DialogValue($dialog, [string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $false
    }

    [Win32CapCut]::SetForegroundWindow($dialog.Handle) | Out-Null
    Start-Sleep -Milliseconds 150

    if (-not (Set-DialogFileName $dialog $value)) {
        [System.Windows.Forms.SendKeys]::SendWait('%n')
        Start-Sleep -Milliseconds 120
        [System.Windows.Forms.Clipboard]::SetText($value)
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 220
    }

    [System.Windows.Forms.SendKeys]::SendWait('~')
    Start-Sleep -Milliseconds 350
    return $true
}

function Wait-DialogClosed([int]$targetProcessId, [int]$attempts, [int]$delayMs) {
    for ($i = 0; $i -lt $attempts; $i++) {
        $openDialog = Get-ProcessDialogWindow $targetProcessId
        if (-not $openDialog) {
            return $true
        }
        Start-Sleep -Milliseconds $delayMs
    }

    return $false
}

foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p)) {
        throw ('File not found: ' + $p)
    }
}

$window = Get-CapCutWindow
if (-not $window) {
    throw 'AMVERGE_NO_WINDOW: CapCut window not found. CapCut may still be loading.'
}

if (-not (Open-CapCutImportDialog $window)) {
    throw 'AMVERGE_NO_PROJECT: Open or create a CapCut project first.'
}

$dialog = $null
for ($i = 0; $i -lt 40; $i++) {
    $dialog = Get-ProcessDialogWindow $window.ProcessId
    if ($dialog) {
        break
    }
    Start-Sleep -Milliseconds 150
}

if (-not $dialog) {
    throw 'AMVERGE_NO_PROJECT: CapCut import dialog did not open. Open or create a CapCut project first.'
}

[Win32CapCut]::SetForegroundWindow($dialog.Handle) | Out-Null
Start-Sleep -Milliseconds 250

$fileNamePayload = ($paths | ForEach-Object { '"' + ($_.Replace('"', '""')) + '"' }) -join ' '
[void](Submit-DialogValue $dialog $fileNamePayload)

if (-not (Wait-DialogClosed $window.ProcessId 50 150)) {
    $stillOpen = Get-ProcessDialogWindow $window.ProcessId
    $stillOpenTitle = if ($stillOpen) { [string]$stillOpen.Title } else { '' }
    throw ('AMVERGE_INVALID_FILENAME: CapCut import dialog stayed open after path submit. Dialog=' + $stillOpenTitle)
}

Write-Output 'CapCut media import complete.'
"#;

    template.replace("__FILES__", &files)
}

fn is_capcut_app_process_running() -> bool {
    let mut cmd = Command::new("tasklist");
    apply_no_window(&mut cmd);

    let output = cmd.arg("/FO").arg("CSV").arg("/NH").output();
    let Ok(out) = output else {
        return false;
    };
    if !out.status.success() {
        return false;
    }

    String::from_utf8_lossy(&out.stdout).lines().any(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with('"') {
            return false;
        }
        let Some(end_quote) = trimmed[1..].find('"') else {
            return false;
        };
        let image = &trimmed[1..1 + end_quote];
        let lowered = image.to_ascii_lowercase();
        lowered.starts_with("capcut")
            && lowered.ends_with(".exe")
            && !lowered.contains("service")
            && !lowered.contains("update")
            && !lowered.contains("crash")
            && !lowered.contains("helper")
    })
}

fn is_capcut_media_extension_supported(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("mp4") | Some("mov") | Some("jpg") | Some("jpeg") | Some("png") | Some("mp3")
    )
}

fn resolve_capcut_executable() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AMVERGE_CAPCUT_PATH") {
        let path = PathBuf::from(custom);
        if path.exists() {
            return Some(path);
        }
    }

    if let Some(running) = resolve_running_capcut_executable() {
        return Some(running);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(&local_app_data)
                .join("CapCut")
                .join("Apps")
                .join("CapCut.exe"),
        );
        candidates.push(
            PathBuf::from(&local_app_data)
                .join("Programs")
                .join("CapCut")
                .join("CapCut.exe"),
        );
    }
    candidates.push(PathBuf::from(r"C:\Program Files\CapCut\Apps\CapCut.exe"));
    candidates.into_iter().find(|candidate| candidate.exists())
}

#[cfg(target_os = "windows")]
fn resolve_running_capcut_executable() -> Option<PathBuf> {
    let mut cmd = Command::new("powershell");
    apply_no_window(&mut cmd);
    let output = cmd
        .arg("-NoProfile")
        .arg("-Command")
        .arg(
            "Get-Process -Name 'CapCut*' -ErrorAction SilentlyContinue | \
             ForEach-Object { $_.Path }",
        )
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|candidate| candidate.exists())
        .filter(|candidate| {
            candidate
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    let lowered = name.to_ascii_lowercase();
                    lowered.starts_with("capcut")
                        && lowered.ends_with(".exe")
                        && !lowered.contains("service")
                        && !lowered.contains("update")
                        && !lowered.contains("crash")
                        && !lowered.contains("helper")
                })
                .unwrap_or(false)
        })
        .max_by_key(|candidate| {
            candidate
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    if name.eq_ignore_ascii_case("CapCut.exe") {
                        2
                    } else {
                        1
                    }
                })
                .unwrap_or(0)
        })
}
