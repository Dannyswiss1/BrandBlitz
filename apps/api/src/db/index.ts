import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import {
  metrics,
  dbPoolTotalConnections,
  dbPoolIdleConnections,
  dbPoolWaitingClients,
  dbPoolMaxConnections,
} from "../lib/metrics";

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  idle_in_transaction_session_timeout: 30_000,
});

pool.on("error", (err) => {
  logger.error("PostgreSQL pool error", { err: err.message });
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (duration > config.DB_SLOW_QUERY_MS) {
    logger.warn("Slow query detected", { text: text.slice(0, 80), duration });
    metrics.inc("db.slow_queries_total", { query: text.slice(0, 80) });
  }
  return result;
}

export async function connectDb(): Promise<void> {
  const client = await pool.connect();
  client.release();
  logger.info("PostgreSQL connected");
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

/**
 * Update Prometheus gauges with current PostgreSQL connection pool stats.
 * Called at scrape time by the /metrics endpoint.
 */
export function updatePoolMetrics(): void {
  dbPoolTotalConnections.set(pool.totalCount);
  dbPoolIdleConnections.set(pool.idleCount);
  dbPoolWaitingClients.set(pool.waitingCount);
  dbPoolMaxConnections.set(config.DB_POOL_MAX);
}

export { pool };
