---
name: debug-path-tracer
summary: Trace status of recently mentioned files, judge whether they are related to the bug, score bot vs Sam when Sam says it is fixed, and note anything else that broke during the fix.
---

# Debug path tracer (Grok bot)

Use this file whenever Sam is debugging a feature, button, component, or “it broke after that prompt.” Load it **before** guessing which files matter.

Sibling skills: `mcp/grok-bot/skills/incident-research/SKILL.md` (feature observations / `grok_incident`). This file is the **file-path** layer: what was mentioned, whether it is even related, status at report time, who was right when it got fixed, and collateral breakage.

Do **not** put secrets, `.env` values, tokens, emails, or `render3d.db` in notes or tool calls. Skip secret paths (`isSecretPath` / `context_wiki_service.is_secret`).

Wiki (`ctxlink1`): write every repo path in backticks so Studio turns it into a blue file link (Docs → START HERE, Management instruction files, Foundry debugger). Copy-path paste from the wiki menu is `name — path` (em dash), one line per selected file.

---

## When to run a session

Start (or update) a path-trace session when **any** of these happen:

1. Chat mentions files (backtick paths, `[[wiki]]` links, markdown links, or prose paths).
2. Debugger **Send** / Add to debugger (`ctxlink1` payload — see below).
3. Copy-path selection pasted into chat (`name — path` lines).
4. Sam names a broken feature / button / control and you are about to touch code.

