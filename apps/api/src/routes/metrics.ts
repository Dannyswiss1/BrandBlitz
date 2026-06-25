import { Router } from "express";
import { registry } from "../lib/metrics";
import { updatePoolMetrics } from "../db";

const router = Router();

/**
 * GET /metrics
 * Prometheus scraping endpoint — exposes application and database pool metrics.
 */
router.get("/", async (_req, res) => {
  // Sample pool stats at scrape time to reflect current state
  updatePoolMetrics();

  res.setHeader("Content-Type", registry.contentType);
  const metrics = await registry.metrics();
  res.send(metrics);
});

export default router;
