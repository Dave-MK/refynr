---
name: verify
description: Drive the refynr web app end-to-end to verify a change works at its GUI surface.
---

# Verifying the refynr web app

The web shell (`apps/web`) is a GUI. Verify by running the dev server and
driving the browser — not by running tests or typecheck.

## Launch

Use the Browser-pane preview, never `next build` (dev + build share `.next`
and corrupt each other — see root CLAUDE.md):

- `preview_start` with name `refynr-web` (launch.json: `pnpm --filter @refynr/web dev`, port 3000).
- Wait for `http://localhost:3000` to return 200 (Next dev compiles on first request; ~1–10s).

**Port 3000 gotcha:** the browser extension's `wxt` dev server (`apps/extension`)
also defaults to port 3000 and can squat it, causing the web server to flap
(repeated "Fast Refresh had to perform a full reload"). If `preview_start`
reports the port held by a `wxt`/`node` process, that's usually a stray
extension dev server — confirm with the user before killing it, then free 3000.

refynr genuinely wants 3000 (Supabase auth callbacks + `/auth/confirm` are
bound to `localhost:3000`), so keep launch.json's fixed `port: 3000`.

## Drive it

Load data without a file picker:
- Click **"› try sample data"** (a rich messy dataset: 13 rows, ~16 findings), or
- Paste CSV into the landing `<textarea>` then click **Analyse data**.

Flows worth driving (via `javascript_tool` — table cells aren't accessibility
refs, and screenshots are scaled 800px so `computer` coordinate clicks on cells
are imprecise; prefer JS to locate/click elements):
- Analysis tabs: **Data health** (score + dimensions), **Findings** (accept/skip
  checkbox, `⌖ locate` highlights cells, column filter + scoped "Accept shown fixes"),
  **Columns** (per-column profile).
- View modes: **Original / Changes / Cleaned**.
- **Cleaned tab: double-click any cell to edit** (inline editor; edits route to
  the mapped working-table row since Cleaned drops removed rows).
- Grid: sticky header, **"changed rows only"** toggle (only in Changes view),
  filter/sort.
- Options: date selects, **"duplicates match on"** chips, expectations editor.
- Recipes (save/apply), transforms (Split/Merge/Unpivot), Undo (Ctrl+Z / ↶),
  ⇄ Compare (dataset diff), export.

## Gotchas when driving with javascript_tool

- To commit an inline cell edit synthetically: set `input.value` via the native
  setter + dispatch `'input'` (fires React onChange), then dispatch an **Enter
  `keydown`** (the handler calls `element.blur()` → React focusout → commit).
  A directly-dispatched non-bubbling `'blur'` event is **ignored by React** and
  will read back as an empty/uncommitted value — a test artifact, not an app bug.
- **Copy** (`navigator.clipboard`) throws `NotAllowedError` in the preview pane
  (permissions policy). The app degrades correctly with a "use Download CSV"
  message — expected, not a failure. Verify export via Download CSV or the DOM.
- The `#` column in the **Cleaned** view numbers rows sequentially by cleaned
  position (a fresh-export numbering), not original row number — by design.
