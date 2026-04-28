#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! AMVerge Tauri backend entrypoint.
//!
//! This file is the bridge between the React frontend and the Python/FFmpeg backend.
//!
//! Main responsibilities:
//! - start/abort scene detection
//! - emit progress events to the frontend
//! - export selected clips, either separately or merged
//! - generate browser-friendly preview proxies for unsupported codecs
//! - clean episode cache folders
//!
//! Rust note: this file is intentionally kept in one place for now.
//! I’m far more comfortable in React/TypeScript and Python, so the Rust side was built
//! mainly as a practical Tauri bridge for native desktop packaging and frontend/backend communication.
//!
//! It may be refactored into modules later as the project grows.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use tokio::sync::Mutex as AsyncMutex;

use serde::Serialize;
use tauri::Emitter;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Clone)]
struct ProgressPayload {
    percent: u8,
    message: String,
}

// ============================================================================
// Shared app state
// ============================================================================

#[derive(Default)]
struct ActiveSidecar {
    pid: Mutex<Option<u32>>,
}

// ============================================================================
// Logging and path display helpers
// ============================================================================

fn file_name_only(s: &str) -> String {
    let p = Path::new(s);
    p.file_name()
        .and_then(|x| x.to_str())
        .unwrap_or(s)
        .to_string()
}

fn dir_name_only(p: &Path) -> String {
    if let Some(name) = p.file_name().and_then(|x| x.to_str()) {
        return name.to_string();
    }
    p.to_string_lossy().to_string()
}

fn sanitize_for_console(s: &str) -> String {
    // Keep it single-line and screenshot friendly.
    s.replace('\r', " ").replace('\n', " ")
}

fn console_log(tag: &str, msg: &str) {
    let tag = sanitize_for_console(tag);
    let msg = sanitize_for_console(msg);
    println!("AMVERGE|{}|{}", tag, msg);
}

fn sanitize_line_with_known_paths(
    line: &str,
    input_full: &str,
    input_base: &str,
    output_full: &str,
    output_base: &str,
) -> String {
    let mut s = line.to_string();
    if !input_full.is_empty() && input_full != input_base {
        s = s.replace(input_full, input_base);
    }
    if !output_full.is_empty() && output_full != output_base {
        s = s.replace(output_full, output_base);
    }
    s
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn apply_no_window(cmd: &mut Command) {
    // Prevent additional console windows from appearing for child processes.
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn sanitize_episode_cache_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() {
        return Err("episode_cache_id is empty".to_string());
    }

    // Keep paths safe and predictable.
    // Allow UUIDs and simple user-generated ids.
    if id.len() > 96 {
        return Err("episode_cache_id is too long".to_string());
    }

    let ok = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err("episode_cache_id contains invalid characters".to_string());
    }

    Ok(id.to_string())
}

fn clear_files_in_dir(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

// ============================================================================
// Preview proxy locking
// ============================================================================

#[derive(Default)]
struct PreviewProxyLocks {
    // One async mutex per clip path.
    // Prevents concurrent encodes of the same preview proxy (which can produce partial files).
    inner: AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

// ============================================================================
// Derush SQLite state
// ============================================================================

static DERUSH_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize, Clone)]
struct DerushClipInput {
    id: String,
    src: String,
    thumbnail: String,
    #[serde(default, rename = "originalName")]
    original_name: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DerushProjectSummary {
    id: String,
    source_key: String,
    source_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DerushCategoryRow {
    id: String,
    name: String,
    color: String,
    icon: Option<String>,
    is_system: bool,
    clip_count: usize,
    episode_clip_count: usize,
    project_clip_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DerushSnapshot {
    project: DerushProjectSummary,
    categories: Vec<DerushCategoryRow>,
    clip_category_map: HashMap<String, Vec<String>>,
}

fn unix_ms_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn make_scoped_id(prefix: &str) -> String {
    let n = DERUSH_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}_{}_{}", prefix, unix_ms_now(), n)
}

fn default_source_name(episode_display_name: &str, video_path: &str) -> String {
    let from_parent = Path::new(video_path)
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    if let Some(parent_name) = from_parent {
        return parent_name;
    }

    let fallback = episode_display_name.trim();
    if !fallback.is_empty() {
        return fallback.to_string();
    }

    "Unknown Source".to_string()
}

fn normalize_source_key(source_name: &str) -> String {
    let mut out = String::with_capacity(source_name.len());
    let mut prev_sep = false;

    for ch in source_name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_sep = false;
        } else if !prev_sep {
            out.push('_');
            prev_sep = true;
        }
    }

    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "source".to_string()
    } else {
        trimmed
    }
}

fn derush_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("derush.sqlite3"))
}

