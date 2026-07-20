import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/** A single "how it works" step. */
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="relative rounded-2xl border border-line bg-card p-6">
      <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-teal/30 bg-teal/10 font-mono text-sm font-bold text-teal">
        {n}
      </span>
      <h3 className="text-[15px] font-semibold text-hi">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mut">{body}</p>
    </div>
  );
}

/** A capability card. */
function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-card2 p-5">
      <h3 className="text-[14px] font-semibold text-hi">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mut">{body}</p>
    </div>
  );
}

/**
 * Marketing landing wrapper shown before any data is analysed. Renders the
 * hero + value proposition, slots the paste/upload card as the primary CTA,
 * then explains how it works, what it fixes, and the privacy model below.
 */
export function Landing({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-16 pb-16">
      {/* Hero */}
      <section className="pt-6 text-center">
        <Logo size={64} className="mx-auto mb-6" />
        <span className="label inline-flex items-center gap-2 rounded-full border border-line2 bg-card px-3.5 py-1.5 text-teal!">
          <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
          Grammarly for spreadsheets
        </span>
        <h2 className="mx-auto mt-6 max-w-[680px] text-balance text-[38px] font-bold leading-[1.1] tracking-tight text-hi sm:text-[46px]">
          Clean spreadsheets you can{" "}
          <span className="bg-gradient-to-r from-teal to-cyan bg-clip-text text-transparent">
            actually trust
          </span>
          .
        </h2>
        <p className="mx-auto mt-5 max-w-[600px] text-[15px] leading-relaxed text-mut">
          refynr finds what's quietly wrong with your data — duplicates, mixed
          date formats, placeholder blanks, the damage Excel does to IDs and
          codes — and proposes a fix for each one, with the reason spelled out.
          You review every change, export a clean copy with an audit report,
          and save your decisions as a recipe for next month's file.
        </p>

        {/* Trust row */}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] text-dim">
          <span>✓ Runs entirely in your browser</span>
          <span>✓ Your original is never modified</span>
          <span>✓ CSV, Excel, JSON &amp; Parquet</span>
          <span>✓ No account needed to clean</span>
          <span>✓ UK formats built in</span>
        </div>
      </section>

      {/* Primary CTA — the paste/upload card. Full-width pages still deserve
          a comfortable input width — a viewport-wide textarea reads badly. */}
      <section id="start" className="mx-auto w-full max-w-[960px] scroll-mt-8">
        {children}
      </section>

      {/* How it works */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="label text-teal!">How it works</h2>
          <p className="mt-2 text-lg font-semibold text-hi">
            From messy paste to clean export in under a minute
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Step
            n={1}
            title="Paste or upload"
            body="Drop in CSV, Excel, JSON or Parquet — or paste straight from Excel or Google Sheets. Semicolon and pipe files just work. It's analysed on your device — no upload, no waiting."
          />
          <Step
            n={2}
            title="See what's wrong"
            body="Get a data-health score and an itemised list of findings, each explained in plain English. Anything refynr can't fix safely — an impossible date, a suspect ID — is flagged for you, never guessed."
          />
          <Step
            n={3}
            title="Review, export, repeat"
            body="Accept fixes one by one, edit cells inline, reshape columns — every step undoable. Export a clean copy plus an audit report, and save your decisions as a recipe to replay on next month's file."
          />
        </div>
      </section>

      {/* What it fixes */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="label text-teal!">What refynr catches</h2>
          <p className="mt-2 text-lg font-semibold text-hi">
            Deterministic fixes you review, one by one
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            title="Non-destructive by design"
            body="Every change is a reviewable patch with a before, after and reason. The engine never edits your input — it only ever builds a clean copy."
          />
          <Feature
            title="Private by default"
            body="Cleansing runs 100% in your browser. Your rows never leave your device — there's no upload, and nothing is sent to any server."
          />
          <Feature
            title="UK formats, done right"
            body="Postcodes, phone numbers, VAT numbers (checksum included), sort codes and Companies House numbers — the details US-centric tools get wrong on British data."
          />
          <Feature
            title="The everyday mess"
            body="Stray whitespace, inconsistent casing, duplicate rows, placeholder blanks like “NA” and “NULL”, mojibake encoding, malformed emails and numbers-stored-as-text — normalised automatically."
          />
          <Feature
            title="Catches what Excel broke"
            body="Stripped leading zeros, IDs collapsed into scientific notation, codes silently turned into dates, rows with shifted columns — the classic export injuries, flagged before they reach your analysis."
          />
          <Feature
            title="Honest when it can't be sure"
            body="A column mixing UK and US date orders? Ambiguous cells are flagged, not guessed. Probable duplicates are shown for review, never auto-deleted. Confidence is earned, not asserted."
          />
          <Feature
            title="A score you can't fool"
            body="Deterministic across validity, consistency, completeness and uniqueness — and one cratered dimension can't hide behind three clean ones. Accepting fixes shows you the exact gain first."
          />
          <Feature
            title="Repeatable with recipes"
            body="Save your cleaning decisions as a recipe — pure configuration, none of your data — and replay it on next month's export in one click, or headlessly in CI with the refynr CLI."
          />
          <Feature
            title="Compare & prove it"
            body="Diff two versions of a dataset row by row to see exactly what changed since the last export, and ship the audit report (PDF, HTML or Markdown) alongside the clean file."
          />
        </div>
      </section>

      {/* The difference vs in-cell AI */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="label text-teal!">Why not just use AI in Excel?</h2>
          <p className="mt-2 text-lg font-semibold text-hi">
            The cell assistants rewrite your data. refynr shows its working.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-card2 p-5">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-mut">
              In-cell AI (Copilot, GPT-in-Sheets)
            </h3>
            <ul className="mt-3 space-y-2 text-[13px] text-mut">
              <li>✗ Sends your rows to a cloud model</li>
              <li>✗ Edits cells in place — the original is gone</li>
              <li>✗ You trust the change; you can't inspect the rule</li>
              <li>✗ Every run can differ</li>
            </ul>
          </div>
          <div className="rounded-xl border border-teal/30 bg-card p-5">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-teal">
              refynr
            </h3>
            <ul className="mt-3 space-y-2 text-[13px] text-body">
              <li>✓ Runs locally — your rows never leave the tab</li>
              <li>✓ Builds a clean copy; your original is untouched</li>
              <li>✓ Every change is a patch with a reason you can read</li>
              <li>✓ Deterministic — same input, same result, every time</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Privacy note */}
      <section className="rounded-2xl border border-teal/20 bg-card p-7 text-center">
        <h2 className="text-lg font-semibold text-hi">
          Your data stays yours
        </h2>
        <p className="mx-auto mt-2 max-w-[620px] text-sm leading-relaxed text-mut">
          Most cleaning tools upload your spreadsheet to a server. refynr doesn't.
          The entire analysis and repair happens locally, in this browser tab.
          There's no file to leak and nothing to delete afterwards — because your
          data never left in the first place.
        </p>
      </section>
    </div>
  );
}
