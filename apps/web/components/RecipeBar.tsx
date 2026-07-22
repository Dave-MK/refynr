"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRecipe,
  type Constraint,
  type DateOrder,
  type EngineOptions,
  type Recipe,
  type RecipeJoin,
} from "@refynr/engine";
import {
  downloadRecipe,
  importRecipeFile,
  loadRecipes,
  removeRecipe,
  upsertRecipe,
} from "@/lib/recipes";
import { CloudRecipes } from "@/components/CloudRecipes";
import { useUser } from "@/lib/supabase/useUser";
import { supabaseConfigured } from "@/lib/supabase/config";

/**
 * Cleaning options, column tools, expectations, and saved recipes — every
 * lever is a visible control (selects/checkboxes/buttons), never a text box
 * you have to guess the vocabulary of. Recipes capture the current options +
 * skips so the same decisions replay on next month's export.
 */
export function RecipeBar({
  currentOptions,
  currentSkipRules,
  currentJoin,
  columns,
  suggestions,
  onApplyOptions,
  onApplyRecipe,
  onSplit,
  onMerge,
  onUnpivot,
}: {
  currentOptions: EngineOptions;
  currentSkipRules: string[];
  /** The join that produced the current data, if any — saved into the recipe as
   *  config (key names + type), never as the joined dataset. */
  currentJoin?: RecipeJoin;
  /** Column names in the current data, for the expectations editor. */
  columns: string[];
  /** Constraints mined from the data, offered one click away. */
  suggestions: Constraint[];
  /** Apply engine options (date handling, constraints). */
  onApplyOptions: (options: EngineOptions) => void;
  /** Apply a full recipe: options + which fixes to leave un-accepted. */
  onApplyRecipe: (recipe: Recipe) => void;
  /** Split a column on a separator (shape transform, undoable). */
  onSplit: (col: number, separator: string) => void;
  /** Merge two columns with a separator (shape transform, undoable). */
  onMerge: (cols: number[], separator: string) => void;
  /** Fold columns into Field/Value rows (shape transform, undoable). */
  onUnpivot: (cols: number[]) => void;
}) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { user } = useUser();

  // Expectations editor state.
  const [ruleCol, setRuleCol] = useState("");
  const [ruleType, setRuleType] = useState<Constraint["type"]>("not-null");
  const [ruleValue, setRuleValue] = useState("");
  const constraints = currentOptions.constraints ?? [];

  // Split / merge editor state. Merge selection is an ORDERED list of column
  // indices — click order = merge order, shown as a number on each chip.
  const [splitCol, setSplitCol] = useState(0);
  const [splitSep, setSplitSep] = useState(" ");
  const [mergeSel, setMergeSel] = useState<number[]>([]);
  const [mergeSep, setMergeSep] = useState(" ");
  const [unpivotSel, setUnpivotSel] = useState<number[]>([]);
  const dedupeKey = currentOptions.dedupeKey ?? [];

  // Column indices go stale when a transform reshapes the table.
  const columnsKey = columns.join("\u0000");
  useEffect(() => {
    setMergeSel([]);
    setSplitCol(0);
    setUnpivotSel([]);
  }, [columnsKey]);

  const toggleIn = <T,>(list: T[], x: T): T[] =>
    list.includes(x) ? list.filter((y) => y !== x) : [...list, x];

  const toggleMergeCol = (i: number) => setMergeSel((prev) => toggleIn(prev, i));
  const toggleUnpivotCol = (i: number) => setUnpivotSel((prev) => toggleIn(prev, i));
  // The duplicate key holds column NAMES (engine resolves them), so it
  // survives recipes and table reshapes — no reset effect needed here.
  const toggleDedupeCol = (name: string) =>
    onApplyOptions({
      ...currentOptions,
      dedupeKey: toggleIn(dedupeKey, name).sort(
        (a, b) => columns.indexOf(a) - columns.indexOf(b),
      ),
    });

  useEffect(() => setRecipes(loadRecipes()), []);

  const addConstraint = () => {
    const column = ruleCol || columns[0];
    if (!column) return;
    const c: Constraint = { column, type: ruleType };
    if (ruleType === "regex") c.pattern = ruleValue;
    else if (ruleType === "allowed-values") c.values = ruleValue.split(",").map((s) => s.trim()).filter(Boolean);
    else if (ruleType === "range") {
      const [min, max] = ruleValue.split("-").map((s) => Number(s.trim()));
      if (!Number.isNaN(min)) c.min = min;
      if (!Number.isNaN(max)) c.max = max;
    }
    onApplyOptions({ ...currentOptions, constraints: [...constraints, c] });
    setRuleValue("");
  };

  const removeConstraint = (i: number) => {
    onApplyOptions({ ...currentOptions, constraints: constraints.filter((_, j) => j !== i) });
  };

  const needsValue = ruleType === "regex" || ruleType === "allowed-values" || ruleType === "range";
  const describeConstraint = (c: Constraint): string => {
    switch (c.type) {
      case "not-null": return "not blank";
      case "unique": return "unique";
      case "regex": return `matches /${c.pattern ?? ""}/`;
      case "range": return `${c.min ?? "−∞"}…${c.max ?? "∞"}`;
      case "allowed-values": return `in [${(c.values ?? []).join(", ")}]`;
    }
  };

  const save = () => {
    const recipe = createRecipe(
      name,
      currentOptions,
      currentSkipRules,
      new Date().toISOString(),
      currentJoin,
    );
    setRecipes(upsertRecipe(recipes, recipe));
    setNaming(false);
    setName("");
  };

  const onImport = async (file: File) => {
    setImportError(null);
    try {
      const recipe = await importRecipeFile(file);
      setRecipes(upsertRecipe(recipes, recipe));
      onApplyRecipe(recipe);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Couldn't read that recipe.");
    }
  };

  const selectCls =
    "rounded-lg border border-line bg-inset px-2.5 py-1.5 text-[13px] text-body outline-none focus:border-teal/60";
  const sepCls =
    "w-16 rounded-lg border border-line bg-inset px-2.5 py-1.5 text-center font-mono text-[12px] text-body outline-none placeholder:text-dim focus:border-teal/60";
  const btnCls =
    "rounded-lg border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut disabled:opacity-40";

  return (
    <div className="rounded-xl border border-line bg-card2 p-4">
      {/* Date handling */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="label text-teal!">Options</label>
        <label className="inline-flex items-center gap-2 font-mono text-[11px] text-mut">
          write dates as
          <select
            value={currentOptions.dateOutput ?? "iso"}
            onChange={(e) =>
              onApplyOptions({ ...currentOptions, dateOutput: e.target.value as "iso" | "uk" | "us" })
            }
            className={selectCls}
          >
            <option value="iso">ISO · 2024-01-31</option>
            <option value="uk">UK · 31/01/2024</option>
            <option value="us">US · 01/31/2024</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 font-mono text-[11px] text-mut">
          read ambiguous dates as
          <select
            value={currentOptions.dateOrder ?? "auto"}
            onChange={(e) =>
              onApplyOptions({ ...currentOptions, dateOrder: e.target.value as DateOrder })
            }
            className={selectCls}
          >
            <option value="auto">auto-detect</option>
            <option value="DMY">day first (UK)</option>
            <option value="MDY">month first (US)</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-mut" title="Rows matching on just these columns count as duplicates. With none selected, the whole row must match.">
          duplicates match on
        </span>
        {columns.map((c, i) => {
          const selected = dedupeKey.includes(c);
          return (
            <button
              key={`d-${i}`}
              onClick={() => toggleDedupeCol(c)}
              title={selected ? "Click to remove from the duplicate key" : "Click to add to the duplicate key"}
              className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] transition ${
                selected
                  ? "border-teal/50 bg-teal/15 text-teal"
                  : "border-line bg-inset text-mut hover:border-line2 hover:text-body"
              }`}
            >
              {c}
            </button>
          );
        })}
        <span className="font-mono text-[11px] text-dim">
          {dedupeKey.length === 0 ? "(whole row)" : ""}
        </span>
      </div>

      <div className="my-4 h-px bg-line" />

      {/* Column tools */}
      <div>
        <label className="label text-teal!">Split, merge &amp; unpivot columns</label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-mut">split</span>
          <select
            value={splitCol}
            onChange={(e) => setSplitCol(Number(e.target.value))}
            className={selectCls}
          >
            {columns.map((c, i) => (
              <option key={`s-${i}`} value={i}>{c}</option>
            ))}
          </select>
          <span className="font-mono text-[11px] text-mut">on</span>
          <input
            value={splitSep}
            onChange={(e) => setSplitSep(e.target.value)}
            placeholder="␣"
            title='Separator to split on (a space by default; try "," or "-")'
            className={sepCls}
          />
          <button onClick={() => onSplit(splitCol, splitSep)} className={btnCls}>
            Split
          </button>

        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-mut">merge</span>
          {columns.map((c, i) => {
            const pos = mergeSel.indexOf(i);
            const selected = pos >= 0;
            return (
              <button
                key={`m-${i}`}
                onClick={() => toggleMergeCol(i)}
                title={selected ? `Position ${pos + 1} — click to remove` : "Click to add to the merge"}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] transition ${
                  selected
                    ? "border-teal/50 bg-teal/15 text-teal"
                    : "border-line bg-inset text-mut hover:border-line2 hover:text-body"
                }`}
              >
                {selected && (
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-teal/25 text-[10px] font-bold tabular-nums">
                    {pos + 1}
                  </span>
                )}
                {c}
              </button>
            );
          })}
          <span className="font-mono text-[11px] text-mut">with</span>
          <input
            value={mergeSep}
            onChange={(e) => setMergeSep(e.target.value)}
            placeholder="␣"
            title="Text placed between the merged values (a space by default)"
            className={sepCls}
          />
          <button
            onClick={() => onMerge(mergeSel, mergeSep)}
            disabled={mergeSel.length < 2}
            className={btnCls}
          >
            Merge{mergeSel.length >= 2 ? ` ${mergeSel.length}` : ""}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="font-mono text-[11px] text-mut"
            title="Wide-to-long reshape: the chosen columns fold into Field/Value rows; every other column repeats as the row identifier"
          >
            unpivot
          </span>
          {columns.map((c, i) => {
            const selected = unpivotSel.includes(i);
            return (
              <button
                key={`u-${i}`}
                onClick={() => toggleUnpivotCol(i)}
                title={selected ? "Click to keep as an identifier column" : "Click to fold into Field/Value"}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] transition ${
                  selected
                    ? "border-teal/50 bg-teal/15 text-teal"
                    : "border-line bg-inset text-mut hover:border-line2 hover:text-body"
                }`}
              >
                {c}
              </button>
            );
          })}
          <button
            onClick={() => onUnpivot(unpivotSel)}
            disabled={unpivotSel.length < 2 || unpivotSel.length >= columns.length}
            title="Fold the selected columns into Field/Value rows"
            className={btnCls}
          >
            Unpivot{unpivotSel.length >= 2 ? ` ${unpivotSel.length}` : ""}
          </button>
        </div>
        <p className="mt-2 font-mono text-[11px] text-dim">
          Click columns in the order you want them merged; unpivot folds the picked
          columns into Field/Value rows. Shape changes re-analyse the data and are
          undoable (Ctrl+Z).
        </p>
      </div>

      <div className="my-4 h-px bg-line" />

      {/* Recipes */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="label text-teal!">Cleaning recipes</label>
          <div className="flex gap-2">
            <button
              onClick={() => setNaming((v) => !v)}
              className="rounded-md border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut"
            >
              + Save current
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut"
            >
              Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {naming && (
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              autoFocus
              placeholder="Recipe name, e.g. Monthly CRM export"
              className="min-w-[220px] flex-1 rounded-lg border border-line bg-inset px-3 py-2 text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60"
            />
            <button
              onClick={save}
              className="rounded-lg bg-gradient-to-r from-teal to-cyan px-4 py-2 text-[13px] font-semibold text-ink transition hover:brightness-110"
            >
              Save
            </button>
            {currentJoin && (
              <p className="w-full font-mono text-[11px] text-dim">
                Includes the join with{" "}
                <span className="text-teal">{currentJoin.with}</span> on{" "}
                <span className="text-teal">
                  {currentJoin.keys.map((k) => k.left).join(" + ")}
                </span>
                . The recipe saves the join's settings, not that dataset — you'll
                pick the file again when you replay it.
              </p>
            )}
          </div>
        )}

        {importError && (
          <p className="mt-2 text-[12px] text-coral">{importError}</p>
        )}

        {recipes.length === 0 ? (
          <p className="mt-2 text-[12px] text-mut">
            No saved recipes yet. Tune the fixes you want, then <b>Save current</b> to
            replay them on your next export in one click.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recipes.map((r) => (
              <li
                key={r.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-hi">{r.name}</p>
                  <p className="font-mono text-[10px] text-dim">
                    {(r.options.disabledRules?.length ?? 0) + r.skipRules.length} adjustment
                    {(r.options.disabledRules?.length ?? 0) + r.skipRules.length === 1 ? "" : "s"}
                    {r.options.dateOutput ? ` · dates ${r.options.dateOutput}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => onApplyRecipe(r)}
                    className="rounded-md bg-teal/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-teal transition hover:bg-teal/25"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => downloadRecipe(r)}
                    title="Download as a shareable file"
                    className="rounded-md border border-line2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-body"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => setRecipes(removeRecipe(recipes, r.name))}
                    title="Delete recipe"
                    className="rounded-md border border-line2 px-2 py-1 font-mono text-[11px] text-mut transition hover:text-coral"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {supabaseConfigured && user && (
        <>
          <div className="my-4 h-px bg-line" />
          <CloudRecipes
            user={user}
            currentOptions={currentOptions}
            currentSkipRules={currentSkipRules}
            onApplyRecipe={onApplyRecipe}
          />
        </>
      )}

      <div className="my-4 h-px bg-line" />

      {/* Expectations */}
      <div>
        <label className="label text-teal!">Expectations (pass/fail rules)</label>
        <p className="mt-1 font-mono text-[11px] text-dim">
          Assert what "good" looks like. Violations are flagged, never auto-changed — and save into the recipe.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={ruleCol}
            onChange={(e) => setRuleCol(e.target.value)}
            className="rounded-lg border border-line bg-inset px-2.5 py-2 text-[13px] text-body outline-none focus:border-teal/60"
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as Constraint["type"])}
            className="rounded-lg border border-line bg-inset px-2.5 py-2 text-[13px] text-body outline-none focus:border-teal/60"
          >
            <option value="not-null">must not be blank</option>
            <option value="unique">must be unique</option>
            <option value="regex">must match regex</option>
            <option value="range">must be in range</option>
            <option value="allowed-values">must be one of</option>
          </select>
          {needsValue && (
            <input
              value={ruleValue}
              onChange={(e) => setRuleValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addConstraint()}
              placeholder={
                ruleType === "regex" ? "^[A-Z]{2}\\d+$"
                : ruleType === "range" ? "0-120"
                : "active, archived, pending"
              }
              className="min-w-[160px] flex-1 rounded-lg border border-line bg-inset px-3 py-2 text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60"
            />
          )}
          <button
            onClick={addConstraint}
            disabled={columns.length === 0}
            className="rounded-lg border border-line2 bg-card px-3 py-2 font-mono text-[11px] font-semibold text-body transition hover:border-mut disabled:opacity-40"
          >
            + Add rule
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-[11px] text-dim"
              title="Rules mined from the data — each one already holds today, so adding it guards future exports"
            >
              suggested:
            </span>
            {suggestions.map((s, i) => (
              <button
                key={`sug-${s.column}-${s.type}-${i}`}
                onClick={() =>
                  onApplyOptions({ ...currentOptions, constraints: [...constraints, s] })
                }
                title="Click to add this rule"
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan/5 px-2.5 py-1 font-mono text-[11px] text-cyan transition hover:bg-cyan/15"
              >
                <span aria-hidden>+</span>
                <span>{s.column}</span>
                <span className="opacity-70">{describeConstraint(s)}</span>
              </button>
            ))}
          </div>
        )}

        {constraints.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {constraints.map((c, i) => (
              <li
                key={`${c.column}-${c.type}-${i}`}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-[11px] text-body"
              >
                <span className="text-hi">{c.column}</span>
                <span className="text-mut">{describeConstraint(c)}</span>
                <button
                  onClick={() => removeConstraint(i)}
                  title="Remove rule"
                  className="text-mut transition hover:text-coral"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
