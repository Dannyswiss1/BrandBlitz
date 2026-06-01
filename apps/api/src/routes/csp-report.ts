import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";

const router = Router();

/**
 * CSP Violation Report Endpoint
 *
 * Receives Content-Security-Policy violation reports from browsers.
 * Used to monitor and triage XSS attempts and CSP misconfigurations.
 *
 * Spec: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only
 */
router.post("/", (req: Request, res: Response) => {
  const report = req.body["csp-report"];

  if (!report) {
    res.status(400).json({ error: "Missing csp-report body" });
    return;
  }

  // Log CSP violation with context
  logger.warn("CSP violation detected", {
    documentUri: report["document-uri"],
    violatedDirective: report["violated-directive"],
    effectiveDirective: report["effective-directive"],
    originalPolicy: report["original-policy"],
    blockedUri: report["blocked-uri"],
    sourceFile: report["source-file"],
    lineNumber: report["line-number"],
    columnNumber: report["column-number"],
    statusCode: report["status-code"],
    disposition: report.disposition || "report-only",
  });

  // TODO: In production, send to monitoring service (Sentry, DataDog, etc.)
  // Example:
  // if (report["violated-directive"].includes("script")) {
  //   Sentry.captureMessage("CSP script violation", {
  //     level: "warning",
  //     contexts: { csp: report },
  //   });
  // }

  res.status(204).send();
});

export default router;
