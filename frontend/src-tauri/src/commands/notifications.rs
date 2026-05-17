use serde::Serialize;
use tauri::AppHandle;

use crate::utils::logging::console_log;

const BUILD_NOTIFICATIONS_API_URL: Option<&str> = option_env!("AMVERGE_NOTIFICATIONS_API_URL");
const BUILD_ADMIN_API_URL: Option<&str> = option_env!("VITE_ADMIN_API_URL");
const BUILD_NOTIFICATIONS_API_KEY: Option<&str> = option_env!("AMVERGE_NOTIFICATIONS_API_KEY");
const BUILD_BUG_REPORT_API_KEY: Option<&str> = option_env!("AMVERGE_BUG_REPORT_API_KEY");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupNotification {
    pub id: String,
    pub target_version: Option<String>,
    pub title: String,
    pub body_markdown: String,
    pub banner_image_url: Option<String>,
    pub created_at: Option<String>,
}

fn read_config_var(runtime_key: &str, build_fallback: Option<&str>) -> Option<String> {
    std::env::var(runtime_key)
        .ok()
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| {
            build_fallback.and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
        })
}

fn resolve_notifications_endpoint(base: &str, app_version: Option<&str>) -> Result<String, String> {
    let mut url = reqwest::Url::parse(base)
        .map_err(|e| format!("Invalid notifications URL `{base}`: {e}"))?;

    let current_path = url.path().trim_end_matches('/').to_string();
    if current_path.is_empty() || current_path == "/" {
        url.set_path("/api/notifications/startup");
    } else if !current_path.ends_with("/api/notifications/startup") {
        let next = format!("{}/api/notifications/startup", current_path);
        url.set_path(&next);
    }

    if let Some(version) = app_version {
        let trimmed = version.trim();
        if !trimmed.is_empty() {
            url.query_pairs_mut().append_pair("version", trimmed);
        }
    }
    Ok(url.into())
}

fn get_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = value.get(*key) {
            if let Some(s) = v.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            } else if !v.is_null() {
                let as_text = v.to_string();
                if !as_text.is_empty() {
                    return Some(as_text.trim_matches('"').to_string());
                }
            }
        }
    }
    None
}

fn get_bool(value: &serde_json::Value, keys: &[&str], default_value: bool) -> bool {
    for key in keys {
        if let Some(v) = value.get(*key) {
            if let Some(b) = v.as_bool() {
                return b;
            }
            if let Some(s) = v.as_str() {
                let lowered = s.trim().to_ascii_lowercase();
                if lowered == "true" || lowered == "1" {
                    return true;
                }
                if lowered == "false" || lowered == "0" {
                    return false;
                }
            }
        }
    }
    default_value
}

fn normalize_version_for_match(version: &str) -> String {
    version
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string()
}

fn parse_notification_row(row: &serde_json::Value) -> Option<StartupNotification> {
    let id = get_string(row, &["id"])?;
    let title = get_string(row, &["title"])?;
    let body_markdown = get_string(row, &["bodyMarkdown", "body_markdown"])?;

    Some(StartupNotification {
        id,
        target_version: get_string(row, &["targetVersion", "target_version"]),
        title,
        body_markdown,
        banner_image_url: get_string(row, &["bannerImageUrl", "banner_image_url"]),
        created_at: get_string(row, &["createdAt", "created_at"]),
    })
}

#[tauri::command]
pub async fn fetch_startup_notification(app: AppHandle) -> Result<Option<StartupNotification>, String> {
    let base_url = read_config_var("AMVERGE_NOTIFICATIONS_API_URL", BUILD_NOTIFICATIONS_API_URL)
        .or_else(|| read_config_var("VITE_ADMIN_API_URL", BUILD_ADMIN_API_URL))
        .ok_or_else(|| "Startup notifications URL is not configured.".to_string())?;

    let app_version = app.package_info().version.to_string();
    let app_version_norm = normalize_version_for_match(&app_version);
    let app_version_with_v = format!("v{app_version}");

    let mut endpoint_candidates: Vec<String> = vec![
        resolve_notifications_endpoint(&base_url, Some(&app_version))?,
    ];
    if normalize_version_for_match(&app_version_with_v) == app_version_norm {
        endpoint_candidates.push(resolve_notifications_endpoint(&base_url, Some(&app_version_with_v))?);
    }
    endpoint_candidates.push(resolve_notifications_endpoint(&base_url, None)?);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to initialize notifications HTTP client: {e}"))?;

    let api_key = read_config_var("AMVERGE_NOTIFICATIONS_API_KEY", BUILD_NOTIFICATIONS_API_KEY)
        .or_else(|| read_config_var("AMVERGE_BUG_REPORT_API_KEY", BUILD_BUG_REPORT_API_KEY));

    let mut rows: Vec<serde_json::Value> = Vec::new();
    let mut last_error: Option<String> = None;

    for endpoint in endpoint_candidates {
        console_log("NOTIFY|fetch", &format!("version={app_version} endpoint={endpoint}"));

        let mut request = client.get(&endpoint).header("content-type", "application/json");
        if let Some(key) = &api_key {
            request = request.header("x-amverge-api-key", key);
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(format!("Failed to fetch startup notifications: {e}"));
                continue;
            }
        };

        if !response.status().is_success() {
            last_error = Some(format!(
                "Notifications endpoint returned HTTP {}",
                response.status().as_u16()
            ));
            continue;
        }

        let raw = match response.text().await {
            Ok(text) => text,
            Err(e) => {
                last_error = Some(format!("Failed to read notifications response body: {e}"));
                continue;
            }
        };

        let parsed_json: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                let snippet: String = raw.chars().take(220).collect();
                last_error = Some(format!(
                    "Failed to parse notifications response: {e}. Body starts with: {snippet}"
                ));
                continue;
            }
        };

        rows = if let Some(array) = parsed_json.get("notifications").and_then(|v| v.as_array()) {
            array.clone()
        } else if let Some(array) = parsed_json
            .get("data")
            .and_then(|v| v.get("notifications"))
            .and_then(|v| v.as_array())
        {
            array.clone()
        } else if let Some(object) = parsed_json.get("notification") {
            vec![object.clone()]
        } else if parsed_json.is_object() {
            vec![parsed_json.clone()]
        } else if let Some(array) = parsed_json.as_array() {
            array.clone()
        } else {
            Vec::new()
        };

        if !rows.is_empty() {
            break;
        }
    }

    if rows.is_empty() {
        if let Some(err) = last_error {
            return Err(err);
        }
        return Ok(None);
    }

    console_log("NOTIFY|rows", &format!("count={}", rows.len()));

    let matching = rows.into_iter().find_map(|row| {
        let is_active = get_bool(&row, &["isActive", "is_active"], true);
        if !is_active {
            return None;
        }

        let target_version = get_string(&row, &["targetVersion", "target_version"]);
        if target_version.as_deref().is_some_and(|v| {
            let target_norm = normalize_version_for_match(v);
            !target_norm.is_empty() && target_norm != app_version_norm
        }) {
            return None;
        }

        parse_notification_row(&row)
    });

    match matching {
        Some(notification) => {
            console_log(
                "NOTIFY|found",
                &format!("id={} version={app_version}", notification.id),
            );
            Ok(Some(notification))
        }
        None => {
            console_log("NOTIFY|none", &format!("version={app_version}"));
            Ok(None)
        }
    }
}
