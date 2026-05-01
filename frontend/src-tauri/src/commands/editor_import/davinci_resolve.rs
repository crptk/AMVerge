use super::*;

pub(super) fn build_davinci_original_cut_script(
    timeline_xml_path: &str,
    original_path: &str,
    sequence_name: &str,
) -> String {
    let source_dir = Path::new(original_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    [
        "import os".to_string(),
        "import sys".to_string(),
        "".to_string(),
        format!(
            "TIMELINE_XML_PATH = r'{}'",
            escape_py_single_quoted(timeline_xml_path)
        ),
        format!("SOURCE_PATH = r'{}'", escape_py_single_quoted(original_path)),
        format!("SOURCE_DIR = r'{}'", escape_py_single_quoted(&source_dir)),
        format!(
            "SEQUENCE_NAME = r'{}'",
            escape_py_single_quoted(sequence_name)
        ),
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
        "    raise RuntimeError('Could not connect to DaVinci Resolve. Ensure Resolve Studio is running and External scripting is set to Local.')".to_string(),
        "pm = resolve.GetProjectManager()".to_string(),
        "project = pm.GetCurrentProject() if pm else None".to_string(),
        "if not project:".to_string(),
        "    raise RuntimeError('No Resolve project is open.')".to_string(),
        "media_pool = project.GetMediaPool()".to_string(),
        "if not media_pool:".to_string(),
        "    raise RuntimeError('Could not access Resolve media pool.')".to_string(),
        "if not os.path.exists(TIMELINE_XML_PATH):".to_string(),
        "    raise RuntimeError('Timeline XML not found: ' + TIMELINE_XML_PATH)".to_string(),
        "if os.path.exists(SOURCE_PATH):".to_string(),
        "    try:".to_string(),
        "        media_pool.ImportMedia([SOURCE_PATH])".to_string(),
        "    except Exception:".to_string(),
        "        pass".to_string(),
        "import_options = {'timelineName': SEQUENCE_NAME, 'importSourceClips': True}".to_string(),
        "if SOURCE_DIR and os.path.isdir(SOURCE_DIR):".to_string(),
        "    import_options['sourceClipsPath'] = SOURCE_DIR".to_string(),
        "timeline = media_pool.ImportTimelineFromFile(TIMELINE_XML_PATH, import_options)".to_string(),
        "if not timeline:".to_string(),
        "    timeline = media_pool.ImportTimelineFromFile(TIMELINE_XML_PATH)".to_string(),
        "if not timeline:".to_string(),
        "    raise RuntimeError('Resolve failed to import timeline XML.')".to_string(),
        "try:".to_string(),
        "    project.SetCurrentTimeline(timeline)".to_string(),
        "except Exception:".to_string(),
        "    pass".to_string(),
        "print('DaVinci Resolve original cut import complete.')".to_string(),
    ]
    .join("\n")
}

pub(super) async fn import_original_cut_into_davinci_resolve(
    app: &AppHandle,
    abort_requested: &AtomicBool,
    clips: Vec<OriginalCutClip>,
    sequence_name: Option<String>,
) -> Result<String, String> {
    let (original_path, normalized_sequence_name, segments) =
        normalize_original_cut_input(app, clips, sequence_name)?;

    #[cfg(target_os = "windows")]
    emit_import_progress(
        Some(app),
        96,
        "Preparing DaVinci Resolve original-cut XML...",
    );

    #[cfg(target_os = "windows")]
    if is_import_cancel_requested(abort_requested) {
        return Err(import_canceled_error());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = abort_requested;
    }

    let timeline_xml_path = write_original_cut_timeline_xml(
        app,
        &original_path,
        &normalized_sequence_name,
        &segments,
        "amverge_resolve_original_cut",
    )
    .await?;
    let script_body = build_davinci_original_cut_script(
        timeline_xml_path.to_string_lossy().as_ref(),
        &original_path,
        &normalized_sequence_name,
    );
    let script_path = write_temp_script("amverge_resolve_original_cut", "py", &script_body)?;

    #[cfg(target_os = "windows")]
    {
        let resolve_running = is_windows_process_running("Resolve.exe");
        if !resolve_running {
            if let Some(resolve_exe) = resolve_davinci_executable() {
                emit_import_progress(Some(app), 98, "Launching DaVinci Resolve...");
                spawn_editor_process(&resolve_exe, "DaVinci Resolve", "NLE|davinci_original_cut")?;
            } else {
                return Err("DaVinci Resolve executable was not found.".to_string());
            }
        }

        let message = run_windows_import_with_retries(
            Some(app),
            abort_requested,
            "NLE|davinci_original_cut",
            "DaVinci Resolve",
            30,
            !resolve_running,
            Some("Resolve.exe"),
            "DaVinci Resolve was closed before the original-cut import completed.",
            "DaVinci Resolve did not become ready for original-cut scripting in time.",
            || run_python_script(&script_path),
        )
        .await?;

        console_log(
            "NLE|davinci_original_cut",
            &format!(
                "ok source={} segments={} sequence={} xml={}",
                original_path,
                segments.len(),
                normalized_sequence_name,
                timeline_xml_path.display()
            ),
        );
        return Ok(message);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = run_python_script(&script_path)?;
        return Ok(result);
    }
}

pub(super) async fn import_into_davinci_resolve(
    app: &AppHandle,
    media_paths: &[String],
    abort_requested: &AtomicBool,
) -> Result<String, String> {
    let script_path = write_temp_script(
        "amverge_resolve_import",
        "py",
        &build_davinci_import_script(media_paths),
    )?;

    #[cfg(target_os = "windows")]
    {
        emit_import_progress(Some(app), 98, "Preparing DaVinci Resolve auto-import...");
        let resolve_running = is_windows_process_running("Resolve.exe");
        if !resolve_running {
            if let Some(resolve_exe) = resolve_davinci_executable() {
                emit_import_progress(Some(app), 98, "Launching DaVinci Resolve...");
                spawn_editor_process(&resolve_exe, "DaVinci Resolve", "NLE|davinci")?;
            } else {
                return Err("DaVinci Resolve executable was not found.".to_string());
            }
        }

        run_windows_import_with_retries(
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
        .await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = abort_requested;
        run_python_script(&script_path)
    }
}

pub(super) fn build_davinci_import_script(media_paths: &[String]) -> String {
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
        "    raise RuntimeError('Could not connect to DaVinci Resolve. Ensure Resolve Studio is running and External scripting is set to Local.')"
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
        "def norm(p):".to_string(),
        "    return os.path.normcase(os.path.normpath(str(p or ''))).replace('\\\\', '/')".to_string(),
        "".to_string(),
        "def iter_clips(folder):".to_string(),
        "    if not folder:".to_string(),
        "        return".to_string(),
        "    for clip in (folder.GetClipList() or []):".to_string(),
        "        yield clip".to_string(),
        "    for sub in (folder.GetSubFolderList() or []):".to_string(),
        "        for clip in iter_clips(sub):".to_string(),
        "            yield clip".to_string(),
        "".to_string(),
        "def clip_exists(project_obj, file_path):".to_string(),
        "    try:".to_string(),
        "        root = project_obj.GetMediaPool().GetRootFolder()".to_string(),
        "    except Exception:".to_string(),
        "        return False".to_string(),
        "    wanted = norm(file_path)".to_string(),
        "    for clip in iter_clips(root):".to_string(),
        "        try:".to_string(),
        "            props = clip.GetClipProperty() or {}".to_string(),
        "            clip_path = props.get('File Path') or props.get('FilePath') or ''".to_string(),
        "            if norm(clip_path) == wanted:".to_string(),
        "                return True".to_string(),
        "        except Exception:".to_string(),
        "            pass".to_string(),
        "    return False".to_string(),
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
        "to_import = [p for p in normalized if not clip_exists(project, p)]".to_string(),
        "if not to_import:".to_string(),
        "    print('DaVinci Resolve import complete.')".to_string(),
        "    raise SystemExit(0)".to_string(),
        "".to_string(),
        "result = media_pool.ImportMedia(to_import)".to_string(),
        "if not result:".to_string(),
        "    clip_infos = [{'FilePath': p} for p in to_import]".to_string(),
        "    result = media_pool.ImportMedia(clip_infos)".to_string(),
        "".to_string(),
        "if not result:".to_string(),
        "    imported_any = False".to_string(),
        "    failed = []".to_string(),
        "    for p in to_import:".to_string(),
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
