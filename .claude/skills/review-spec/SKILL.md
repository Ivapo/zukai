---
name: review-spec
description: Run the pre-implementation review loop on a design spec (the spec-authoring.md §7 process). Fresh reviewer with repo access → blocking/non-blocking verdict → author adjudication → same-agent re-review → converge at zero-blocking or escalate. Use when asked to "review" a spec before it is implemented.
---

Run the spec review loop: `/review-spec <spec-path>` (e.g.
`/review-spec specs/save_load_spec.md`).

**The rules are `specs/spec-authoring.md` §7 — read it first.** This skill is the
mechanical recipe; §7 is the constitution. A spec must pass this loop (reach
`status: reviewed`) before any phase is implemented.

## 0. Preconditions
- Resolve `<spec-path>`. If it's omitted, ask which spec.
- Read the spec and `specs/spec-authoring.md` (esp. §3 phases, §4 open questions,
  §7 review). If the file clearly isn't a spec, stop and say so.

## 1. Round 1 — fresh reviewer with repo access
Spawn a **clean-context** subagent (Agent tool, `general-purpose`, run
synchronously — you need its result to proceed). It MUST be able to read the repo.
Give it this prompt (fill in the absolute repo root and `<spec-path>`):

> You are doing a clean-room readiness review of a design spec. You were NOT
> involved in writing it. Read-only — your entire output is the review.
> Repo: `<repo-root>`. Spec to review: `<spec-path>`. Conventions it must satisfy:
> `specs/spec-authoring.md` — read it first for the bar.
> Decide whether this spec is **READY TO IMPLEMENT AS SCOPED** — an implementer
> could correctly build each phase from the spec alone. This is NOT "how would you
> improve it". Do not invent requirements the spec explicitly defers or lists as
> non-goals.
> Method (don't skip): (1) read the spec + spec-authoring.md; (2) **verify
> grounding — your highest-value job**: open every `file:symbol` the spec cites and
> confirm it matches the ACTUAL code, and verify the spec's key assumptions about
> existing code — wrong/stale citations and assumptions are the best catches;
> (3) check each phase is self-contained, one-plan-mode-pass sized, strictly
> sequential, with a concrete CHECKABLE exit gate; (4) check for contradictions,
> ambiguity that forces an implementer to guess, and missing error handling.
> Classify EVERY comment `[BLOCKING]` (cannot be implemented correctly as written:
> contradicts the code, ambiguity that forces a guess, a phase that isn't
> self-contained, a vague/unverifiable exit gate, a real technical error) or
> `[NON-BLOCKING]` (improvement / style / future). For each: the tag, a one-line
> summary, the §N and/or file it concerns, and a 1–3 sentence rationale grounded in
> what you found.
> End with EXACTLY one line: `VERDICT: READY` (iff zero BLOCKING findings) or
> `VERDICT: NOT READY`.

**Keep the returned `agentId`** — you resume the SAME agent for every later round.

## 2. Adjudicate (author's call)
For EVERY finding: **accept** (fold into the spec now) / **reject** (with a recorded
reason — the reviewer is not always right) / **defer** (to an `OQ-N` or a non-goal).
Fold accepted findings into the spec. Do not accept scope the spec deliberately
defers. Record every call for the Review log (step 4).

## 3. Re-review — resume the SAME agent
If the round was `NOT READY`, or you folded in any change, `SendMessage` the **same
agentId** with: a changelog of what changed and how each finding was adjudicated
(including rejections and why). Ask it to (a) confirm the blockers are resolved,
(b) raise ONLY newly-introduced or newly-found BLOCKING issues — not re-raise
settled non-blocking/style points, and (c) end with a `VERDICT:` line. Then loop
back to step 2.

Round 1 is a *fresh* agent (fresh eyes); every re-review is the *same* agent
resumed (it verifies its own concerns were addressed → convergence).

## 4. Converge or escalate
- **Converged** when a round returns zero `[BLOCKING]` findings (`VERDICT: READY`).
  Fold in any worthwhile non-blocking refinements; leave the rest as `OQ-N` /
  "won't do" notes.
- **Hard cap: 3 rounds.** If blocking issues remain after the third, **STOP and
  escalate to the human** with the outstanding blockers — do not loop.
- Maintain a `## Review log` in the spec: per round — date, verdict, blockers fixed,
  notable rejections. On convergence, move `status:` off `draft` to `reviewed`.

## 5. Report
Tell the user: rounds run, the final verdict, the blocking issues caught and fixed,
and any findings you rejected (with why). If escalated, list the unresolved blockers
and ask how to proceed. Per the standing plan-mode rule, the spec is only cleared
for implementation once it is `reviewed`.
