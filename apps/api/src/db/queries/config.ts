import { query } from "../index";

export type PublicConfig = Record<string, Record<string, unknown>>;

/**
 * Return the complete runtime configuration exposed to clients. Keeping the
 * mapping here gives the public endpoint a stable response regardless of
 * whether it is read from Postgres or Redis.
 */
export async function getPublicConfig(): Promise<PublicConfig> {
  const result = await query<{ key: string; value: Record<string, unknown> }>(
    "SELECT key, value FROM app_config ORDER BY key"
  );

  return Object.fromEntries(result.rows.map(({ key, value }) => [key, value]));
}

export async function getConfig(key: string): Promise<Record<string, unknown> | null> {
  const result = await query<{ value: Record<string, unknown> }>(
    "SELECT value FROM app_config WHERE key = $1",
    [key]
  );
  return result.rows[0]?.value ?? null;
}

export async function setConfig(
  key: string,
  value: Record<string, unknown>,
  actorId: string
): Promise<void> {
  const existing = await query<{ value: Record<string, unknown> }>(
    "SELECT value FROM app_config WHERE key = $1",
    [key]
  );

  await query(
    `INSERT INTO app_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, before, after)
     VALUES ($1, 'update', 'app_config', $2, $3, $4)`,
    [actorId, key, existing.rows[0]?.value ?? null, value]
  );
}
