//! The recently opened/saved document list.
//!
//! App state rather than document state, so it lives beside the app's own
//! config (`recent.json` in the platform config directory) instead of in any
//! `.zkai` file. Like the rest of Zukai's disk access it stays on the Rust side
//! (see [`crate::persist`]), which keeps `tauri-plugin-fs` out of the frontend's
//! permission surface.
//!
//! Recents are **best-effort**: a missing or unreadable store reads as an empty
//! list rather than failing the save or open that touched it.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Name of the store inside the app config directory.
const STORE_FILE: &str = "recent.json";

/// How many paths to remember.
const MAX_RECENT: usize = 10;

/// Path of the recents store, creating the config directory if it is missing.
fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STORE_FILE))
}

/// Read the stored list. Absent, unreadable, or malformed all read as empty —
/// a broken recents file must never block opening a document.
fn read(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write(path: &Path, list: &[String]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// `path` moved to the front, duplicates dropped, capped at `max`.
fn promote(list: Vec<String>, path: &str, max: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(list.len() + 1);
    out.push(path.to_string());
    out.extend(list.into_iter().filter(|p| p != path));
    out.truncate(max);
    out
}

/// Drop entries whose file is gone, so a document deleted or moved outside
/// Zukai stops being offered.
fn prune(list: Vec<String>) -> Vec<String> {
    list.into_iter().filter(|p| Path::new(p).exists()).collect()
}

/// The remembered paths, most recent first, minus any that no longer exist.
#[tauri::command]
pub fn recent_files(app: AppHandle) -> Result<Vec<String>, String> {
    let store = store_path(&app)?;
    let stored = read(&store);
    let live = prune(stored.clone());
    if live != stored {
        write(&store, &live)?;
    }
    Ok(live)
}

/// Remember `path` as the most recent document, returning the updated list so
/// the caller never has to re-read the store.
#[tauri::command]
pub fn push_recent_file(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let store = store_path(&app)?;
    let list = promote(read(&store), &path, MAX_RECENT);
    write(&store, &list)?;
    Ok(list)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn strings(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn promote_puts_a_new_path_first() {
        let list = promote(strings(&["/a.zkai"]), "/b.zkai", MAX_RECENT);
        assert_eq!(list, strings(&["/b.zkai", "/a.zkai"]));
    }

    #[test]
    fn promote_moves_a_known_path_rather_than_duplicating_it() {
        let list = promote(
            strings(&["/a.zkai", "/b.zkai", "/c.zkai"]),
            "/c.zkai",
            MAX_RECENT,
        );
        assert_eq!(list, strings(&["/c.zkai", "/a.zkai", "/b.zkai"]));
    }

    #[test]
    fn promote_caps_the_list() {
        let mut list = Vec::new();
        for i in 0..MAX_RECENT + 5 {
            list = promote(list, &format!("/doc{i}.zkai"), MAX_RECENT);
        }
        assert_eq!(list.len(), MAX_RECENT);
        // Most recent first, oldest dropped off the end.
        assert_eq!(list[0], format!("/doc{}.zkai", MAX_RECENT + 4));
    }

    #[test]
    fn prune_drops_paths_that_no_longer_exist() {
        let dir = tempdir().expect("temp dir");
        let kept = dir.path().join("kept.zkai");
        fs::write(&kept, "schema_version: 1\n").expect("write");
        let gone = dir.path().join("gone.zkai");

        let list = prune(vec![
            gone.to_string_lossy().into_owned(),
            kept.to_string_lossy().into_owned(),
        ]);

        assert_eq!(list, vec![kept.to_string_lossy().into_owned()]);
    }

    #[test]
    fn read_round_trips_a_written_list_and_tolerates_a_broken_store() {
        let dir = tempdir().expect("temp dir");
        let store = dir.path().join(STORE_FILE);

        assert!(read(&store).is_empty(), "a missing store reads as empty");

        let list = strings(&["/b.zkai", "/a.zkai"]);
        write(&store, &list).expect("write");
        assert_eq!(read(&store), list);

        fs::write(&store, "not json at all").expect("write");
        assert!(read(&store).is_empty(), "a malformed store reads as empty");
    }
}
