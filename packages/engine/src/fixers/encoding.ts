import type { CellPatch, Finding } from "../types.js";
import { cleanWhitespace } from "../text.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "fix-encoding";

// Type-only declaration: TextDecoder exists at runtime in every environment
// the engine targets (browsers, workers, Node 11+), but the engine's tsconfig
// deliberately excludes the DOM lib, so we declare the minimal surface here.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input: Uint8Array): string;
}

/**
 * Mojibake repair: text that was UTF-8 but got read as Windows-1252 somewhere
 * upstream ("Itâ€™s", "CafÃ©", "Â£100"). We reverse the damage by re-encoding
 * each character to its CP1252 byte and decoding those bytes as UTF-8. The
 * decode runs in fatal mode — if the bytes aren't valid UTF-8 the cell is
 * left alone, so ordinary accented text can't be mangled by mistake.
 */

/** CP1252 bytes 0x80–0x9F map to these Unicode code points. */
const CP1252_REVERSE = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // '
  [0x2019, 0x92], // '
  [0x201c, 0x93], // "
  [0x201d, 0x94], // "
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

/** UTF-8 multi-byte lead bytes shown as CP1252 text: Â Ã Ä … â ã ä … */
const MOJIBAKE_HINT = /[Â-Ãà-ï]/;

export function demojibake(s: string): string | null {
  if (!MOJIBAKE_HINT.test(s)) return null;
  if (typeof TextDecoder === "undefined") return null;

  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0xff) {
      bytes[i] = code;
    } else {
      const byte = CP1252_REVERSE.get(code);
      if (byte === undefined) return null; // not representable — not mojibake
      bytes[i] = byte;
    }
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Real mojibake always shrinks (multi-char artifact → one char) and the
    // result must be printable.
    if (decoded === s || decoded.length >= s.length) return null;
    // Reject results containing control characters (tab/newline excepted).
    for (let i = 0; i < decoded.length; i++) {
      const c = decoded.charCodeAt(i);
      if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) {
        return null;
      }
    }
    return decoded;
  } catch {
    return null; // not valid UTF-8 — the text was fine as it was
  }
}

export const encodingFixer: Fixer = {
  rule: RULE,
  run({ table }): FixerOutput {
    const patches: CellPatch[] = [];

    table.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (typeof v !== "string") return;
        const fixed = demojibake(v);
        if (fixed === null) return;
        // Self-contained patch: includes whitespace cleanup, because the
        // whitespace fixer deliberately skips cells this fixer owns.
        patches.push({
          kind: "cell",
          id: cellPatchId(RULE, r, c),
          rule: RULE,
          cell: { row: r, col: c },
          before: v,
          after: cleanWhitespace(fixed),
          reason:
            "Corrupted characters repaired: this text was UTF-8 that got read with the wrong encoding somewhere upstream (the classic \"â€™\" artifact). Reversed losslessly.",
          confidence: 0.95,
        });
      });
    });

    if (patches.length === 0) return { findings: [], patches: [] };

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${n(patches.length, "cell")} with corrupted characters`,
        detail: `${n(patches.length, "cell contains", "cells contain")} encoding artifacts like "â€™" or "Ã©" — UTF-8 text that was read as Windows-1252, usually by an export tool or an old system in the pipeline. Repaired by reversing the mis-decoding; the fix is only applied where the reversal produces valid text.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
