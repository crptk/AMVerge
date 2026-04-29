use tauri::{AppHandle, Emitter};

use crate::payloads::ConsoleLogPayload;

pub fn sanitize_for_console(s: &str) -> String {
    // Keep it single-line and screenshot friendly.
    s.replace('\r', " ").replace('\n', " ")
}

pub fn emit_console_log(app: &AppHandle, source: &str, level: &str, message: &str) {
    let message = sanitize_for_console(message);

    println!("AMVERGE|{}|{}|{}", source, level, message);

    let _ = app.emit(
        "console_log",
        ConsoleLogPayload {
            source: source.to_string(),
            level: level.to_string(),
            message,
        },
    );
}

pub fn console_log(tag: &str, msg: &str) {
    let tag = sanitize_for_console(tag);
    let msg = sanitize_for_console(msg);
    println!("AMVERGE|{}|{}", tag, msg);
}

pub fn sanitize_line_with_known_paths(
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
