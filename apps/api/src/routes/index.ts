import type { Express } from "express";
import authRoutes from "./auth";
import brandsRoutes from "./brands";
import challengesRoutes from "./challenges";
import sessionsRoutes from "./sessions";
import uploadRoutes from "./upload";
import usersRoutes from "./users";
import leaderboardRoutes from "./leaderboard";
import webhooksRoutes from "./webhooks";
import leaguesRoutes from "./leagues";
import adminConfigRoutes from "./admin/config";
import adminUsersRoutes from "./admin/users";
import adminFraudRoutes from "./admin/fraud";
import adminChallengesRoutes from "./admin/challenges";
import deleteAccountRoutes from "./me/delete-account";
import docsRoutes from "./docs";

export function registerRoutes(app: Express): void {
  // #143 — interactive OpenAPI 3.1 docs at /docs (Scalar UI) plus
  // the JSON spec at /docs/openapi.json. Mounted first so it can't
  // be accidentally shadowed by a route added below.
  app.use("/docs", docsRoutes);
  app.use("/auth", authRoutes);
  app.use("/brands", brandsRoutes);
  app.use("/challenges", challengesRoutes);
  app.use("/sessions", sessionsRoutes);
  app.use("/upload", uploadRoutes);
  app.use("/users", usersRoutes);
  app.use("/leaderboard", leaderboardRoutes);
  app.use("/webhooks", webhooksRoutes);
  app.use("/leagues", leaguesRoutes);
  app.use("/admin/config", adminConfigRoutes);
  app.use("/admin/users", adminUsersRoutes);
  app.use("/admin/fraud-flags", adminFraudRoutes);
  app.use("/admin/challenges", adminChallengesRoutes);
  app.use("/me/delete-account", deleteAccountRoutes);
}
