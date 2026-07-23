//! Stable string identifiers for schematic entities.
//!
//! IDs are strings rather than integers so a document imported from an
//! Assimilator `network.yaml` keeps that file's original names (`N1`, `L3`,
//! `M_thru`, …) and can be re-exported with matching ids. Lane ids stay
//! numeric ([`LaneIdx`]) to match Assimilator, where lanes are `0, 1, …`.

use serde::{Deserialize, Serialize};

/// Index of a lane within a link, `0`-based, matching Assimilator's lane ids.
pub type LaneIdx = u32;

macro_rules! string_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            /// Borrow the underlying id string.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<&str> for $name {
            fn from(s: &str) -> Self {
                Self(s.to_string())
            }
        }

        impl From<String> for $name {
            fn from(s: String) -> Self {
                Self(s)
            }
        }
    };
}

string_id!(
    /// Identifies a [`Node`](super::graph::Node).
    NodeId
);
string_id!(
    /// Identifies a [`Link`](super::graph::Link).
    LinkId
);
string_id!(
    /// Identifies a [`Movement`](super::graph::Movement) within a junction.
    MovementId
);
string_id!(
    /// Identifies a signal [`Phase`](super::graph::Phase).
    PhaseId
);
string_id!(
    /// Identifies a [`Sign`](super::decoration::Sign).
    SignId
);
string_id!(
    /// Identifies a [`Marking`](super::decoration::Marking).
    MarkingId
);
