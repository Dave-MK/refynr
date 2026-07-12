import { parseRecipe, type Recipe } from "@refynr/engine";
import { createClient } from "@/lib/supabase/client";

/**
 * Cloud recipe library (Supabase). The signed-in tier on top of the
 * browser-local library in `recipes.ts`: recipes sync across a user's devices
 * and, when marked `shared`, become a team/org library visible to everyone
 * signed into this refynr instance. Recipes are pure config (no cell data),
 * and all access is guarded by row-level security (see 0002_shared_recipes.sql)
 * — CRUD runs directly from the browser client, no server route needed.
 */

export type Visibility = "private" | "shared";

export interface CloudRecipe {
  id: string;
  name: string;
  recipe: Recipe;
  visibility: Visibility;
  /** True if the current user owns this row (so the UI can show edit controls). */
  mine: boolean;
  updatedAt: string;
}

interface Row {
  id: string;
  user_id: string;
  name: string;
  recipe: unknown;
  visibility: Visibility;
  updated_at: string;
}

/** Validate a stored recipe back into a typed Recipe, or null if malformed. */
function normalize(value: unknown): Recipe | null {
  try {
    return parseRecipe(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** List the user's own recipes plus any shared across the instance. */
export async function listCloudRecipes(userId: string): Promise<CloudRecipe[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cloud_recipes")
    .select("id,user_id,name,recipe,visibility,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Row[]).flatMap((row) => {
    const recipe = normalize(row.recipe);
    if (!recipe) return [];
    return [
      {
        id: row.id,
        name: row.name,
        recipe,
        visibility: row.visibility,
        mine: row.user_id === userId,
        updatedAt: row.updated_at,
      },
    ];
  });
}

/** Create or update one of the user's recipes (keyed by name). */
export async function pushCloudRecipe(
  userId: string,
  recipe: Recipe,
  visibility: Visibility,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("cloud_recipes").upsert(
    {
      user_id: userId,
      name: recipe.name,
      recipe,
      visibility,
    },
    { onConflict: "user_id,name" },
  );
  if (error) throw new Error(error.message);
}

/** Flip a recipe between private and shared (owner only, enforced by RLS). */
export async function setRecipeVisibility(id: string, visibility: Visibility): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("cloud_recipes")
    .update({ visibility })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCloudRecipe(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("cloud_recipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
