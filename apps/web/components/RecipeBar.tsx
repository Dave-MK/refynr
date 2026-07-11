"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRecipe,
  parseInstruction,
  type EngineOptions,
  type Instruction,
  type Recipe,
} from "@refynr/engine";
import {
  downloadRecipe,
  importRecipeFile,
  loadRecipes,
  removeRecipe,
  upsertRecipe,
} from "@/lib/recipes";

/**
 * Plain-English commands + saved recipes. This is the shell for the two
 * headline roadmap features: a natural-language box that maps an instruction
 * to engine options entirely in-browser (no data leaves), and re-runnable
 * recipes that replay the same cleaning decisions on next month's export.
 */
export function RecipeBar({
  currentOptions,
  currentSkipRules,
  onApplyOptions,
  onApplyRecipe,
}: {
  currentOptions: EngineOptions;
  currentSkipRules: string[];
  /** Apply engine options only (used by the plain-English box). */
  onApplyOptions: (options: EngineOptions) => void;
  /** Apply a full recipe: options + which fixes to leave un-accepted. */
  onApplyRecipe: (recipe: Recipe) => void;
}) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [instruction, setInstruction] = useState("");
  const [feedback, setFeedback] = useState<Instruction | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setRecipes(loadRecipes()), []);

  const runInstruction = () => {
    if (!instruction.trim()) return;
    const parsed = parseInstruction(instruction);
    setFeedback(parsed);
    onApplyOptions(parsed.options);
  };

  const save = () => {
    const recipe = createRecipe(
      name,
      currentOptions,
      currentSkipRules,
      new Date().toISOString(),
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

  return (
    <div className="rounded-xl border border-line bg-card2 p-4">
      {/* Plain-English command */}
      <div>
        <label className="label text-teal!">Instruct in plain English</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runInstruction()}
            placeholder="e.g. keep duplicates, don't change casing, format dates as ISO"
            className="min-w-[240px] flex-1 rounded-lg border border-line bg-inset px-3 py-2 text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <button
            onClick={runInstruction}
            disabled={!instruction.trim()}
            className="rounded-lg bg-gradient-to-r from-teal to-cyan px-4 py-2 text-[13px] font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
        <p className="mt-2 font-mono text-[11px] text-dim">
          Parsed on your device — the instruction never leaves the browser.
        </p>
        {feedback && (
          <div className="mt-2 space-y-1 text-[12px]">
            {feedback.matched.length > 0 && (
              <p className="text-teal">
                ✓ Understood: {feedback.matched.join("; ")}
              </p>
            )}
            {feedback.unmatched.length > 0 && (
              <p className="text-coral">
                ⚠ Ignored (not understood): "{feedback.unmatched.join('", "')}"
              </p>
            )}
          </div>
        )}
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
    </div>
  );
}
