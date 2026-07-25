mod export;
pub mod model;
mod persist;
mod recent;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            persist::save_document,
            persist::load_document,
            export::write_text_file,
            export::write_binary_file,
            recent::recent_files,
            recent::push_recent_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
