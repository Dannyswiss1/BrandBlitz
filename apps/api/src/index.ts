import "dotenv/config";
// Sentry must be initialised before any other imports that use it.
import { initSentry } from "./lib/sentry";
void initSentry();
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { errorHandler } from "./middleware/error";
import { referralAttributionMiddleware } from "./middleware/referral-attribution";
import { apiLimiter } from "./middleware/rate-limit";
import { requireHttps } from "./middleware/require-https";
import { connectDb, closeDb, query } from "./db";
import { connectRedis, redis } from "./lib/redis";
import { payoutQueue } from "./queues/payout.queue";
import { leagueQueue } from "./queues/league.queue";
import { logger } from "./lib/logger";
import { config } from "./lib/config";

const app = express();
const PORT = config.PORT;
let isShuttingDown = false;

// ── Security & Parsing ─────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: config.WEB_URL,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(requireHttps);
app.use(referralAttributionMiddleware);
app.use(
  compression({
    threshold: 1024,
  })
);
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      if (
        req.headers["x-webhook-signature"] ||
        req.path.startsWith("/webhooks")
      ) {
        (req as any).rawBody = buf;
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// ── Global rate limit ──────────────────────────────────────────────────────
app.use(apiLimiter);

// ── Health check (before auth middleware) ──────────────────────────────────
app.get("/health", (_req, res) => {
  if (isShuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ─────────────────────────────────────────────────────────────
registerRoutes(app);

// ── Global error handler (Express 5 — catches async throws automatically) ──
app.use(errorHandler);

export { app };

// ── Start ──────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await connectDb();
  await connectRedis();

  // ── Admin bootstrap ──────────────────────────────────────────────────────
  if (config.ADMIN_BOOTSTRAP_EMAIL) {
    const result = await query(
      "UPDATE users SET role = 'admin', updated_at = NOW() WHERE email = $1 AND deleted_at IS NULL AND role != 'admin' RETURNING id, email",
      [config.ADMIN_BOOTSTRAP_EMAIL]
    );
    if (result.rows.length > 0) {
      logger.info(`Admin role granted to bootstrap email: ${result.rows[0].email}`);
    } else {
      logger.info(`Admin bootstrap: ${config.ADMIN_BOOTSTRAP_EMAIL} already admin or not found`);
    }
  }

  const server = app.listen(PORT, () => {
    logger.info(`API running on port ${PORT}`, { env: config.NODE_ENV });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — starting graceful shutdown`);
    isShuttingDown = true;

    server.close(async () => {
      try {
        await payoutQueue.close();
        await leagueQueue.close();
        await closeDb();
        await redis.disconnect();
        logger.info("Shutdown complete");
        process.exit(0);
      } catch (err) {
        logger.error("Error during shutdown", { err });
        process.exit(1);
      }
    });

    // Force exit after 10s if server hasn't closed
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (config.NODE_ENV !== "test") {
  start().catch((err) => {
    logger.error("Failed to start API", { err });
    process.exit(1);
  });
}
