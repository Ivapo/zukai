---
status: draft
last_updated: YYYY-MM-DD
note: <one line on what this spec covers>
implemented: []
not_implemented: ["Phase 1", "Phase 2"]
related: []            # sibling specs by path, e.g. specs/foo_spec.md
reference: null        # external inspiration + what is out of scope from it
---

# <Feature> Spec

## 1. Goal

What this feature is and why it exists. Anchor to a concrete usage example — a
short YAML / code / UI-flow sketch of the end state — so the design is pinned to a
real consumer.

```
# end-state sketch here
```

## 2. Design

Data model, architecture, and the hard constraints / traps. Cite `file:symbol`
for every claim about existing code. Record settled choices as
`### Why X (decision, recorded)`.

## 3. Open questions

- **OQ-1** — <question>. (answerable-from-code / needs-input / design-call)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — <name>
- **Scope:** files/functions to touch.
- **Exit gate:** `bun run build` + `cargo test` green, plus <behavioural check>.

### Phase 2 — <name>  (depends on Phase 1)
- **Scope:** …
- **Exit gate:** …
