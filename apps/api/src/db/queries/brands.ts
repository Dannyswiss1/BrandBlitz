import { BUCKETS, getPublicUrl } from "@brandblitz/storage";
import { query } from "../index";

export interface Brand {
  id: string;
  owner_user_id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  brand_story: string | null;
  usp: string | null;
  product_image_keys: string[];
  deleted_at?: string | null;
  created_at: string;
}

export type BrandApi = Brand & {
  product_image_urls: string[];
};

export function getProductImageUrls(brand: Pick<Brand, "product_image_keys">): string[] {
  return (brand.product_image_keys ?? []).map((key) => getPublicUrl(BUCKETS.BRAND_ASSETS, key));
}

export function toBrandApi(brand: Brand): BrandApi {
  return {
    ...brand,
    product_image_urls: getProductImageUrls(brand),
  };
}

export async function createBrand(data: Omit<Brand, "id" | "created_at">): Promise<Brand> {
  const result = await query<Brand>(
    `INSERT INTO brands
       (owner_user_id, name, logo_url, primary_color, secondary_color,
        tagline, brand_story, usp, product_image_keys)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.owner_user_id,
      data.name,
      data.logo_url,
      data.primary_color,
      data.secondary_color,
      data.tagline,
      data.brand_story,
      data.usp,
      data.product_image_keys,
    ]
  );
  return result.rows[0];
}

export async function getBrandsByOwner(ownerUserId: string): Promise<Brand[]> {
  const result = await query<Brand>(
    "SELECT * FROM brands WHERE owner_user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
    [ownerUserId]
  );
  return result.rows;
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const result = await query<Brand>("SELECT * FROM brands WHERE id = $1 AND deleted_at IS NULL", [id]);
  return result.rows[0] ?? null;
}

export async function getBrandMetaById(
  id: string
): Promise<Pick<Brand, "id" | "owner_user_id" | "deleted_at"> | null> {
  const result = await query<Pick<Brand, "id" | "owner_user_id" | "deleted_at">>(
    "SELECT id, owner_user_id, deleted_at FROM brands WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch recent brands to use as distractor pool when generating challenge questions.
 * Excludes the current brand and caps results at 20.
 */
export async function getActiveDistractorBrands(excludeBrandId: string): Promise<Brand[]> {
  const result = await query<Brand>(
    `SELECT *
     FROM brands
     WHERE id <> $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
    [excludeBrandId]
  );

  // Defensive cap in case query behavior changes in the future.
  return result.rows.slice(0, 20);
}

export async function updateBrand(
  id: string,
  ownerUserId: string,
  updates: Partial<Omit<Brand, "id" | "owner_user_id" | "created_at">>
): Promise<Brand | null> {
  const fields = Object.keys(updates);
  if (fields.length === 0) return getBrandById(id);

  const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
  const values = fields.map((f) => (updates as any)[f]);

  const result = await query<Brand>(
    `UPDATE brands SET ${setClause} WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
    [id, ownerUserId, ...values]
  );
  return result.rows[0] ?? null;
}

export async function deleteBrand(id: string, ownerUserId: string): Promise<boolean> {
  const result = await query(
    "UPDATE brands SET deleted_at = NOW() WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL RETURNING id",
    [id, ownerUserId]
  );
  return (result.rowCount ?? 0) > 0;
}
