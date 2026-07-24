//! Disk persistence for Zukai documents.
//!
//! Zukai saves its own YAML (the `.zkai` format), versioned by
//! [`SCHEMA_VERSION`](crate::model::SCHEMA_VERSION). Serialization lives here on
//! the Rust side because `serde_yaml` plus the model's serde attributes are the
//! single source of truth for the on-disk shape — a second (JS) encoder would
//! drift. The document crosses the IPC boundary as JSON (Tauri marshals JS↔serde
//! via `serde_json`); YAML is used *only* for the file body written/read here.

use std::fs;

use serde::Deserialize;

use crate::model::{Document, SCHEMA_VERSION};

/// Serialize the document to Zukai YAML and write it to `path`.
#[tauri::command]
pub fn save_document(path: String, doc: Document) -> Result<(), String> {
    let yaml = serde_yaml::to_string(&doc).map_err(|e| e.to_string())?;
    fs::write(&path, yaml).map_err(|e| e.to_string())
}

/// Just enough of a `.zkai` file to read its version without committing to the
/// full model — so a newer file yields a friendly message rather than a raw
/// serde error deep inside `Document`.
#[derive(Deserialize)]
struct VersionProbe {
    schema_version: u32,
}

/// Read a `.zkai` file, check its schema version, then deserialize the full
/// [`Document`].
///
/// The version is probed first (see [`VersionProbe`]): a file made by a *newer*
/// Zukai is rejected with a clear message. No older versions exist yet, so there
/// is no migration path — an equal-or-older version falls through to the full
/// deserialize.
#[tauri::command]
pub fn load_document(path: String) -> Result<Document, String> {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let probe: VersionProbe = serde_yaml::from_str(&text).map_err(|e| e.to_string())?;
    if probe.schema_version > SCHEMA_VERSION {
        return Err(format!(
            "This file was made by a newer version of Zukai (schema version {}, \
             this build supports up to {}). Please update Zukai to open it.",
            probe.schema_version, SCHEMA_VERSION
        ));
    }
    serde_yaml::from_str(&text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::model::graph::{Lane, Link, Node, NodeKind};

    /// A small document exercising the node/link/lane collections — enough to
    /// prove the collections survive a real file round-trip.
    fn sample() -> Document {
        let mut doc = Document::new("Round-trip");
        doc.nodes = vec![
            Node {
                id: "N1".into(),
                kind: NodeKind::Endpoint,
            },
            Node {
                id: "N2".into(),
                kind: NodeKind::Endpoint,
            },
        ];
        doc.links = vec![Link {
            id: "L1".into(),
            from_node: "N1".into(),
            to_node: "N2".into(),
            lanes: vec![Lane {
                id: 0,
                width: 3.5,
                speed_limit: 13.888_888_888_888_89,
                allowed_classes: vec![],
                kind: None,
            }],
            median_gap: 0.5,
        }];
        doc
    }

    #[test]
    fn round_trips_through_a_file() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("round-trip.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        let doc = sample();
        save_document(path_str.clone(), doc.clone()).expect("save");
        let back = load_document(path_str).expect("load");

        assert_eq!(doc, back);
    }

    #[test]
    fn empty_document_round_trips() {
        // A nodes-less document (all collections empty) must still save and load
        // on the Rust side. The frontend's own empty-doc guard is Phase 2.
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("empty.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        let doc = Document::new("Untitled");
        save_document(path_str.clone(), doc.clone()).expect("save");
        let back = load_document(path_str).expect("load");

        assert_eq!(doc, back);
    }

    #[test]
    fn rejects_a_newer_schema_version() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("future.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        fs::write(
            &path,
            "schema_version: 2\nmetadata:\n  name: From the future\n",
        )
        .expect("write");

        let err = load_document(path_str).expect_err("newer file must be rejected");
        // The friendly message, not a raw serde error.
        assert!(
            err.contains("newer version"),
            "expected a friendly newer-version message, got: {err}"
        );
    }
}
