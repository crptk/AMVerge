use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

pub struct ActiveSidecar {
    pub pid: Mutex<Option<u32>>,
    pub child: Mutex<Option<std::process::Child>>,
}

impl Default for ActiveSidecar {
    fn default() -> Self {
        Self {
            pid: Mutex::new(None),
            child: Mutex::new(None),
        }
    }
}

/// Per-output-path locks that serialize duplicate proxy/WebP encode requests.
/// Wrapped in an `Arc` so the map can be cloned cheaply and shared into the
/// concurrent WebP encode tasks spawned by `generate_scene_webp_batch`.
pub type ProxyLockMap = Arc<AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>>;

#[derive(Default)]
pub struct PreviewProxyLocks {
    pub inner: ProxyLockMap,
}

#[derive(Default)]
pub struct DiscordRPCState {
    pub child: Mutex<Option<std::process::Child>>,
}

#[derive(Default)]
pub struct EditorImportAbortState {
    pub abort_requested: AtomicBool,
}

#[derive(Default)]
pub struct ExportAbortState {
    pub abort_requested: Arc<AtomicBool>,
    pub pids: Arc<Mutex<Vec<u32>>>,
}

#[derive(Default)]
pub struct ActiveFfmpegPids {
    pub pids: Arc<Mutex<Vec<u32>>>,
}
