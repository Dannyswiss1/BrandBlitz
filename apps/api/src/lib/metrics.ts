import { logger } from "./logger";
import { Registry, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register: registry });

// Database connection pool metrics
export const dbPoolTotalConnections = new Gauge({
  name: "db_pool_total_connections",
  help: "Current number of connections in the PostgreSQL pool (both idle and active)",
  registers: [registry],
});

export const dbPoolIdleConnections = new Gauge({
  name: "db_pool_idle_connections",
  help: "Number of idle connections waiting to be reused in the PostgreSQL pool",
  registers: [registry],
});

export const dbPoolWaitingClients = new Gauge({
  name: "db_pool_waiting_clients",
  help: "Number of clients currently waiting for a connection from the pool",
  registers: [registry],
});

export const dbPoolMaxConnections = new Gauge({
  name: "db_pool_max_connections",
  help: "Maximum number of connections allowed in the PostgreSQL pool (configured via DB_POOL_MAX)",
  registers: [registry],
});

export const metrics = {
  inc(name: string, labels?: Record<string, unknown>): void {
    logger.info("metric", { name, value: 1, ...labels });
  },
};
