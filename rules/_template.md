---
title: <subsystem-slug>
sources:                       # regenerate by re-reading exactly these.
  - src/editor/<module>.ts     # [] ⇒ hand-maintained, deliberately — this is
  - src-tauri/src/<module>.rs  # the signal, not `generated` below
covers: >                      # what this file is FOR — the regeneration target.
  <the behaviour this rule documents, in one line>   # null where hand-maintained
max_lines: 150                 # the cap. Body lines only; the frontmatter is free
generated: YYYY-MM-DD          # when the loop last ran. null ⇒ never
---

# <Subsystem>

**What is true right now.** This file tracks the code, so it is rewritten freely —
there is no audit trail to protect here and no dated correction note. If it
disagrees with the code, the file is wrong. The *why* lives in the spec that owns
the subject (`specs/<name>_spec.md`); this is the *what is*.

Keep it under the cap. A cap holds only where something regenerates against it,
which is what `sources` and `covers` are for: they let `/sync-rules` re-derive this
file without knowing anything about this project in advance.

There are three managed states, and **`sources` is what tells them apart**:
non-empty with a `generated` date is *generated*; non-empty with `generated: null`
is *declared but never regenerated*, which is where every rule in this repo sits
today; and `sources: []` with `covers: null` is **declared** hand-maintained — a
different thing from silently unmaintained, and the whole reason the keys are
required rather than optional. A file with no frontmatter at all is a fourth thing,
*unmanaged*, and that is an error.

Close with a **Where each piece lives** table — symbol, file, and what tests it.
It is the section `sources` is derived from, and the one a reader scrolls to first.