fn open_derush_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = derush_db_path(app)?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open SQLite db ({}): {e}", db_path.display()))?;

    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS derush_projects (
            id TEXT PRIMARY KEY,
            source_key TEXT NOT NULL UNIQUE,
            source_name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS derush_episodes (
            episode_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            video_path TEXT NOT NULL,
            imported_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES derush_projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS derush_clips (
            clip_id TEXT PRIMARY KEY,
            episode_id TEXT NOT NULL,
            clip_path TEXT NOT NULL,
            thumbnail_path TEXT NOT NULL,
            sort_index INTEGER NOT NULL,
            original_name TEXT,
            FOREIGN KEY (episode_id) REFERENCES derush_episodes(episode_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS derush_categories (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            icon TEXT,
            is_system INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES derush_projects(id) ON DELETE CASCADE,
            UNIQUE(project_id, name)
        );

        CREATE TABLE IF NOT EXISTS derush_clip_categories (
            clip_id TEXT NOT NULL,
            category_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (clip_id, category_id),
            FOREIGN KEY (clip_id) REFERENCES derush_clips(clip_id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES derush_categories(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_derush_episode_project ON derush_episodes(project_id);
        CREATE INDEX IF NOT EXISTS idx_derush_clips_episode ON derush_clips(episode_id);
        CREATE INDEX IF NOT EXISTS idx_derush_categories_project ON derush_categories(project_id);
        CREATE INDEX IF NOT EXISTS idx_derush_clip_categories_category ON derush_clip_categories(category_id);
        "#,
    )
    .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;

    Ok(conn)
}

fn sync_derush_episode_inner(
    conn: &mut Connection,
    episode_id: String,
    episode_display_name: String,
    video_path: String,
    scope_key: String,
    scope_name: Option<String>,
    clips: Vec<DerushClipInput>,
) -> Result<DerushSnapshot, String> {
    let now = unix_ms_now();
    let scope_key = scope_key.trim();
    if scope_key.is_empty() {
        return Err("scope_key is empty".to_string());
    }

    let source_key = normalize_source_key(scope_key);
    let source_name_guess = scope_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| default_source_name(&episode_display_name, &video_path));

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let existing_project: Option<(String, String)> = tx
        .query_row(
            "SELECT id, source_name FROM derush_projects WHERE source_key = ?1",
            params![&source_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let (project_id, source_name) = if let Some((id, stored_name)) = existing_project {
        tx.execute(
            "UPDATE derush_projects SET updated_at = ?1 WHERE id = ?2",
            params![now, &id],
        )
        .map_err(|e| e.to_string())?;
        (id, stored_name)
    } else {
        let id = make_scoped_id("proj");
        tx.execute(
            "INSERT INTO derush_projects (id, source_key, source_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![&id, &source_key, &source_name_guess, now, now],
        )
        .map_err(|e| e.to_string())?;
        (id, source_name_guess)
    };

    tx.execute(
        "INSERT INTO derush_episodes (
            episode_id, project_id, display_name, video_path, imported_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(episode_id) DO UPDATE SET
            project_id = excluded.project_id,
            display_name = excluded.display_name,
            video_path = excluded.video_path,
            updated_at = excluded.updated_at",
        params![
            &episode_id,
            &project_id,
            &episode_display_name,
            &video_path,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    let existing_clip_ids: HashSet<String> = {
        let mut stmt = tx
            .prepare("SELECT clip_id FROM derush_clips WHERE episode_id = ?1")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map(params![&episode_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut set = HashSet::new();
        for item in iter {
            set.insert(item.map_err(|e| e.to_string())?);
        }
        set
    };

    let mut incoming_clip_ids = HashSet::new();
    for (index, clip) in clips.iter().enumerate() {
        let clip_id = clip.id.trim();
        let clip_src = clip.src.trim();
        let clip_thumb = clip.thumbnail.trim();
        if clip_id.is_empty() || clip_src.is_empty() || clip_thumb.is_empty() {
            continue;
        }

        incoming_clip_ids.insert(clip_id.to_string());

        tx.execute(
            "INSERT INTO derush_clips (
                clip_id, episode_id, clip_path, thumbnail_path, sort_index, original_name
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(clip_id) DO UPDATE SET
                episode_id = excluded.episode_id,
                clip_path = excluded.clip_path,
                thumbnail_path = excluded.thumbnail_path,
                sort_index = excluded.sort_index,
                original_name = excluded.original_name",
            params![
                clip_id,
                &episode_id,
                clip_src,
                clip_thumb,
                index as i64,
                clip.original_name.as_deref().unwrap_or(""),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for stale_id in existing_clip_ids.difference(&incoming_clip_ids) {
        tx.execute(
            "DELETE FROM derush_clips WHERE clip_id = ?1",
            params![stale_id.as_str()],
        )
        .map_err(|e| e.to_string())?;
    }

    let categories: Vec<DerushCategoryRow> = {
        let mut stmt = tx
            .prepare(
                r#"
                SELECT
                    cat.id,
                    cat.name,
                    cat.color,
                    cat.icon,
                    cat.is_system,
                    COUNT(
                        CASE
                            WHEN clip.episode_id = ?2 THEN cc.clip_id
                            ELSE NULL
                        END
                    ) AS episode_clip_count,
                    COUNT(cc.clip_id) AS project_clip_count
                FROM derush_categories cat
                LEFT JOIN derush_clip_categories cc
                    ON cc.category_id = cat.id
                LEFT JOIN derush_clips clip
                    ON clip.clip_id = cc.clip_id
                WHERE cat.project_id = ?1
                GROUP BY
                    cat.id, cat.name, cat.color, cat.icon, cat.is_system, cat.created_at
                ORDER BY cat.is_system DESC, cat.created_at ASC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![&project_id, &episode_id], |row| {
                let is_system_raw: i64 = row.get(4)?;
                let episode_clip_count_raw: i64 = row.get(5)?;
                let project_clip_count_raw: i64 = row.get(6)?;
                Ok(DerushCategoryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    icon: row.get(3)?,
                    is_system: is_system_raw != 0,
                    clip_count: episode_clip_count_raw.max(0) as usize,
                    episode_clip_count: episode_clip_count_raw.max(0) as usize,
                    project_clip_count: project_clip_count_raw.max(0) as usize,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        out
    };

    let clip_category_map: HashMap<String, Vec<String>> = {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        let mut stmt = tx
            .prepare(
                r#"
                SELECT cc.clip_id, cc.category_id
                FROM derush_clip_categories cc
                INNER JOIN derush_clips clip
                    ON clip.clip_id = cc.clip_id
                INNER JOIN derush_categories cat
                    ON cat.id = cc.category_id
                WHERE clip.episode_id = ?1
                  AND cat.project_id = ?2
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![&episode_id, &project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (clip_id, category_id) = row.map_err(|e| e.to_string())?;
            map.entry(clip_id).or_default().push(category_id);
        }
        map
    };

    tx.commit().map_err(|e| e.to_string())?;

    Ok(DerushSnapshot {
        project: DerushProjectSummary {
            id: project_id,
            source_key,
            source_name,
        },
        categories,
        clip_category_map,
    })
}

#[tauri::command]
async fn sync_derush_episode(
    app: AppHandle,
    episode_id: String,
    episode_display_name: String,
    video_path: String,
    scope_key: String,
    scope_name: Option<String>,
    clips: Vec<DerushClipInput>,
) -> Result<DerushSnapshot, String> {
    if episode_id.trim().is_empty() {
        return Err("episode_id is empty".to_string());
    }
    if video_path.trim().is_empty() {
        return Err("video_path is empty".to_string());
    }
    if scope_key.trim().is_empty() {
        return Err("scope_key is empty".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let mut conn = open_derush_db(&app)?;
        sync_derush_episode_inner(
            &mut conn,
            episode_id,
            episode_display_name,
            video_path,
            scope_key,
            scope_name,
            clips,
        )
    })
    .await
    .map_err(|e| format!("sync_derush_episode task panicked: {e}"))?
}

#[tauri::command]
async fn create_derush_category(
    app: AppHandle,
    project_id: String,
    name: String,
    color: String,
    icon: Option<String>,
) -> Result<DerushCategoryRow, String> {
    let project_id = project_id.trim().to_string();
    let name = name.trim().to_string();
    if project_id.is_empty() {
        return Err("project_id is empty".to_string());
    }
    if name.is_empty() {
        return Err("Category name is empty".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let mut conn = open_derush_db(&app)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let project_exists: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM derush_projects WHERE id = ?1",
                params![&project_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if project_exists.is_none() {
            return Err("Unknown project_id".to_string());
        }

        let normalized_color = {
            let c = color.trim();
            if c.starts_with('#') && (c.len() == 7 || c.len() == 4) {
                c.to_string()
            } else {
                "#9BCBFF".to_string()
            }
        };

        let now = unix_ms_now();
        let existing: Option<DerushCategoryRow> = tx
            .query_row(
                r#"
                SELECT id, name, color, icon, is_system
                FROM derush_categories
                WHERE project_id = ?1 AND LOWER(name) = LOWER(?2)
                "#,
                params![&project_id, &name],
                |row| {
                    let is_system_raw: i64 = row.get(4)?;
                    Ok(DerushCategoryRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                        icon: row.get(3)?,
                        is_system: is_system_raw != 0,
                        clip_count: 0,
                        episode_clip_count: 0,
                        project_clip_count: 0,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(category) = existing {
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(category);
        }

        let category_id = make_scoped_id("cat");
        tx.execute(
            "INSERT INTO derush_categories (
                id, project_id, name, color, icon, is_system, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
            params![
                &category_id,
                &project_id,
                &name,
                &normalized_color,
                &icon,
                now,
                now
            ],
        )
        .map_err(|e| e.to_string())?;

        let category = tx
            .query_row(
                "SELECT id, name, color, icon, is_system FROM derush_categories WHERE id = ?1",
                params![&category_id],
                |row| {
                    let is_system_raw: i64 = row.get(4)?;
                    Ok(DerushCategoryRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                        icon: row.get(3)?,
                        is_system: is_system_raw != 0,
                        clip_count: 0,
                        episode_clip_count: 0,
                        project_clip_count: 0,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(category)
    })
    .await
    .map_err(|e| format!("create_derush_category task panicked: {e}"))?
}

#[tauri::command]
async fn set_derush_clip_category(
    app: AppHandle,
    clip_id: String,
    category_id: String,
    enabled: bool,
) -> Result<(), String> {
    let clip_id = clip_id.trim().to_string();
    let category_id = category_id.trim().to_string();

    if clip_id.is_empty() {
        return Err("clip_id is empty".to_string());
    }
    if category_id.is_empty() {
        return Err("category_id is empty".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let conn = open_derush_db(&app)?;

        // Ensure clip and category belong to the same project.
        let relation_ok: Option<i64> = conn
            .query_row(
                r#"
                SELECT 1
                FROM derush_clips clip
                INNER JOIN derush_episodes ep ON ep.episode_id = clip.episode_id
                INNER JOIN derush_categories cat ON cat.project_id = ep.project_id
                WHERE clip.clip_id = ?1 AND cat.id = ?2
                "#,
                params![&clip_id, &category_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if relation_ok.is_none() {
            return Err("Clip/category relationship is invalid".to_string());
        }

        if enabled {
            conn.execute(
                "INSERT OR IGNORE INTO derush_clip_categories (clip_id, category_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![&clip_id, &category_id, unix_ms_now()],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "DELETE FROM derush_clip_categories WHERE clip_id = ?1 AND category_id = ?2",
                params![&clip_id, &category_id],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("set_derush_clip_category task panicked: {e}"))?
}

#[tauri::command]
async fn update_derush_category(
    app: AppHandle,
    category_id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let category_id = category_id.trim().to_string();
    let name = name.trim().to_string();
    let color = color.trim().to_string();

    if category_id.is_empty() {
        return Err("category_id is empty".to_string());
    }
    if name.is_empty() {
        return Err("Category name is empty".to_string());
    }

    let normalized_color = if color.starts_with('#') && (color.len() == 7 || color.len() == 4) {
        color
    } else {
        "#9BCBFF".to_string()
    };

    tokio::task::spawn_blocking(move || {
        let conn = open_derush_db(&app)?;

        let project_id: Option<String> = conn
            .query_row(
                "SELECT project_id FROM derush_categories WHERE id = ?1",
                params![&category_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some(project_id) = project_id else {
            return Err("Unknown category_id".to_string());
        };

        let duplicate: Option<String> = conn
            .query_row(
                r#"
                SELECT id
                FROM derush_categories
                WHERE project_id = ?1
                  AND LOWER(name) = LOWER(?2)
                  AND id != ?3
                "#,
                params![&project_id, &name, &category_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if duplicate.is_some() {
            return Err("A category with this name already exists".to_string());
        }

        conn.execute(
            r#"
            UPDATE derush_categories
            SET name = ?1,
                color = ?2,
                updated_at = ?3
            WHERE id = ?4
            "#,
            params![&name, &normalized_color, unix_ms_now(), &category_id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| format!("update_derush_category task panicked: {e}"))?
}

#[tauri::command]
async fn delete_derush_category(app: AppHandle, category_id: String) -> Result<(), String> {
    let category_id = category_id.trim().to_string();
    if category_id.is_empty() {
        return Err("category_id is empty".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let conn = open_derush_db(&app)?;
        let deleted = conn
            .execute(
                "DELETE FROM derush_categories WHERE id = ?1",
                params![&category_id],
            )
            .map_err(|e| e.to_string())?;

        if deleted == 0 {
            return Err("Unknown category_id".to_string());
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("delete_derush_category task panicked: {e}"))?
}

#[tauri::command]
fn save_background_image(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    let source = Path::new(&source_path);

    if !source.exists() {
        return Err("Selected image does not exist.".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    let backgrounds_dir = app_data_dir.join("backgrounds");

    fs::create_dir_all(&backgrounds_dir)
        .map_err(|e| format!("Failed to create backgrounds directory: {e}"))?;

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png");

    let file_name = format!("background.{}", extension);
    let destination = backgrounds_dir.join(file_name);

    fs::copy(source, &destination).map_err(|e| format!("Failed to copy background image: {e}"))?;

    Ok(destination.to_string_lossy().to_string())
}

// ============================================================================
// Commands: codec checks
// ============================================================================

#[tauri::command]
async fn check_hevc(app: AppHandle, video_path: String) -> Result<bool, String> {
    if video_path.trim().is_empty() {
        return Err("video_path is empty".to_string());
    }

    let video_name = file_name_only(&video_path);

    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;
    let ffprobe_name = ffprobe
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or("ffprobe.exe")
        .to_string();

    let ffprobe_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffprobe);
        apply_no_window(&mut cmd);
        cmd.args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=nk=1:nw=1",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))
    })
    .await
    .map_err(|e| format!("ffprobe task panicked: {e}"))??;

    if !ffprobe_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffprobe_output.stderr)
            .trim()
            .to_string();

        if !stderr.is_empty() {
            console_log(
                "ERROR|check_hevc",
                &format!("{ffprobe_name} failed for {video_name}: {stderr}"),
            );
        } else {
            console_log(
                "ERROR|check_hevc",
                &format!("{ffprobe_name} failed for {video_name}"),
            );
        }

        return Err(if stderr.is_empty() {
            "ffprobe failed".to_string()
        } else {
            format!("ffprobe failed: {stderr}")
        });
    }

    let codec = String::from_utf8_lossy(&ffprobe_output.stdout)
        .trim()
        .to_ascii_lowercase();

    Ok(codec == "hevc")
}

// ============================================================================
// Commands: scene detection
// ============================================================================

#[tauri::command]
async fn detect_scenes(
    app: AppHandle,
    sidecar_state: State<'_, ActiveSidecar>,
    video_path: String,
    episode_cache_id: Option<String>,
) -> Result<String, String> {
    let video_name = file_name_only(&video_path);
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let output_dir = if let Some(raw_id) = episode_cache_id.as_deref() {
        let id = sanitize_episode_cache_id(raw_id)?;
        app_data_dir.join("episodes").join(id)
    } else {
        app_data_dir.clone()
    };

    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    clear_files_in_dir(&output_dir);
    let output_dir_str = output_dir.to_string_lossy().to_string();

    console_log(
        "SCENE|start",
        &format!(
            "video={video_name} output_dir={}",
            dir_name_only(&output_dir)
        ),
    );

    let output_dir_base = dir_name_only(&output_dir);

    let mut child = if cfg!(debug_assertions) {
        // DEV MODE → run python script from /backend using the local venv
        let mut root = std::env::current_dir().map_err(|e| e.to_string())?;
        root.pop();
        root.pop();

        let script_path = root.join("backend").join("app.py");
        let python_path = root
            .join("backend")
            .join("venv")
            .join("Scripts")
            .join("python.exe");

        let python_name = python_path
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("python.exe");
        console_log(
            "SCENE|spawn",
            &format!(
                "mode=dev exe={python_name} script=app.py args=[{video_name},{output_dir_base}]"
            ),
        );

        let mut cmd = Command::new(python_path);
        apply_no_window(&mut cmd);
        cmd.arg(script_path)
            .arg(&video_path)
            .arg(&output_dir_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn python: {e}"))?
    } else {
        // PRODUCTION → run bundled backend exe from resources
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Can't find current exe: {e}"))?
            .parent()
            .ok_or("Can't get exe directory")?
            .to_path_buf();

        let backend = app
            .path()
            .resolve(
                "bin/backend_script-x86_64-pc-windows-msvc/backend_script.exe",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| e.to_string())?;

        let backend_name = backend
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("backend_script.exe");
        console_log(
            "SCENE|spawn",
            &format!("mode=prod exe={backend_name} args=[{video_name},{output_dir_base}]"),
        );

        let mut cmd = Command::new(backend);
        apply_no_window(&mut cmd);
        cmd.current_dir(&exe_dir)
            .arg(&video_path)
            .arg(&output_dir_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn backend exe: {e}"))?
    };

    let child_pid = child.id();
    console_log("SCENE|pid", &format!("pid={}", child_pid));

    // Store PID so abort_detect_scenes can kill this process tree.
    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = Some(child_pid);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stderr_accum = Arc::new(Mutex::new(String::new()));
    let app_for_thread = app.clone();
    let stderr_accum_for_thread = Arc::clone(&stderr_accum);

    let input_full_for_thread = video_path.clone();
    let input_base_for_thread = video_name.clone();
    let output_full_for_thread = output_dir_str.clone();
    let output_base_for_thread = output_dir_base.clone();

    let stderr_handle = tokio::task::spawn_blocking(move || {
        let reader = BufReader::new(stderr);
        const STDERR_CAP: usize = 256 * 1024; // 256 KB
        for line in reader.lines().flatten() {
            if !line.starts_with("PROGRESS|") {
                let sanitized = sanitize_line_with_known_paths(
                    &line,
                    &input_full_for_thread,
                    &input_base_for_thread,
                    &output_full_for_thread,
                    &output_base_for_thread,
                );
                console_log("BACKEND", &sanitized);
            }
            if let Ok(mut buf) = stderr_accum_for_thread.lock() {
                if buf.len() < STDERR_CAP {
                    buf.push_str(&line);
                    buf.push('\n');
                }
            }

            if let Some(rest) = line.strip_prefix("PROGRESS|") {
                let mut parts = rest.splitn(2, '|');
                let p_str = parts.next().unwrap_or("");
                let msg = parts.next().unwrap_or("").to_string();

                if let Ok(p) = p_str.parse::<u8>() {
                    let _ = app_for_thread.emit(
                        "scene_progress",
                        ProgressPayload {
                            percent: p,
                            message: msg,
                        },
                    );
                }
            }
        }
    });

    let stdout_string = tokio::task::spawn_blocking(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        reader.read_to_string(&mut buf).map(|_| buf)
    })
    .await
    .map_err(|e| format!("stdout thread panicked: {e}"))?
    .map_err(|e| format!("Failed reading stdout: {e}"))?;

    let _ = stderr_handle.await;

    let status = tokio::task::spawn_blocking(move || child.wait())
        .await
        .map_err(|e| format!("wait thread panicked: {e}"))?
        .map_err(|e| format!("Failed waiting for python: {e}"))?;

    // Clear tracked PID now that the process has exited.
    if let Ok(mut lock) = sidecar_state.pid.lock() {
        *lock = None;
    }

    console_log(
        "SCENE|end",
        &format!("video={video_name} status={}", status),
    );

    if !status.success() {
        let err = stderr_accum
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| "Python failed (stderr lock poisoned)".to_string());

        console_log(
            "ERROR|detect_scenes",
            &format!("video={video_name} exit={status}"),
        );
        console_log("ERROR|detect_scenes", "backend_stderr_dump_begin");
        for l in err.lines() {
            let sanitized = sanitize_line_with_known_paths(
                l,
                &video_path,
                &video_name,
                &output_dir_str,
                &output_dir_base,
            );
            if !sanitized.trim().is_empty() && !sanitized.starts_with("PROGRESS|") {
                console_log("BACKEND", &sanitized);
            }
        }
        console_log("ERROR|detect_scenes", "backend_stderr_dump_end");
        return Err(err);
    }

    Ok(stdout_string)
}

// ============================================================================
// Commands: abort scene detection
// ============================================================================

#[tauri::command]
async fn abort_detect_scenes(sidecar_state: State<'_, ActiveSidecar>) -> Result<(), String> {
    let pid = {
        let mut lock = sidecar_state.pid.lock().map_err(|e| e.to_string())?;
        lock.take()
    };

    let Some(pid) = pid else {
        console_log("ABORT", "no active sidecar to kill");
        return Ok(());
    };

    console_log("ABORT", &format!("killing process tree pid={pid}"));

    // taskkill /F /T kills the entire process tree (sidecar + ffmpeg children).
    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("taskkill");
        apply_no_window(&mut cmd);
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]).output()
    })
    .await
    .map_err(|e| format!("taskkill task panicked: {e}"))?
    .map_err(|e| format!("Failed to run taskkill: {e}"))?;

    if result.status.success() {
        console_log("ABORT", &format!("killed pid={pid} ok"));
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        console_log("ABORT", &format!("taskkill pid={pid} failed: {stderr}"));
    }

    Ok(())
}

// ============================================================================
// Commands: episode cache cleanup
// ============================================================================

#[tauri::command]
async fn delete_episode_cache(app: AppHandle, episode_cache_id: String) -> Result<(), String> {
    let id = sanitize_episode_cache_id(&episode_cache_id)?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let episode_dir = app_data_dir.join("episodes").join(id);
    if episode_dir.exists() {
        std::fs::remove_dir_all(&episode_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn clear_episode_panel_cache(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let episodes_dir = app_data_dir.join("episodes");

    if episodes_dir.exists() {
        std::fs::remove_dir_all(&episodes_dir).map_err(|e| e.to_string())?;
    }

    // Keep derush metadata in sync with episode cache cleanup.
    let conn = open_derush_db(&app)?;
    conn.execute_batch(
        r#"
        DELETE FROM derush_clip_categories;
        DELETE FROM derush_clips;
        DELETE FROM derush_categories;
        DELETE FROM derush_episodes;
        DELETE FROM derush_projects;
        "#,
    )
    .map_err(|e| format!("Failed clearing derush SQLite data: {e}"))?;

    Ok(())
}

// ============================================================================
// Commands: export clips
// ============================================================================

#[tauri::command]
async fn export_clips(
    app: AppHandle,
    clips: Vec<String>,
    save_path: String,
    merge_enabled: bool,
) -> Result<(), String> {
    if clips.is_empty() {
        return Ok(());
    }

    console_log(
        "EXPORT|start",
        &format!(
            "merge_enabled={} clips={} dest={}",
            merge_enabled,
            clips.len(),
            file_name_only(&save_path)
        ),
    );

    // Export uses FFmpeg.
    // - merge_enabled: prefer concat demuxer + stream copy (fast), with fallback to re-encode for compatibility
    // - else: per-clip export prefers stream copy when already AE-friendly, else re-encodes for compatibility
    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    let ffprobe = resolve_bundled_tool(&app, "ffprobe")?;

    let mut save_path = PathBuf::from(&save_path);
    let export_start_time = Instant::now();

    // If the user gave a path without an extension (or a template-ish name), default to mp4.
    if save_path.extension().is_none() {
        save_path.set_extension("mp4");
    }

    // Ensure destination directory exists for both merge and multi-export.
    if let Some(parent) = save_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    fn format_elapsed(start_time: Instant) -> String {
        let secs = start_time.elapsed().as_secs();
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;

        if h > 0 {
            format!("{:02}:{:02}:{:02}", h, m, s)
        } else {
            format!("{:02}:{:02}", m, s)
        }
    }

    fn emit_export_progress(app: &AppHandle, percent: u8, message: &str, start_time: Instant) {
        let p = percent.min(100);
        let msg = format!(
            "{} ({} elapsed)",
            message.replace('\n', " ").replace('\r', " "),
            format_elapsed(start_time)
        );

        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: p,
                message: msg,
            },
        );
    }

    async fn ffprobe_duration_ms(ffprobe: PathBuf, path: String) -> Result<Option<u64>, String> {
        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&ffprobe);
            apply_no_window(&mut cmd);
            let out = cmd
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=nk=1:nw=1",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

            if !out.status.success() {
                return Ok(None);
            }

            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                return Ok(None);
            }

            let secs: f64 = s
                .parse()
                .map_err(|_| "ffprobe duration parse failed".to_string())?;
            if !secs.is_finite() || secs <= 0.0 {
                return Ok(None);
            }
            Ok(Some((secs * 1000.0).round() as u64))
        })
        .await
        .map_err(|e| format!("ffprobe task panicked: {e}"))?
    }

    async fn ffprobe_codec_name(
        ffprobe: PathBuf,
        path: String,
        stream_selector: &'static str,
    ) -> Result<Option<String>, String> {
        tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&ffprobe);
            apply_no_window(&mut cmd);
            let out = cmd
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    stream_selector,
                    "-show_entries",
                    "stream=codec_name",
                    "-of",
                    "default=nk=1:nw=1",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe ({}): {e}", ffprobe.display()))?;

            if !out.status.success() {
                return Ok(None);
            }

            let s = String::from_utf8_lossy(&out.stdout)
                .trim()
                .to_ascii_lowercase();
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(s))
            }
        })
        .await
        .map_err(|e| format!("ffprobe task panicked: {e}"))?
    }

    async fn is_ae_copy_safe(ffprobe: PathBuf, clip_path: String) -> Result<bool, String> {
        // "Safe" here means: if we stream-copy, AE is likely to import.
        // We keep it conservative: H.264 video and AAC-or-no-audio.
        let v = ffprobe_codec_name(ffprobe.clone(), clip_path.clone(), "v:0").await?;
        if v.as_deref() != Some("h264") {
            return Ok(false);
        }
        let a = ffprobe_codec_name(ffprobe, clip_path, "a:0").await?;
        Ok(a.is_none() || a.as_deref() == Some("aac"))
    }

    fn run_ffmpeg_with_progress(
        app: AppHandle,
        ffmpeg: PathBuf,
        mut args: Vec<String>,
        total_ms: Option<u64>,
        completed_ms: u64,
        grand_total_ms: Option<u64>,
        message_prefix: &str,
        start_time: Instant,
    ) -> Result<(), String> {
        // Force progress to stderr so we can parse it (while still receiving real errors).
        // Note: ffmpeg writes key=value lines like out_time_ms=..., progress=continue/end.
        args.insert(0, "-hide_banner".into());
        args.insert(0, "-nostats".into());
        args.insert(0, "pipe:2".into());
        args.insert(0, "-progress".into());

        let mut cmd = Command::new(&ffmpeg);
        apply_no_window(&mut cmd);
        let mut child = cmd
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn ffmpeg ({}): {e}", ffmpeg.display()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture ffmpeg stderr")?;
        let reader = BufReader::new(stderr);

        let mut stderr_accum = String::new();
        let mut last_emit = Instant::now() - Duration::from_secs(5);
        let mut last_percent: Option<u8> = None;

        for line in reader.lines().flatten() {
            stderr_accum.push_str(&line);
            stderr_accum.push('\n');

            let line_trim = line.trim();
            if let Some(v) = line_trim.strip_prefix("out_time_ms=") {
                if let Ok(_out_ms) = v.parse::<u64>() {
                    // Show elapsed time since start
                    let elapsed = start_time.elapsed();
                    let secs = elapsed.as_secs();
                    let h = secs / 3600;
                    let m = (secs % 3600) / 60;
                    let s = secs % 60;
                    let elapsed_str = if h > 0 {
                        format!("{:02}:{:02}:{:02}", h, m, s)
                    } else {
                        format!("{:02}:{:02}", m, s)
                    };
                    let progress_msg = format!("{message_prefix} ({} elapsed)", elapsed_str);

                    // percent is still calculated for the progress bar
                    let denom_ms = grand_total_ms.or(total_ms).unwrap_or(0);
                    let overall_ms =
                        completed_ms.saturating_add(_out_ms.min(total_ms.unwrap_or(_out_ms)));
                    let mut percent = if denom_ms > 0 {
                        ((overall_ms as f64 / denom_ms as f64) * 100.0).floor() as i32
                    } else {
                        0
                    };
                    percent = percent.clamp(0, 99);
                    let p = percent as u8;

                    let should_emit =
                        last_percent != Some(p) || last_emit.elapsed() > Duration::from_secs(1);

                    if should_emit {
                        last_emit = Instant::now();
                        last_percent = Some(p);

                        let _ = app.emit(
                            "scene_progress",
                            ProgressPayload {
                                percent: p,
                                message: progress_msg,
                            },
                        );
                    }
                }
            }

            if line_trim == "progress=end" {
                break;
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;

        if !status.success() {
            // On failure, dump ffmpeg stderr to console (screenshot-friendly).
            let mut err = stderr_accum.clone();

            // Best-effort redact input/output paths down to filenames.
            let mut inputs: Vec<String> = Vec::new();
            for i in 0..args.len().saturating_sub(1) {
                if args[i] == "-i" {
                    inputs.push(args[i + 1].clone());
                }
            }
            let output = args.last().cloned();
            for p in inputs.into_iter().chain(output.into_iter()) {
                let base = file_name_only(&p);
                if !p.is_empty() && p != base {
                    err = err.replace(&p, &base);
                }
            }

            console_log(
                "FFMPEG|failed",
                &format!("{} status={}", ffmpeg.display(), status),
            );
            for l in err.lines() {
                if !l.trim().is_empty() {
                    console_log("FFMPEG", l);
                }
            }

            let err = err.trim().to_string();
            return Err(if err.is_empty() {
                format!("FFmpeg failed ({})", ffmpeg.display())
            } else {
                err
            });
        }

        // Successful run; emit a small step forward (caller may emit 100 at the end).
        let _ = app.emit(
            "scene_progress",
            ProgressPayload {
                percent: 80,
                message: format!("{message_prefix}"),
            },
        );

        Ok(())
    }

    fn ffmpeg_reencode_ae_args(input: &str, output: &str) -> Vec<String> {
        // Timestamp normalization + re-encode to broadly compatible H.264/AAC MP4.
        // This avoids common NLE import issues (black frames, odd timebases, missing PTS).
        vec![
            "-y",
            "-i",
            input,
            "-fflags",
            "+genpts",
            "-avoid_negative_ts",
            "make_zero",
            // Video
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "high",
            "-level",
            "4.1",
            "-preset",
            "medium",
            "-crf",
            "18",
            // Audio
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            // MP4 faststart
            "-movflags",
            "+faststart",
            // Avoid rare muxing queue overflows on tricky inputs.
            "-max_muxing_queue_size",
            "1024",
            output,
        ]
        .into_iter()
        .map(|s| s.to_string())
        .collect()
    }

    if merge_enabled {
        // ---------------- MERGE ----------------

        use std::io::Write;
        use tempfile::NamedTempFile;

        emit_export_progress(&app, 0, "Merging clips...", export_start_time);

        let out_str = save_path.to_str().ok_or("Invalid output path")?.to_string();

        // Best-effort total duration for progress.
        emit_export_progress(&app, 25, "Probing durations...", export_start_time);
        let mut total_ms: Option<u64> = Some(0);
        for c in &clips {
            match ffprobe_duration_ms(ffprobe.clone(), c.clone()).await {
                Ok(Some(ms)) => {
                    if let Some(t) = total_ms {
                        total_ms = Some(t.saturating_add(ms));
                    }
                }
                _ => {
                    total_ms = None;
                    break;
                }
            }
        }

        // Write file list for ffmpeg concat demuxer
        emit_export_progress(&app, 40, "Preparing file list...", export_start_time);
        let mut filelist =
            NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {e}"))?;
        for c in &clips {
            // ffmpeg concat demuxer requires each line: file 'path'
            // Escape single quotes in paths
            let safe_path = c.replace("'", "'\\''");
            writeln!(filelist, "file '{}'", safe_path)
                .map_err(|e| format!("Failed to write to temp file: {e}"))?;
        }
        let filelist_path = filelist.path().to_string_lossy().to_string();

        emit_export_progress(&app, 50, "Merging...", export_start_time);

        let args = vec![
            "-y".into(),
            "-f".into(),
            "concat".into(),
            "-safe".into(),
            "0".into(),
            "-i".into(),
            filelist_path.clone(),
            // Video/audio re-encode for compatibility
            "-fflags".into(),
            "+genpts".into(),
            "-avoid_negative_ts".into(),
            "make_zero".into(),
            "-c:v".into(),
            "libx264".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-profile:v".into(),
            "high".into(),
            "-level".into(),
            "4.1".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "18".into(),
            "-movflags".into(),
            "+faststart".into(),
            "-max_muxing_queue_size".into(),
            "1024".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ar".into(),
            "48000".into(),
            "-ac".into(),
            "2".into(),
            out_str.clone(),
        ];

        let app_for_ffmpeg = app.clone();
        let ffmpeg_clone = ffmpeg.clone();
        let total_ms_f = total_ms;
        let start_time = export_start_time;
        let out = tokio::task::spawn_blocking(move || {
            run_ffmpeg_with_progress(
                app_for_ffmpeg,
                ffmpeg_clone,
                args,
                total_ms_f,
                0,
                total_ms_f,
                "Merging",
                start_time,
            )
        })
        .await
        .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

        if let Err(e) = out {
            console_log(
                "ERROR|export_clips",
                &format!("merge failed: {}", sanitize_for_console(&e)),
            );
            return Err(format!("FFmpeg merge failed: {e}"));
        }

        emit_export_progress(&app, 100, "Export complete", export_start_time);
    } else {
        // ---------------- MULTIPLE EXPORT ----------------

        // In merge-disabled mode, the frontend passes a *file path* chosen via a Save dialog.
        // We treat it as a naming template: <user_stem>_<clip_code>.<ext>
        let destination_dir = save_path.parent().ok_or("Invalid save path")?;
        let user_stem = save_path
            .file_stem()
            .ok_or("Invalid filename")?
            .to_string_lossy()
            .to_string();

        let ext = save_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4")
            .to_string();

        // Probe durations once to produce smooth overall progress.
        emit_export_progress(&app, 5, "Probing clip info...", export_start_time);
        let mut per_ms: Vec<Option<u64>> = Vec::with_capacity(clips.len());
        let mut total_ms: Option<u64> = Some(0);
        // Pre-cache codec info alongside durations to avoid redundant ffprobe calls per clip.
        let mut per_copy_safe: Vec<bool> = Vec::with_capacity(clips.len());
        for c in &clips {
            let d = ffprobe_duration_ms(ffprobe.clone(), c.clone())
                .await
                .ok()
                .flatten();
            per_ms.push(d);
            if let (Some(t), Some(ms)) = (total_ms, d) {
                total_ms = Some(t.saturating_add(ms));
            } else {
                total_ms = None;
            }
            let safe = is_ae_copy_safe(ffprobe.clone(), c.clone())
                .await
                .unwrap_or(false);
            per_copy_safe.push(safe);
        }

        let mut done_ms: u64 = 0;
        for (i, clip) in clips.iter().enumerate() {
            let clip_path = Path::new(clip);
            let clip_stem = clip_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");

            let clip_code = clip_stem
                .rsplit('_')
                .next()
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| "0000");

            // If the code isn't purely digits (unexpected naming), fall back to index.
            let code = if clip_code.chars().all(|c| c.is_ascii_digit()) {
                clip_code.to_string()
            } else {
                format!("{:04}", i)
            };

            // Support the frontend's `####` placeholder: `base_####.mp4` -> `base_0001.mp4`.
            // If not present, fall back to `base_<code>.mp4`.
            let file_stem = if user_stem.contains("####") {
                user_stem.replace("####", &code)
            } else {
                format!("{}_{}", user_stem, code)
            };

            let destination = destination_dir.join(format!("{}.{}", file_stem, ext));

            let input_str = clip_path.to_str().ok_or("Invalid clip path")?;
            let output_str = destination.to_str().ok_or("Invalid destination path")?;

            let msg = format!("Exporting clip {}/{}", i + 1, clips.len());
            emit_export_progress(&app, 10, &msg, export_start_time);

            // Use pre-cached codec info instead of re-probing each clip.
            let copy_ok = per_copy_safe.get(i).copied().unwrap_or(false);
            let clip_total = per_ms.get(i).copied().flatten();

            let (mode_msg, args) = if copy_ok {
                (
                    format!("{msg} (copy)"),
                    vec![
                        "-y".into(),
                        "-i".into(),
                        input_str.into(),
                        "-fflags".into(),
                        "+genpts".into(),
                        "-avoid_negative_ts".into(),
                        "make_zero".into(),
                        "-c".into(),
                        "copy".into(),
                        "-movflags".into(),
                        "+faststart".into(),
                        output_str.into(),
                    ],
                )
            } else {
                (
                    format!("{msg} (re-encode)"),
                    ffmpeg_reencode_ae_args(input_str, output_str),
                )
            };

            console_log(
                "EXPORT|clip",
                &format!(
                    "{}/{} input={} output={} mode={}",
                    i + 1,
                    clips.len(),
                    file_name_only(input_str),
                    file_name_only(output_str),
                    if copy_ok { "copy" } else { "re-encode" }
                ),
            );

            let app_for_ffmpeg = app.clone();
            let ffmpeg_clone = ffmpeg.clone();
            let grand_total = total_ms;
            let done_before = done_ms;
            let run_msg = mode_msg.clone();
            let run_args = args;
            let start_time = export_start_time;
            let result = tokio::task::spawn_blocking(move || {
                run_ffmpeg_with_progress(
                    app_for_ffmpeg,
                    ffmpeg_clone,
                    run_args,
                    clip_total,
                    done_before,
                    grand_total,
                    &run_msg,
                    start_time,
                )
            })
            .await
            .map_err(|e| format!("ffmpeg task panicked: {e}"))?;

            if let Err(e) = result {
                // If copy failed, retry re-encode automatically.
                if copy_ok {
                    console_log(
                        "EXPORT|retry",
                        &format!(
                            "clip {}/{} stream copy failed; retry re-encode (input={} output={})",
                            i + 1,
                            clips.len(),
                            file_name_only(input_str),
                            file_name_only(output_str)
                        ),
                    );
                    emit_export_progress(
                        &app,
                        15,
                        "Stream copy failed; re-encoding...",
                        export_start_time,
                    );
                    let app_for_ffmpeg = app.clone();
                    let ffmpeg_clone = ffmpeg.clone();
                    let grand_total = total_ms;
                    let done_before = done_ms;
                    let run_msg = format!("{msg} (re-encode)");
                    let run_args = ffmpeg_reencode_ae_args(input_str, output_str);
                    let start_time = export_start_time;
                    let result2 = tokio::task::spawn_blocking(move || {
                        run_ffmpeg_with_progress(
                            app_for_ffmpeg,
                            ffmpeg_clone,
                            run_args,
                            clip_total,
                            done_before,
                            grand_total,
                            &run_msg,
                            start_time,
                        )
                    })
                    .await
                    .map_err(|e| format!("ffmpeg task panicked: {e}"))?;
                    if let Err(e2) = result2 {
                        console_log(
                            "ERROR|export_clips",
                            &format!(
                                "export failed clip {}/{} input={} output={}",
                                i + 1,
                                clips.len(),
                                file_name_only(input_str),
                                file_name_only(output_str)
                            ),
                        );
                        return Err(format!(
                            "FFmpeg export failed.\n(copy)\n{e}\n\n(re-encode)\n{e2}"
                        ));
                    }
                } else {
                    console_log(
                        "ERROR|export_clips",
                        &format!(
                            "export failed clip {}/{} input={} output={}",
                            i + 1,
                            clips.len(),
                            file_name_only(input_str),
                            file_name_only(output_str)
                        ),
                    );
                    return Err(format!("FFmpeg export failed: {e}"));
                }
            }

            if let Some(ms) = clip_total {
                done_ms = done_ms.saturating_add(ms);
            }
        }

        emit_export_progress(&app, 100, "Export complete", export_start_time);
    }

    console_log("EXPORT|end", "ok");

    Ok(())
}

// ============================================================================
// Commands: preview proxy generation
// ============================================================================

#[tauri::command]
async fn hover_preview_error(
    clip_id: String,
    clip_path: String,
    error_code: Option<u16>,
) -> Result<(), String> {
    // Minimal implementation: just log. The frontend uses this to detect
    // unsupported codecs (e.g., HEVC) and we will add proxy generation later.
    let clip_id = clip_id.replace('\n', " ").replace('\r', " ");
    let clip_path = clip_path.replace('\n', " ").replace('\r', " ");
    println!(
        "hover_preview_error|clip_id={}|clip_path={}|error_code={:?}",
        clip_id, clip_path, error_code
    );

    Ok(())
}

#[tauri::command]
async fn ensure_preview_proxy(
    app: AppHandle,
    proxy_locks: State<'_, PreviewProxyLocks>,
    clip_path: String,
) -> Result<String, String> {
    // Serialize proxy generation per clip to avoid partially-written proxies being served.
    let clip_key = clip_path.clone();
    let clip_lock = {
        let mut map = proxy_locks.inner.lock().await;
        // Evict stale entries (no other task holds a reference) to prevent unbounded growth.
        map.retain(|_, v| Arc::strong_count(v) > 1);
        map.entry(clip_key.clone())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    };
    let _guard = clip_lock.lock().await;

    let ffmpeg = resolve_bundled_tool(&app, "ffmpeg")?;
    console_log(
        "PROXY|start",
        &format!(
            "clip={} ffmpeg={}",
            file_name_only(&clip_path),
            ffmpeg.display()
        ),
    );

    let input_path = PathBuf::from(&clip_path);
    if !input_path.exists() {
        return Err(format!("Clip not found: {}", input_path.display()));
    }

    let parent = input_path
        .parent()
        .ok_or("Invalid clip path (no parent directory)")?;

    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid clip filename")?;

    let proxy_path = parent.join(format!("{stem}.preview.mp4"));
    let proxy_tmp_path = parent.join(format!("{stem}.preview.tmp.mp4"));

    // If proxy already exists and is non-empty, reuse it.
    if let Ok(meta) = std::fs::metadata(&proxy_path) {
        if meta.is_file() && meta.len() > 0 {
            return Ok(proxy_path.to_string_lossy().to_string());
        }
    }

    // Clean up any stale temp file from a previous failed/aborted run.
    let _ = std::fs::remove_file(&proxy_tmp_path);

    // Run FFmpeg in a blocking task.
    let ffmpeg_clone = ffmpeg.clone();
    let input = input_path.clone();
    let output = proxy_tmp_path.clone();

    let ffmpeg_output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&ffmpeg_clone);
        apply_no_window(&mut cmd);
        cmd.args([
            "-y",
            "-i",
            input
                .to_str()
                .ok_or_else(|| "Invalid input path".to_string())?,
            // Map video and optional audio.
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            // Video: H.264
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            // Audio: AAC (best HTML5 compatibility)
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            // Make MP4 streamable
            "-movflags",
            "+faststart",
            output
                .to_str()
                .ok_or_else(|| "Invalid output path".to_string())?,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))
    })
    .await
    .map_err(|e| format!("ffmpeg task panicked: {e}"))??;

    if !ffmpeg_output.status.success() {
        let _ = std::fs::remove_file(&proxy_tmp_path);
        let mut stderr = String::from_utf8_lossy(&ffmpeg_output.stderr).to_string();

        // Best-effort redact the known input/output paths.
        let in_full = input_path.to_string_lossy().to_string();
        let in_base = file_name_only(&in_full);
        if in_full != in_base {
            stderr = stderr.replace(&in_full, &in_base);
        }
        let out_full = proxy_tmp_path.to_string_lossy().to_string();
        let out_base = file_name_only(&out_full);
        if out_full != out_base {
            stderr = stderr.replace(&out_full, &out_base);
        }
        stderr = stderr.trim().to_string();

        if !stderr.is_empty() {
            console_log("ERROR|proxy", &stderr);
        } else {
            console_log("ERROR|proxy", "FFmpeg proxy encode failed");
        }
        return Err(if stderr.is_empty() {
            "FFmpeg proxy encode failed".to_string()
        } else {
            format!("FFmpeg proxy encode failed: {stderr}")
        });
    }

    // Verify tmp proxy exists.
    let meta = std::fs::metadata(&proxy_tmp_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&proxy_tmp_path);
        return Err("Proxy encode produced empty file".to_string());
    }

    // Atomically publish: rename tmp -> final. (On Windows, remove target first.)
    match std::fs::remove_file(&proxy_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to remove existing proxy: {e}")),
    }

    if let Err(e) = std::fs::rename(&proxy_tmp_path, &proxy_path) {
        // Fallback for any odd rename edge-case.
        std::fs::copy(&proxy_tmp_path, &proxy_path)
            .map_err(|copy_err| format!("Failed to publish proxy (rename={e}, copy={copy_err})"))?;
        let _ = std::fs::remove_file(&proxy_tmp_path);
    }

    let final_path = proxy_path.to_string_lossy().to_string();
    console_log(
        "PROXY|end",
        &format!("ok proxy={}", file_name_only(&final_path)),
    );
    Ok(final_path)
}

fn resolve_bundled_tool(app: &AppHandle, tool_name: &str) -> Result<PathBuf, String> {
    // Resolve a bundled tool (ffmpeg/ffprobe) across common resource paths.
    let exe_name = format!("{tool_name}.exe");

    // 1) Common bundled location: resources/bin/<tool>.exe
    if let Ok(p) = app.path().resolve(
        format!("bin/{exe_name}"),
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return Ok(p);
        }
    }

    // 2) Alternative location if only backend internal <tool> is bundled
    if let Ok(p) = app.path().resolve(
        format!("bin/backend_script-x86_64-pc-windows-msvc/_internal/{exe_name}"),
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return Ok(p);
        }
    }

    // 3) Dev fallback: walk upward looking for ./bin/<tool>.exe
    // Prefer the backend_script _internal tools (they include more codecs, e.g. software HEVC)
    // over the plain ./bin/<tool>.exe.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(mut dir) = exe.parent().map(|p| p.to_path_buf()) {
        for _ in 0..5 {
            let internal_candidate = dir
                .join("bin")
                .join("backend_script-x86_64-pc-windows-msvc")
                .join("_internal")
                .join(&exe_name);
            if internal_candidate.exists() {
                return Ok(internal_candidate);
            }

            let candidate = dir.join("bin").join(&exe_name);
            if candidate.exists() {
                return Ok(candidate);
            }
            if !dir.pop() {
                break;
            }
        }
    }

    Err(format!(
        "{exe_name} not found (looked in resources/bin, backend _internal, and dev src-tauri/bin)"
    ))
}

fn main() {
    // Keep setup small and obvious: plugins, shared state, commands, then run.
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PreviewProxyLocks::default())
        .manage(ActiveSidecar::default())
        .invoke_handler(tauri::generate_handler![
            sync_derush_episode,
            create_derush_category,
            set_derush_clip_category,
            update_derush_category,
            delete_derush_category,
            detect_scenes,
            abort_detect_scenes,
            export_clips,
            check_hevc,
            hover_preview_error,
            ensure_preview_proxy,
            delete_episode_cache,
            clear_episode_panel_cache,
            save_background_image,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
