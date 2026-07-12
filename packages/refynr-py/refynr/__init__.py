"""refynr — Python wrapper for the refynr data-cleaning CLI.

Non-destructive, deterministic tabular data cleaning from a notebook or script.
This package does NOT re-implement the engine: it shells out to the same
`@refynr/cli` the web app is built on, so results are identical everywhere
("one engine, many shells"). Requires Node.js on the PATH and the CLI built
(`pnpm --filter @refynr/cli build`).

    import refynr
    summary = refynr.clean("customers.csv", min_score=85)   # dict; raises if the gate fails
    rows    = refynr.clean_to_rows("customers.csv")          # list[dict] of cleaned data
    df      = refynr.clean_to_dataframe("customers.csv")     # pandas DataFrame (needs pandas)
    changes = refynr.diff("last_month.csv", "this_month.csv", key="id")
"""

from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

__all__ = [
    "clean",
    "clean_to_rows",
    "clean_to_dataframe",
    "diff",
    "available",
    "RefynrError",
]

__version__ = "0.1.0"


class RefynrError(RuntimeError):
    """Raised when the underlying refynr CLI fails for a non-gate reason."""


def _node() -> str:
    return os.environ.get("REFYNR_NODE") or shutil.which("node") or "node"


def _cli_path() -> str:
    """Locate cli.js: env override, else relative to this file in the monorepo."""
    env = os.environ.get("REFYNR_CLI")
    if env:
        return env
    here = Path(__file__).resolve()
    # packages/refynr-py/refynr/__init__.py -> packages/cli/dist/cli.js
    guess = here.parents[2] / "cli" / "dist" / "cli.js"
    if not guess.exists():
        raise RefynrError(
            f"Couldn't find the refynr CLI at {guess}. Build it with "
            "`pnpm --filter @refynr/cli build`, or set REFYNR_CLI to cli.js."
        )
    return str(guess)


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            [_node(), _cli_path(), *args],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:  # node missing
        raise RefynrError(
            "Node.js was not found. Install Node, or set REFYNR_NODE to the node binary."
        ) from exc


def available() -> bool:
    """True if the CLI can be invoked (Node present and cli.js built)."""
    try:
        return _run(["--help"]).returncode == 0
    except RefynrError:
        return False


def clean(
    path: str,
    *,
    recipe: Optional[str] = None,
    min_score: Optional[float] = None,
    out: Optional[str] = None,
    report: Optional[str] = None,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    """Clean a CSV/TSV/JSON/Parquet file and return a summary dict.

    The summary includes ``scoreBefore``, ``afterScore``, ``rowsRemoved``,
    ``cellsChanged``, the per-rule breakdown, and ``passed`` (False when a
    ``min_score`` gate was set and not met). The input file is never modified;
    pass ``out`` to write a cleaned copy, ``report`` for a Markdown audit.
    """
    args = ["clean", str(path), "--json"]
    if recipe:
        args += ["--recipe", str(recipe)]
    if min_score is not None:
        args += ["--min-score", str(min_score)]
    if out:
        args += ["--out", str(out)]
    if report:
        args += ["--report", str(report)]
    if limit is not None:
        args += ["--limit", str(limit)]

    proc = _run(args)
    if not proc.stdout.strip():
        raise RefynrError(proc.stderr.strip() or "refynr clean produced no output.")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RefynrError(proc.stderr.strip() or "refynr clean returned invalid JSON.") from exc
    # A non-zero exit with valid JSON means the min-score gate failed (not an error).
    data["passed"] = proc.returncode == 0
    return data


def clean_to_rows(path: str, *, recipe: Optional[str] = None, limit: Optional[int] = None) -> list[dict[str, str]]:
    """Clean a file and return the cleaned rows as a list of dicts."""
    args = ["clean", str(path)]
    if recipe:
        args += ["--recipe", str(recipe)]
    if limit is not None:
        args += ["--limit", str(limit)]
    proc = _run(args)
    if not proc.stdout.strip():
        raise RefynrError(proc.stderr.strip() or "refynr clean produced no output.")
    return list(csv.DictReader(io.StringIO(proc.stdout)))


def clean_to_dataframe(path: str, *, recipe: Optional[str] = None, limit: Optional[int] = None):
    """Clean a file and return a pandas DataFrame (requires pandas)."""
    try:
        import pandas as pd
    except ImportError as exc:  # pragma: no cover
        raise RefynrError("clean_to_dataframe needs pandas: pip install pandas") from exc
    return pd.DataFrame(clean_to_rows(path, recipe=recipe, limit=limit))


def diff(
    before: str,
    after: str,
    *,
    key: Optional[str] = None,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    """Diff two versions of a dataset. Returns added/removed/changed/unchanged
    with cell-level detail (matched on ``key``, or an inferred key)."""
    args = ["diff", str(before), str(after), "--json"]
    if key:
        args += ["--key", key]
    if limit is not None:
        args += ["--limit", str(limit)]
    proc = _run(args)
    if not proc.stdout.strip():
        raise RefynrError(proc.stderr.strip() or "refynr diff produced no output.")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RefynrError(proc.stderr.strip() or "refynr diff returned invalid JSON.") from exc
