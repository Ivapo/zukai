// The desktop-only modules: `export` and `recent` are `fs::write` and a JSON
// list in the app data directory, so compiling them to wasm would be compiling
// a filesystem that does not exist (`specs/web_demo_spec.md` §2.5).
#[cfg(not(target_arch = "wasm32"))]
mod export;
pub mod model;
// Private again as of the import command: Phase 1 needed `pub` only because
// nothing in the binary called into `network`, which left every item unreachable
// from the crate root and failed `cargo clippy --all-targets -- -D warnings` on
// `dead_code`. `import_network` is now that caller.
mod network;
// Gated for wasm32 **in zk-015 Phase 2 only, and un-gated in Phase 3**: with
// both its commands out, `migrate` and `VersionProbe` are unreachable and the
// wasm build warns `dead_code`. Phase 3 extracts a pure `encode`/`decode` pair
// that the wasm shell calls, which is what makes the module live again.
#[cfg(not(target_arch = "wasm32"))]
mod persist;
#[cfg(not(target_arch = "wasm32"))]
mod recent;
// The browser's one entry into the crate.
#[cfg(target_arch = "wasm32")]
mod wasm;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(not(target_arch = "wasm32"))]
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(not(target_arch = "wasm32"))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            persist::save_document,
            persist::load_document,
            network::import::import_network,
            network::import::import_network_text,
            export::write_text_file,
            export::write_binary_file,
            recent::recent_files,
            recent::push_recent_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
