import type { DateOrder, EngineOptions } from "./types.js";

/**
 * Deterministic natural-language command parsing. As in-cell AI assistants
 * normalise plain-English cleaning commands, this keeps refynr credible on the
 * same surface — but the refynr way: no model, no network, no data leaving the
 * browser. It maps a typed instruction to engine options (which fixers to skip,
 * how to read and format dates) and reports back what it understood and what it
 * didn't, so the user is never left guessing whether their words took effect.
 */
export interface Instruction {
  /** Engine options derived from the instruction (may be empty). */
  options: EngineOptions;
  /** Plain-English descriptions of each intent that was recognised. */
  matched: string[];
  /** Clauses that couldn't be interpreted (so the UI can say so). */
  unmatched: string[];
}

/** Every fixer rule the NL layer knows how to switch off, with the phrases
 *  that mean "leave this alone". Order is display order in `matched`. */
const DISABLE_INTENTS: { rule: string; label: string; test: RegExp }[] = [
  { rule: "remove-duplicate-rows", label: "keep duplicate rows", test: /\bduplicate|\bdupe|\bdedup/i },
  { rule: "consistent-casing", label: "leave letter case unchanged", test: /\bcas(e|ing)|capitali[sz]/i },
  { rule: "trim-whitespace", label: "keep whitespace as-is", test: /\bwhitespace|\bspaces?\b|\btrim/i },
  { rule: "remove-blank-rows", label: "keep blank rows", test: /\bblank|\bempty rows?/i },
  { rule: "normalize-date", label: "leave dates unchanged", test: /\bdates?\b/i },
  { rule: "normalize-number", label: "leave numbers unchanged", test: /\bnumbers?\b|\bnumeric/i },
  { rule: "normalize-email", label: "leave emails unchanged", test: /\bemails?\b/i },
  { rule: "normalize-phone", label: "leave phone numbers unchanged", test: /\bphones?\b|\bmobiles?\b/i },
  { rule: "normalize-postcode", label: "leave postcodes unchanged", test: /\bpost\s?codes?\b/i },
];

/** "don't", "do not", "no", "without", "keep", "leave", "ignore", "skip" — the
 *  words that turn a topic into "leave it alone". */
const NEGATE = /\b(don'?t|do not|never|no|without|keep|leave|ignore|skip|exclude|preserve|retain)\b/i;

function splitClauses(text: string): string[] {
  return text
    .split(/[,;.\n]|\band\b|\balso\b|\bbut\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Parse a free-text cleaning instruction into engine options. Deterministic:
 * the same text always yields the same options. Unrecognised clauses are
 * returned in `unmatched` rather than silently dropped.
 */
export function parseInstruction(text: string): Instruction {
  const options: EngineOptions = {};
  const disabled = new Set<string>();
  const matched: string[] = [];
  const unmatched: string[] = [];

  const clauses = splitClauses(text);

  // "only <X>" / "just <X>" — keep the named fixer(s), skip everything else.
  const onlyMatch = text.match(/\b(?:only|just)\b/i);
  if (onlyMatch) {
    const kept = DISABLE_INTENTS.filter((d) => d.test.test(text)).map((d) => d.rule);
    if (kept.length > 0) {
      for (const d of DISABLE_INTENTS) if (!kept.includes(d.rule)) disabled.add(d.rule);
      matched.push(`only apply: ${kept.join(", ")}`);
      options.disabledRules = [...disabled];
      return { options, matched, unmatched };
    }
  }

  const setDateOutput = (fmt: "iso" | "uk" | "us", label: string) => {
    options.dateOutput = fmt;
    matched.push(label);
  };
  const setDateOrder = (order: DateOrder, label: string) => {
    options.dateOrder = order;
    matched.push(label);
  };

  for (const clause of clauses) {
    let hit = false;

    // Date output format
    if (/\biso\b|yyyy-mm-dd|year first/i.test(clause)) { setDateOutput("iso", "format dates as ISO (YYYY-MM-DD)"); hit = true; }
    else if (/\buk\b|dd\/mm|british/i.test(clause) && /\bdates?\b|format/i.test(clause)) { setDateOutput("uk", "format dates as UK (DD/MM/YYYY)"); hit = true; }
    else if (/\bus\b|mm\/dd|american/i.test(clause) && /\bdates?\b|format/i.test(clause)) { setDateOutput("us", "format dates as US (MM/DD/YYYY)"); hit = true; }

    // Date interpretation order
    if (/day[\s-]?first|dd\/mm|d\/m/i.test(clause) && /\btreat|read|interpret|assume/i.test(clause)) { setDateOrder("DMY", "read ambiguous dates as day-first"); hit = true; }
    else if (/month[\s-]?first|mm\/dd|m\/d/i.test(clause) && /\btreat|read|interpret|assume/i.test(clause)) { setDateOrder("MDY", "read ambiguous dates as month-first"); hit = true; }

    // Disable intents — only when the clause is phrased as a negation/keep.
    if (NEGATE.test(clause)) {
      for (const d of DISABLE_INTENTS) {
        if (d.test.test(clause) && !disabled.has(d.rule)) {
          disabled.add(d.rule);
          matched.push(d.label);
          hit = true;
        }
      }
    }

    if (!hit) unmatched.push(clause);
  }

  if (disabled.size > 0) options.disabledRules = [...disabled];
  return { options, matched, unmatched };
}
