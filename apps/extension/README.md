# @refynr/extension

Chrome side-panel extension (Manifest V3, built with [WXT](https://wxt.dev)).
Runs the same `@refynr/engine` as the web app — entirely inside the panel,
no network calls.

## Flow

1. Select cells in Google Sheets / Excel Online and copy (Ctrl+C)
2. Click the refynr toolbar icon → side panel opens
3. Paste → instant health score + findings with per-finding Apply toggles
4. "Copy cleaned data" puts TSV on the clipboard → paste back into the sheet

## Development

```sh
pnpm --filter @refynr/extension dev     # launches Chrome with the extension loaded
pnpm --filter @refynr/extension build   # production build → .output/chrome-mv3
pnpm --filter @refynr/extension zip     # Chrome Web Store package
```

To load a production build manually: chrome://extensions → enable Developer
mode → Load unpacked → select `apps/extension/.output/chrome-mv3`.

## Notes

- `.wxt/` (generated types) and `.output/` (builds) are gitignored;
  `wxt prepare` regenerates `.wxt/` on `pnpm install`.
- The engine is consumed from its built `dist/` — rebuild
  `@refynr/engine` after engine changes.
- Store submission still needs: icons, store screenshots, a privacy policy
  URL, and a Chrome Web Store developer account.
