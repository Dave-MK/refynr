/** Shared text-cleaning primitives used by several fixers. */

/** Zero-width characters: remove entirely (ZWSP, ZWNJ, ZWJ, BOM). */
const ZERO_WIDTH_RE = new RegExp("[\\u200B\\u200C\\u200D\\uFEFF]", "g");

/** Space look-alikes: replace with a plain space (NBSP, en/em spaces, etc.). */
const ODD_SPACE_RE = new RegExp(
  "[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]",
  "g",
);

export const INVISIBLE_TEST_RE = new RegExp(
  "[\\u200B\\u200C\\u200D\\uFEFF\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]",
);

export function cleanWhitespace(s: string): string {
  return s
    .replace(ZERO_WIDTH_RE, "")
    .replace(ODD_SPACE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
