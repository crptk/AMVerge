use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub struct ActiveSidecar {
    pub pid: Mutex<Option<u32>>,
}

#[derive(Default)]
pub struct PreviewProxyLocks {
    pub inner: AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

#[derive(Default)]
pub struct DiscordRPCState {
    pub child: Mutex<Option<std::process::Child>>,
}

#[derive(Default)]
pub struct EditorImportAbortState {
    pub abort_requested: AtomicBool,
}
