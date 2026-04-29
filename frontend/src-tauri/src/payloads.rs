use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub percent: u8,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct ConsoleLogPayload {
    pub source: String,
    pub level: String,
    pub message: String,
}