//! Writing exported pictures to disk.
//!
//! The picture itself is built in the webview — it renders the same components
//! the canvas draws (`src/editor/export.tsx`), so there is no second renderer to
//! keep in sync and nothing here knows what SVG is. This module exists only
//! because the frontend cannot touch the filesystem: like [`crate::persist`] it
//! writes through our own command with [`std::fs`], which keeps
//! `tauri-plugin-fs` — and a filesystem permission scope — out of the app.

use std::fs;

/// Write UTF-8 text to `path`, replacing any existing file.
///
/// Deliberately format-agnostic: the caller decides what an export is and what
/// it is called (`exportDiagram`, `src/editor/files.ts`). The binary sibling for
/// PNG lands with the raster path.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn writes_text_that_reads_back_unchanged() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("diagram.svg");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"52\" height=\"52\"></svg>";
        write_text_file(path_str.clone(), svg.to_string()).expect("write");

        assert_eq!(fs::read_to_string(&path).expect("read"), svg);
    }

    #[test]
    fn overwrites_an_existing_file() {
        // Exporting twice to the same name must leave the second picture, not
        // the second appended to the first.
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("diagram.svg");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        write_text_file(path_str.clone(), "first".to_string()).expect("write");
        write_text_file(path_str, "second".to_string()).expect("overwrite");

        assert_eq!(fs::read_to_string(&path).expect("read"), "second");
    }

    #[test]
    fn reports_an_unwritable_path() {
        // A directory that does not exist is the everyday failure (a stale path
        // from the dialog's remembered folder); it must surface as an `Err`
        // string for the frontend to show, not a panic.
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("no-such-dir").join("diagram.svg");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        assert!(write_text_file(path_str, "x".to_string()).is_err());
    }
}
