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

use crate::model::layout::JunctionGlyph;
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

/// Fold a retired glyph forward — **the project's first migration**, and the
/// reason there now is one.
///
/// `t_junction` left the vocabulary once the pad started following its arms: a
/// three-arm node draws as a T because it *has* three arms, so the variant named
/// a fact the arms already carry (junction glyphs §2.4). Removing a variant runs
/// the opposite way to adding one — an *older* file breaks a *newer* build, where
/// [`JunctionGlyph::Gore`] broke the reverse — and the version probe is no help
/// in this direction: a document carrying the retired spelling declares an
/// older-or-equal version, passes the probe, and then fails inside serde with no
/// useful message. So [`JunctionGlyph::TJunction`] stays in the enum as
/// load-only and is normalized away here instead.
///
/// **This costs no [`SCHEMA_VERSION`] bump**, which is a decision rather than an
/// oversight. The migration is what saves the old file, and a version-2 document
/// is still a valid version-2 document — the bump would buy only a label. Note
/// the asymmetry with a removed *field*, which needs nothing at all: nothing here
/// derives `deny_unknown_fields`, so serde ignores a stale key on the way in and
/// drops it on the way out. `JunctionView::rotation` left that way, in the same
/// pass, and the fixture this is tested against carries both.
fn migrate(doc: &mut Document) {
    for view in doc.layout.junctions.values_mut() {
        if view.glyph == JunctionGlyph::TJunction {
            view.glyph = JunctionGlyph::Generic;
        }
    }
}

/// Read a `.zkai` file, check its schema version, then deserialize the full
/// [`Document`].
///
/// The version is probed first (see [`VersionProbe`]): a file made by a *newer*
/// Zukai is rejected with a clear message. An equal-or-older version falls
/// through to the full deserialize and then to [`migrate`], which is where an
/// older file's retired spellings are folded forward.
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
    let mut doc: Document = serde_yaml::from_str(&text).map_err(|e| e.to_string())?;
    migrate(&mut doc);
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::model::graph::{Lane, Link, Node, NodeKind};
    use crate::model::ids::NodeId;

    /// A T written the way Zukai wrote one before the glyph was retired, read at
    /// compile time so deleting it fails the build rather than the test. See the
    /// README beside it for why it is hand-authored and must stay that way.
    const T_JUNCTION_GLYPH: &str = include_str!("../tests/fixtures/zkai/t-junction-glyph.zkai");

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
            length: None,
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

    /// The fixture has to stay **above** [`SCHEMA_VERSION`], and so moves with
    /// every bump. Left behind it the test silently stops testing anything: the
    /// probe would pass, and because every `Document` field but
    /// `schema_version`/`metadata` is `#[serde(default)]` the full parse would
    /// succeed too, so `expect_err` fails rather than the assertion.
    #[test]
    fn rejects_a_newer_schema_version() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("future.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        fs::write(
            &path,
            "schema_version: 3\nmetadata:\n  name: From the future\n",
        )
        .expect("write");

        let err = load_document(path_str).expect_err("newer file must be rejected");
        // The friendly message, not a raw serde error.
        assert!(
            err.contains("newer version"),
            "expected a friendly newer-version message, got: {err}"
        );
    }

    /// The other half of the bump: an *older* file is not rejected. Nothing in
    /// version 2 is a breaking change to a version-1 document — the `gore` glyph
    /// only added a variant — so there is no migration arm to exercise, and the
    /// evidence for that is simply that a v1 file loads.
    #[test]
    fn still_loads_a_version_1_file() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("older.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        fs::write(&path, "schema_version: 1\nmetadata:\n  name: From v1\n").expect("write");

        let doc = load_document(path_str).expect("a v1 file must still open");
        assert_eq!(doc.schema_version, 1);
        assert_eq!(doc.metadata.name, "From v1");
    }

    /// **The migration, and the phase's real proof.** A `.zkai` carrying the
    /// retired `t_junction` opens, comes back `generic`, and re-saves with no
    /// trace of it.
    ///
    /// Written against a committed **file** rather than a hand-built struct,
    /// because the failure being guarded is a *parse* failure: a struct cannot
    /// carry a spelling the vocabulary no longer offers, so it would exercise
    /// [`migrate`] while proving nothing about serde. Going through
    /// [`load_document`] is also what pins the probe's inability to help here —
    /// the file declares version 2, so it is accepted before serde ever runs.
    ///
    /// The same fixture carries a `rotation:` key, the field that left in the
    /// same pass, and the two assertions on the saved text are deliberately
    /// symmetric even though the mechanisms are not: the variant needed
    /// [`migrate`], the field needed nothing at all.
    #[test]
    fn a_zkai_with_the_retired_glyph_loads_as_generic_and_resaves_clean() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("t-junction-glyph.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();
        fs::write(&path, T_JUNCTION_GLYPH).expect("write");

        let doc = load_document(path_str).expect("a pre-retirement file must still open");

        // It parsed at all, which a bare variant removal would not have allowed…
        assert_eq!(doc.layout.junctions.len(), 1);
        let view = doc.layout.junctions[&NodeId::from("J")];
        // …and the retired glyph is gone by the time the frontend could see it,
        // whose own union no longer spells it.
        assert_eq!(view.glyph, JunctionGlyph::Generic);
        assert_eq!(view.scale, 1.0);
        // Nothing else about the document moved.
        assert_eq!(doc.nodes.len(), 4);
        assert_eq!(doc.links.len(), 3);

        let out = dir.path().join("resaved.zkai");
        let out_str = out.to_str().expect("utf-8 path").to_string();
        save_document(out_str, doc).expect("save");
        let text = fs::read_to_string(&out).expect("read back");

        assert!(!text.contains("t_junction"), "{text}");
        assert!(!text.contains("rotation"), "{text}");
        // And the vocabulary narrowing does **not** move the version: the
        // migration is what saves the old file, and a version-2 document is still
        // a valid version-2 document, so a bump would buy only a label.
        assert_eq!(SCHEMA_VERSION, 2);
        assert!(text.contains("schema_version: 2"), "{text}");
    }

    /// …and what this build writes declares the current version, so the file a
    /// user saves today is refused by the builds that cannot read its glyphs.
    #[test]
    fn saves_at_the_current_schema_version() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("current.zkai");
        let path_str = path.to_str().expect("utf-8 path").to_string();

        save_document(path_str, Document::new("Current")).expect("save");
        let text = fs::read_to_string(&path).expect("read back");

        assert_eq!(SCHEMA_VERSION, 2);
        assert!(
            text.contains("schema_version: 2"),
            "expected the current schema version in {text:?}"
        );
    }
}
