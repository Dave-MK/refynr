import { NextResponse } from "next/server";
import {
  applyPatches,
  cleanse,
  type EngineOptions,
  type Table,
} from "@refynr/engine";

export const runtime = "nodejs";

/**
 * Developer API — the same engine that runs in the browser, over HTTP.
 *
 * POST /api/clean
 * {
 *   "headers": ["Name", "Email"],
 *   "rows": [[" john ", "JOHN@ACME.COM"]],
 *   "options": { "dateOutput": "iso" },      // optional EngineOptions
 *   "apply": true                             // optional — include cleaned rows
 * }
 *
 * Returns { health_score, projected_score, findings, patches, cleaned_data? }.
 */

interface CleanRequest {
  headers: string[];
  rows: Table["rows"];
  options?: EngineOptions;
  apply?: boolean;
}

const MAX_CELLS = 500_000;

/**
 * Bearer-token gate for the developer API. The web UI does NOT use this route
 * (it runs the engine in the browser), so it's off unless REFYNR_API_KEY is
 * set. When set, callers must send `Authorization: Bearer <REFYNR_API_KEY>`.
 */
function authorize(request: Request): NextResponse | null {
  const expected = process.env.REFYNR_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "This API is not enabled." },
      { status: 404 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  let body: CleanRequest;
  try {
    body = (await request.json()) as CleanRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
    return NextResponse.json(
      { error: "Body must include headers: string[] and rows: (string|number|boolean|null)[][]" },
      { status: 400 },
    );
  }
  if (body.headers.length * Math.max(1, body.rows.length) > MAX_CELLS) {
    return NextResponse.json(
      { error: `Table too large for this endpoint (max ${MAX_CELLS} cells).` },
      { status: 413 },
    );
  }

  const table: Table = { headers: body.headers, rows: body.rows };

  try {
    const result = cleanse(table, body.options ?? {});
    return NextResponse.json({
      health_score: result.score.overall,
      projected_score: result.projectedScore.overall,
      dimensions: result.score.dimensions,
      findings: result.findings,
      patches: result.patches,
      ...(body.apply
        ? { cleaned_data: applyPatches(table, result.patches).rows }
        : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Engine error: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
