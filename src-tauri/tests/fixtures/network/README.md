# `network.yaml` fixtures

Real Assimilator scenario networks, committed so `cargo test` can exercise
Zukai's reader without either repo depending on the other. **Copies, not
symlinks** — the point is that these are the bytes Zukai claims to read, frozen
on a known date, so a change to Assimilator's exporter shows up as a *test
change* rather than as a silently different fixture.

| File | Copied from | Read on | Assimilator commit |
|---|---|---|---|
| `t_junction.yaml` | `../assimilator/demo/dist/scenarios/t_junction/network.yaml` | 2026-07-26 | `d79c32d` |
| `cross-4.yaml` | `../assimilator/demo/dist/scenarios/cross-4/network.yaml` | 2026-07-26 | `d79c32d` |

Byte-for-byte copies; only the filename changed (`<scenario>/network.yaml` →
`<scenario>.yaml`), because two files of the same name cannot sit in one
directory.

## Why these two

Between them they exercise every trap `specs/network_yaml_spec.md` §2.3 found,
which is the reason there are two rather than one:

- **`t_junction`** — 4 nodes, 3 links, 1 unsignalized junction with `rule:
  priority` and 2 movements. The only fixture carrying `priority: minor` and
  `yields_to`, the pair whose loss would export a give-way junction in which
  nothing gives way (§2.3.1). Also carries `detectors:` and per-junction
  `conflict_pairs` / `gap_acceptance` / `geometry.setback`, all of which Zukai
  drops (§2.8) — so it is also the fixture that proves dropping them parses.
- **`cross-4`** — 5 nodes, 8 links (four bidirectional pairs, 2 lanes each), 1
  **signalized** junction with a `signal_plan` (2 phases, 60 s cycle) and 16
  movements, four of them u-turns written `from_lanes: []` / `to_lanes: []`. The
  empty-list case that must round-trip as `[]` rather than as an absent key
  (§2.3, case 2), and the signal plan that §2.3.2 was written for.

Both carry **no `schema_version` header** — Assimilator reads that key above
serde and its own demo files predate the stamping, which is why Zukai's probe
must accept an absent one (§2.1).

## Refreshing them

Recopy both, update the date and commit in the table above, and expect the tests
that read counts off these files to move with them. If a refresh makes a test
fail, that is the fixture doing its job: read the diff before changing the
assertion.
