# Changelog

## 2026-07-20 — Honest confidence

A data-quality tool is only as good as the moment you stop trusting it. This
release is a pass over every place refynr was more confident than its evidence —
so a clean bill of health now means the data is actually clean, and a flag now
means something a person should really look at.

### Fixed — the engine tells the truth now

- **Duplicate detection no longer cries wolf on normal tables.** Rows that
  differ only by an ID (customer numbers, transaction IDs, SKUs) are distinct
  records, not typos of each other — refynr now treats them that way. A table of
  23 real customers that used to score 80 with 22 "probable duplicates" now
  scores 100 with none. Genuine typo-duplicates ("Jon Smith" vs "John Smith")
  are still caught, and still shown for review rather than auto-deleted.
- **Mixed date formats are flagged, not guessed.** When a column mixes UK
  (day-first) and US (month-first) dates — the single most common cause of wrong
  analysis — refynr no longer silently picks a reading. Ambiguous cells are
  flagged for you; a value that only makes sense in the opposite order is
  converted but clearly labelled as low-confidence.
- **Timestamps convert to the right day.** A timestamp with a timezone offset
  now converts to its UTC calendar day before the time is dropped, so an event
  can't silently jump to the wrong date.
- **Placeholder blanks count as missing.** "NA", "N/A", "NULL", "None", "-" and
  friends are missing data wearing a costume. They now count against
  completeness (a column that's 75% "NA" reads as 75% empty, not 100% full) and
  can be cleared to true blanks in one reviewable step.

### Added — catches more of the real mess

- **Reads more files, correctly.** Semicolon- and pipe-delimited exports (common
  from European locales and finance tools) now parse into proper columns instead
  of one big column. Rows with the wrong number of fields — the fingerprint of a
  broken export — are flagged instead of quietly padded.
- **Catches what Excel broke.** Identifiers collapsed into scientific notation,
  codes silently converted to dates (the classic "SEPT2 → 2-Sep" injury), and
  stripped leading zeros are now surfaced before they reach your analysis.
- **Sharper personal-data detection.** Payment card numbers are detected by
  checksum, name/phone/card columns by header — and IP addresses are no longer
  mislabelled as phone numbers.
- **Smarter outliers.** Right-skewed columns (salaries, revenue) no longer flag
  their legitimate long tail, while placeholder constants like 99999 and -1 get
  their own louder warning.

### Changed — a health score you can't fool

- The score now moves smoothly with the amount of mess — no more flat spots
  where 21% and 95% duplicate rows looked identical — and **one wrecked
  dimension can no longer hide behind three clean ones** (a table that's 90%
  duplicate rows now scores 40, not 80).
- Audit reports count the actual cells and rows changed, not the number of
  internal fixes, so the "what changed" number matches what you see.
- Saved recipes now record the engine version they were made with, so a replay
  can tell you if the tool has changed underneath them.

### Site

- Landing page and social-share card rewritten to reflect what the app actually
  does now: all four input formats, version diffs, replayable recipes, the audit
  report, and the honesty guarantees above.

---

*126 engine tests, all deterministic. Everything still runs entirely in your
browser — your data never leaves your device.*
