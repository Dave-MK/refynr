import {
  parseRecipe,
  serializeRecipe,
  type Recipe,
} from "@refynr/engine";

/**
 * Browser-local recipe storage. Recipes are pure config (no cell data), so
 * keeping them in localStorage is safe and keeps refynr account-free: your
 * saved cleaning steps live on your device, exactly like the data does.
 */
const KEY = "refynr.recipes.v1";

export function loadRecipes(): Recipe[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Validate each through the engine so a corrupt entry can't poison the list.
    return arr.flatMap((r) => {
      try {
        return [parseRecipe(JSON.stringify(r))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveRecipes(recipes: Recipe[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(recipes));
}

/** Add or replace a recipe by name; returns the new list. */
export function upsertRecipe(recipes: Recipe[], recipe: Recipe): Recipe[] {
  const next = recipes.filter((r) => r.name !== recipe.name);
  next.unshift(recipe);
  saveRecipes(next);
  return next;
}

export function removeRecipe(recipes: Recipe[], name: string): Recipe[] {
  const next = recipes.filter((r) => r.name !== name);
  saveRecipes(next);
  return next;
}

/** Download a recipe as a shareable .json file. */
export function downloadRecipe(recipe: Recipe): void {
  const blob = new Blob([serializeRecipe(recipe)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${recipe.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.refynr.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read + validate a recipe from an imported file. */
export async function importRecipeFile(file: File): Promise<Recipe> {
  return parseRecipe(await file.text());
}
