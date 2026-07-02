import { useMemo, useState } from "react";
import {
  applyPatches,
  cellText,
  cleanse,
  fromDelimitedText,
  type CleanseResult,
  type Table,
} from "@refynr/engine";

interface Session {
  table: Table;
  result: CleanseResult;
}

function scoreClass(score: number): string {
  if (score >= 85) return "score score-good";
  if (score >= 60) return "score score-mid";
  return "score score-bad";
}

/** Serialize a table as TSV — pastes straight back into Sheets/Excel. */
function toTsv(table: Table): string {
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, " ");
  return [
    table.headers.map(cell).join("\t"),
    ...table.rows.map((r) => r.map((v) => cell(cellText(v))).join("\t")),
  ].join("\n");
}

export function App() {
  const [pasted, setPasted] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [enabled, setEnabled] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyse = () => {
    try {
      const table = fromDelimitedText(pasted);
      if (table.rows.length === 0) {
        setError("Paste at least a header row and one data row.");
        return;
      }
      const result = cleanse(table);
      setSession({ table, result });
      setEnabled(
        new Set(
          result.findings
            .map((f, i) => (f.patchIds.length > 0 ? i : -1))
            .filter((i) => i >= 0),
        ),
      );
      setError(null);
      setCopied(false);
    } catch (e) {
      setError(`Couldn't read that data: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const cleaned = useMemo(() => {
    if (!session) return null;
    const ids = new Set<string>();
    session.result.findings.forEach((f, i) => {
      if (enabled.has(i)) for (const id of f.patchIds) ids.add(id);
    });
    return applyPatches(session.table, session.result.patches, ids);
  }, [session, enabled]);

  const copyCleaned = async () => {
    if (!cleaned) return;
    await navigator.clipboard.writeText(toTsv(cleaned));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="panel">
      <div>
        <div className="brand">
          refynr<span>.</span>
        </div>
        <p className="tagline">
          Copy cells from your sheet, paste below, review, paste the cleaned
          version back.
        </p>
      </div>

      {!session && (
        <>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Paste from Google Sheets or Excel (Ctrl+V)…"}
          />
          <div className="row">
            <button
              className="btn btn-primary"
              onClick={analyse}
              disabled={!pasted.trim()}
            >
              Analyse
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="hint">
            Everything runs inside this panel — your data never leaves the
            browser.
          </p>
        </>
      )}

      {session && cleaned && (
        <>
          <div className="card">
            <div className="score-row">
              <div>
                <div className={scoreClass(session.result.score.overall)}>
                  {session.result.score.overall}
                </div>
                <div className="score-label">Now</div>
              </div>
              <div className="score-arrow">→</div>
              <div>
                <div className={scoreClass(session.result.projectedScore.overall)}>
                  {session.result.projectedScore.overall}
                </div>
                <div className="score-label">After fixes</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="section-title">
              Findings ({session.result.findings.length})
            </h3>
            {session.result.findings.length === 0 && (
              <p className="hint">No issues found — this data looks clean.</p>
            )}
            {session.result.findings.map((f, i) => (
              <div className="finding" key={`${f.rule}-${i}`}>
                <span className={`dot dot-${f.severity}`} />
                <div>
                  <div className="finding-title">{f.title}</div>
                  <div className="finding-detail">{f.detail}</div>
                </div>
                {f.patchIds.length > 0 && (
                  <label>
                    <input
                      type="checkbox"
                      checked={enabled.has(i)}
                      onChange={() =>
                        setEnabled((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                    />
                    Apply
                  </label>
                )}
              </div>
            ))}
          </div>

          <div className="row">
            <button className="btn btn-dark" onClick={() => void copyCleaned()}>
              Copy cleaned data
            </button>
            {copied && <span className="copied">Copied — paste it back into your sheet</span>}
            <button
              className="btn btn-link"
              onClick={() => {
                setSession(null);
                setPasted("");
              }}
            >
              Start over
            </button>
          </div>
          <p className="hint">
            {cleaned.rows.length} rows out ({session.table.rows.length} in).
            Your original is untouched until you paste.
          </p>
        </>
      )}
    </div>
  );
}