Close the **Outcome** row only when Sam says the original problem is fixed (see [Sam said it is fixed](#when-sam-says-it-is-fixed)).

---

## 1. Collect recently mentioned files

Merge sources. Deduplicate by repo-relative path. Drop secrets.

| Source | How to parse |
|--------|----------------|
| Debugger send | Use the JSON/body as-is. Paths are in `paths`. |
| Copy-path paste | Each line: `filename — frontend/site/context-wiki-links.js` → path is the text after ` — `. |
| Wiki links | Blue `ctx-wiki-link` / backtick paths in the prompt or a skill/log MD. |
| Chat | Backticks, `[[frontend/site/foo.js]]`, `[label](frontend/site/foo.js)`, or a path that starts with `frontend/`, `backend/`, `ai-context/`, `mcp/`, `Getting-Started/`, `deploy/`, `scripts/`, `extensions/`, `.cursor/`. |

Normalize to repo-relative POSIX paths (`frontend/site/context-wiki-links.js`, not `/Users/sam/Render-Studio/...`). If you only have a basename, say so — do not invent a folder.

---

## 2. `ctxlink1` debugger payload (use when present)

Studio wiki **Add to debugger** POSTs `/api/ops/context-wiki/debugger`. The response (and Foundry/incident fields) is the source of truth for **report time**. Read these keys; do not rename them in your notes:

| Key | Meaning |
|-----|---------|
| `occurred_at` | UTC ISO when the send was logged. This is the session **Timestamp** if present. |
| `reason` | Sam’s “why do you think this happened?” (plus selected text). |
| `paths` | Files on that send. |
| `related` | **Files vs each other** (`related`, `label`, `reason`) — same folder / area / import. **Not** “related to the bug.” |
| `issue_check` | Issue language in the prompt/selection; per-file `implicated`, `status`, `why`, `target_edited`, `deps_edited`. `component_status` is `ok` / `degraded` / `broken`. |
| `edits.target_edited` | The first path was edited after the incident baseline (~48h or last feature event). |
| `edits.deps_edited` | A parsed dependency of that file was edited in the same window. |
| `edits.edited_paths` | Which paths looked recently touched. |
| `status` | Sam’s picker: `ok` (good), `degraded`, `broken` (also `missing` / `unknown` if an incident event used those). |

If a key is missing, write `unknown` — do not infer a green status.

Incident events from the same send stash the same facts as `wiki.path`, `wiki.occurred_at`, `wiki.target_edited`, `wiki.deps_edited`, `wiki.related`, `wiki.implicated`, `wiki.component_status`. Prefer the debugger JSON when you have it.

---

## 3. Judge relatedness to **the problem**

Payload `related` only answers “are these files clustered with each other?”

You must **also** answer: is this file related to the feature / button / component we are trying to fix?

For **each** path:

- **related** — it implements, styles, routes, or last-edited that control; or Sam/the payload implicated it with a short causal why.
- **unrelated** — mentioned because it was nearby in a doc, copy-path multi-select, same folder, or a red herring. Say why in one sentence.

Do not treat “same tree: `frontend/`” as proof it is the bug. God-files (`frontend/studio/app.js`, `frontend/studio/styles.css`, `backend/main.py`) are often *mentioned* and rarely the right first edit — mark related only if the symptom actually lives there.

Record both axes in the template:

- Files-to-each-other: payload `related.label` + `related.reason` (or `unknown`).
- Files-to-problem: your yes/no + why, per file.

---

## 4. Status at report time

Map `status` / `issue_check` to the template words:

| Payload / incident | Write in the note |
|--------------------|-------------------|
| `ok` | good |
| `degraded` | degraded |
| `broken` / `missing` | broken |
| `unknown` or untested | unknown (never “good”) |

Also copy **edits**: target edited yes/no, deps edited yes/no, and the `edited_paths` list (backtick each path).

If there is no debugger send, status is what Sam said in chat, else `unknown`. Do not mark good unless someone actually checked that control.

---

## 5. Bot hypothesis vs Sam’s

Write both **before** the fix is claimed:

- **Bot:** which files are broken / related, and the smallest hypothesis (one control, not the whole stack).
- **Sam:** what he selected, the debugger status picker, copy-path set, or lines like “this file isn’t even related.”

Leave this frozen until the Outcome row. Do not quietly rewrite history after the fix.

---

## When Sam says it is fixed

Treat these as close-the-session (same intent, any casing):

- “I got it fixed” / “got it fixed” / “I got it”
- “it’s fixed” / “that fixed it” / “working now”
- incident thumbs-up / `grok_incident` `vote` / `audit` verified

Then fill **Outcome** — who was right about **which files were broken or related**, not who typed the patch:

| Outcome | When |
|---------|------|
| **bot correct** | Bot’s related/broken set matched the files that actually had to change (or stay untouched). Sam’s set did not. |
| **Sam correct** | Sam’s set (or “unrelated”) matched. The bot’s did not. |
| **both** | Same files; that match was confirmed at fix time. |
| **neither** | The real files were a third set, or you still cannot tell. |

If Sam says it is fixed but you never verified the control, Outcome can still be scored on **file relatedness**; say verification was not observed. Incident research still requires a confirming check before `finding` `confirmed`.

---

## 6. Collateral breakage

Keep a running list of **anything else** that broke while trying to fix that feature / button / component: other buttons, cache-stale UI, a second mode, a webhook, a test, a layout.

- Name the other control in plain language.
- Backtick the file if known.
- Status (`degraded` / `broken`) and whether it is still broken after the original fix.

This is required even if the original button works. Empty list = `none observed` (not “nothing can be broken”).

---

## Per-session template (fill every run)

Copy this block into the reply. Persist a **miniaturized** ops note only if Sam named a critical bug (see `ai-context/ops/README.md`) — do not dump this whole template into ops; ops notes stay ≤ 8 lines. Point the ops note at this session’s Timestamp.

Use backticks on every path. Copy-path rows stay `name — path`.

### Debug path trace

- **Timestamp:** `<occurred_at or now UTC ISO>`
- **Problem:** `<feature / button / component / whatever we are debugging>`
- **Files mentioned:**
  - `name — repo/relative/path.ext` — source: chat / copy-path / debugger / wiki
- **Related to each other?** `<payload related yes/no + label + why, or unknown>`
- **Related to the problem?**
  - `repo/relative/path.ext` — **yes/no** — `<one-line why>`
- **Status at report time:** `good` / `degraded` / `broken` / `unknown`
  - target_edited: yes/no/unknown
  - deps_edited: yes/no/unknown
  - edited_paths: `path` …
  - issue_check: implicated `…` / none; why `…`
- **Bot hypothesis:** `<files + why>`
- **Sam’s call:** `<files + why, or none yet>`
- **Outcome (only when Sam says fixed):** `bot correct` / `Sam correct` / `both` / `neither` — `<one-line who was right about which files>`
- **Collateral breakage:** `<other things that broke during the fix, or none observed>`

---

## Optional persist (`grok_incident`)

After filling the template, you may record observations (no arbitrary code):

- `checklist` / `event` for the **problem** feature, not for unrelated files.
- Include wiki fields when you have them: `wiki.path`, `wiki.occurred_at`, `wiki.target_edited`, `wiki.deps_edited`, `wiki.related`, `wiki.implicated`.
- Do not mark a feature `ok` unless it was checked.

File-status tracing here does **not** replace incident compare/smoke. Use both on a real regression.

---

## Example (shape only)

- **Timestamp:** `2026-09-16T19:51:00+00:00`
- **Problem:** wiki “Add to debugger” send lost relatedness
- **Files mentioned:**
  - `context-wiki-links.js — frontend/site/context-wiki-links.js` — debugger send
  - `context_wiki_service.py — backend/services/context_wiki_service.py` — copy-path
- **Related to each other?** yes — same wiki debugger feature (import / wiki-link dependency)
- **Related to the problem?**
  - `frontend/site/context-wiki-links.js` — **yes** — dialog builds the payload
  - `backend/services/context_wiki_service.py` — **yes** — `send_debugger` writes `related` / `issue_check`
  - `frontend/studio/app.js` — **no** — only in the same chat, not this control
- **Status at report time:** degraded — target_edited yes — deps_edited no
- **Bot hypothesis:** payload `related` is files-to-each-other; bug is in the dialog status picker
- **Sam’s call:** both wiki files implicated; god-file unrelated
- **Outcome:** both — those two files were the ones that changed; `frontend/studio/app.js` was not
- **Collateral breakage:** none observed

---

## Do not

- Treat a copy-path multi-select as “all of these are the bug.”
- Recycle `frontend/studio/app.js` / `frontend/studio/styles.css` / `backend/main.py` for a file-trace note.
- Echo secrets. Skip `.env`, keys, `credentials.json`, `*.pem`, `render3d.db`.
- Mark Outcome before Sam says it is fixed.
- Quietly drop collateral breakage from an earlier attempt in the same session.
