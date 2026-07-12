"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createRecipe, type EngineOptions, type Recipe } from "@refynr/engine";
import {
  deleteCloudRecipe,
  listCloudRecipes,
  pushCloudRecipe,
  setRecipeVisibility,
  type CloudRecipe,
  type Visibility,
} from "@/lib/recipes-cloud";

/**
 * The signed-in recipe tier: sync your cleaning recipes to your account and
 * share them across your team. Rendered only when Supabase is configured and a
 * user is signed in; otherwise the browser-local library in RecipeBar is all
 * you see. Recipes are pure config — no cell data ever leaves in them.
 */
export function CloudRecipes({
  user,
  currentOptions,
  currentSkipRules,
  onApplyRecipe,
}: {
  user: User;
  currentOptions: EngineOptions;
  currentSkipRules: string[];
  onApplyRecipe: (recipe: Recipe) => void;
}) {
  const [items, setItems] = useState<CloudRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listCloudRecipes(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load cloud recipes.");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const push = async (visibility: Visibility) => {
    if (!name.trim()) return;
    setError(null);
    try {
      const recipe = createRecipe(name, currentOptions, currentSkipRules, new Date().toISOString());
      await pushCloudRecipe(user.id, recipe, visibility);
      setNaming(false);
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save to the cloud.");
    }
  };

  const toggleShare = async (r: CloudRecipe) => {
    setError(null);
    try {
      await setRecipeVisibility(r.id, r.visibility === "shared" ? "private" : "shared");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change sharing.");
    }
  };

  const remove = async (r: CloudRecipe) => {
    setError(null);
    try {
      await deleteCloudRecipe(r.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="label text-cyan!">☁ Cloud &amp; team recipes</label>
        <button
          onClick={() => setNaming((v) => !v)}
          className="rounded-md border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut"
        >
          + Save current to cloud
        </button>
      </div>

      {naming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Recipe name"
            className="min-w-[200px] flex-1 rounded-lg border border-line bg-inset px-3 py-2 text-[13px] text-body outline-none placeholder:text-dim focus:border-cyan/60"
          />
          <button
            onClick={() => push("private")}
            disabled={!name.trim()}
            className="rounded-lg border border-line2 bg-card2 px-3 py-2 text-[13px] font-medium text-body transition hover:border-mut disabled:opacity-40"
          >
            Save private
          </button>
          <button
            onClick={() => push("shared")}
            disabled={!name.trim()}
            className="rounded-lg bg-gradient-to-r from-teal to-cyan px-3 py-2 text-[13px] font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Save &amp; share
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-coral">{error}</p>}

      {loading ? (
        <p className="mt-2 font-mono text-[12px] text-dim">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[12px] text-mut">
          No cloud recipes yet. <b>Save current to cloud</b> to sync it to your account,
          or share it with your team.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-hi">
                  {r.name}
                  {r.visibility === "shared" && (
                    <span className="ml-2 rounded bg-cyan/15 px-1.5 py-0.5 font-mono text-[10px] text-cyan">
                      shared
                    </span>
                  )}
                  {!r.mine && (
                    <span className="ml-2 font-mono text-[10px] text-dim">from your team</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => onApplyRecipe(r.recipe)}
                  className="rounded-md bg-teal/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-teal transition hover:bg-teal/25"
                >
                  Apply
                </button>
                {r.mine && (
                  <>
                    <button
                      onClick={() => toggleShare(r)}
                      title={r.visibility === "shared" ? "Make private" : "Share with team"}
                      className="rounded-md border border-line2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-body"
                    >
                      {r.visibility === "shared" ? "Unshare" : "Share"}
                    </button>
                    <button
                      onClick={() => remove(r)}
                      title="Delete recipe"
                      className="rounded-md border border-line2 px-2 py-1 font-mono text-[11px] text-mut transition hover:text-coral"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
