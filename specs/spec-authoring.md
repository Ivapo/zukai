# Spec Authoring

How to write and iterate design specs under `specs/`. Read this before drafting a
new spec or revising a draft. Adapted from Assimilator's convention, sized for
Zukai.

**Meta.**
- A spec is **design rationale — the *why* and the plan**, not a description of
  current state. `CLAUDE.md`, `rules/`, and the code are authoritative for what
  *is*; a spec records what we decided and how we'll build it, and may drift from
  the code over time. Keep its `implemented` / `not_implemented` honest so the
  drift is visible.
- This file is **hand-authored** — edit it directly when the conventions change.

## 1. Frontmatter (the header)

Open every spec with a YAML frontmatter block:

- **`status`** (required) — start at `draft`. Lifecycle: `draft` → `in-progress`
  / `partial` → `implemented` → `superseded`. A prose status is fine for a
  multi-phase spec ("Phase 1 shipped 2026-07-25; Phase 2 next").
- **`last_updated`** (required) — absolute date `YYYY-MM-DD`. Bump every revision.
- **`implemented` / `not_implemented`** (recommended) — the at-a-glance build
  state a reader checks first. Keep current as phases land.
- **`note`** (recommended) — one line on what the spec covers.
- **`related`, `reference`** (when relevant) — `related` lists sibling specs by
  path; `reference` cites external inspiration and what is explicitly *out* of
  scope from it (e.g. an Assimilator format, a real-world convention).

Use absolute dates everywhere — never "today" / "last week".

## 2. Document structure

Numbered `## N.` sections. A skeleton to adapt:

1. **Goal** — what the feature is and why, anchored to a **concrete usage
   example** (a short code / YAML / UI-flow sketch of the end state) so the design
   is pinned to a real consumer, not an abstraction.
2. **Design** — data model, architecture, the hard constraints and traps.
3. **Open questions** (§4).
4. **Implementation phases** (§3).

- **Record decisions inline** with a `### Why X (decision, recorded)` subsection,
  so a later pass doesn't relitigate a settled choice.
- **Don't renumber `## N` sections lightly** — other specs may cite `foo_spec.md
  §N`. Add a `###` subsection rather than insert a new `## N` mid-document.

## 3. Implementation phases (numbered, sequential)

The implementation order is a first-class section: **each phase is handed to a
fresh context via plan mode.**

- **Number `1, 2, 3…`, not letters.** Phases are **strictly sequential** — each
  depends on the prior; say so.
- **One phase = one plan-mode pass.** The implementer runs "implement Phase 2 of
  `specs/<spec>.md`", enters plan mode, and must be able to plan from the spec
  alone — so each phase names the files/functions to touch and its scope.
- **Every phase has a concrete, checkable exit gate** — not "looks done". In
  Zukai that means: `bun run build` and `cargo test` green, plus a behavioural
  check sized to the change (a round-trip unit test, a rendered result verified
  in the browser via the Vite + Playwright flow, a serialized-output assertion).
- **The plan for a phase includes its own close-out.** When you enter plan mode
  to implement a phase, make these standing plan steps — don't wait to be asked:
  1. a **commit plan** — what gets committed (usually one logical commit per
     phase), the message, and whether to push;
  2. a **reconciliation step** — which `rules/` files, `CLAUDE.md`, or the
     project-memory roadmap the phase changes, or "none needed" with a reason.
- **Mark deferred phases** explicitly and say what unblocks them.

## 4. Open-questions discipline

- Keep a dedicated **Open questions** section; number entries `OQ-N` so the body
  can reference them.
- **Resolve inline, don't delete.** Mark a closed question `RESOLVED` with the
  answer and where it landed. The resolution *is* the record.
- **Classify each**: answerable-from-code-now / needs-external-input / design
  call. Answer the code-answerable ones *during review* (read the source), not at
  implementation time. Flag any that **block** a correctness or "faithful" claim.

## 5. Drafting & review loop

A spec converges over rounds. Stay `status: draft` until it does.

- **Ground every claim in source.** Before writing a design fact, verify it
  against the actual code and cite `file:symbol`. The highest-value catches are
  assumptions that don't match the code. Don't assert from memory.
- **Iterate:** draft → review → fold in → consistency sweep → repeat. Each sweep:
  every `§N` / `OQ-N` cross-ref resolves; no stale type/file names; the §1 usage
  example still matches the resolved design.
- **Scope discipline:** name the thing precisely; state non-goals; don't
  pre-abstract before there are real consumers. Distinguish *structurally built*
  from *behaviourally verified* — flag placeholders rather than imply completeness.

## 6. Lifecycle

`draft` → `reviewed` (passes §7) → `in-progress` / `partial` → `implemented` →
`superseded`. Bump `last_updated` and keep `implemented` / `not_implemented`
current as phases land. When a shipped phase changes what a rule documents, update
that `rules/` file (and the roadmap in project memory) in the same pass — that's
the close-out habit.

## 7. Review process

A spec passes a review loop before it is built. **Don't plan or implement a phase
from a spec still `status: draft`** — review is the gate between drafting and
building. (Validated on `save_load_spec.md`, which converged in two rounds.)

1. **Round 1 — fresh reviewer with repo access.** Spawn a clean-context agent that
   can **read the repo**, not just the spec text — its highest-value job is catching
   design claims that don't match the code (verify the `file:symbol` citations and
   the spec's assumptions about existing code). Ask it the right question: *"is this
   ready to implement **as scoped**?"* — never "how would you improve it". That
   framing is what prevents an endless scope-creep loop.
2. **Classify + verdict.** The reviewer tags every comment `[BLOCKING]` /
   `[NON-BLOCKING]` and ends with `READY` / `NOT READY`. *Blocking* = can't be
   implemented correctly as written (contradicts the code, ambiguity that forces a
   guess, a phase that isn't self-contained, a vague/unverifiable exit gate).
   Everything else is non-blocking.
3. **Author adjudicates every comment** — accept (fold in) / reject (with a recorded
   reason; the reviewer isn't always right) / defer (to an OQ or non-goal). Recording
   the call is what stops the next round re-raising it.
4. **Re-review — resume the *same* agent**, not a fresh one. Give it a changelog of
   what changed and how each finding was handled; ask it to confirm the blockers are
   resolved and raise **only** newly-introduced or newly-found blocking issues. (Round
   1 fresh gives fresh eyes; same-agent re-review gives convergence — it can verify
   its own concerns were addressed.)
5. **Converge at zero blocking.** A round with no `[BLOCKING]` findings is READY.
   Non-blocking leftovers become OQs or "won't do" notes; they don't block.
6. **Cap at 3 rounds.** If blocking issues remain after three, **escalate to the
   human** — don't loop.
7. **Record it.** Keep a `## Review log` in the spec: per round, the verdict, blockers
   fixed, notable rejections. On convergence, move `status` off `draft` (to
   `reviewed`).
