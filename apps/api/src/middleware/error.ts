import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";
import { captureExceptionSync } from "../lib/sentry";
import { BadRequestError } from "@stellar/stellar-sdk";
import { config } from "../lib/config";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Express 5 global error handler.
 * Express 5 automatically catches async errors — no need for try/catch in route handlers.
 * All thrown errors land here.
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = err.statusCode;
  let message = err.message;

  if (err instanceof ZodError) {
    statusCode = 400;
    message = "Validation Error";
  } else if (err instanceof BadRequestError) {
    statusCode = 400;
  }

  statusCode = statusCode ?? 500;
  const isServerError = statusCode >= 500;
  const nodeEnv = process.env.NODE_ENV ?? config.NODE_ENV;
  const isProduction = nodeEnv === "production";

  if (isServerError) {
    message = "Internal Server Error";
  }

  if (isServerError) {
    logger.error("Unhandled error", {
      err: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
    });
    // Report to Sentry with request context; sync so it doesn't delay the response.
    captureExceptionSync(err, { method: req.method, url: req.url });
  }

  const payload: Record<string, unknown> =
    isProduction && isServerError
      ? {
          error: "Internal Server Error",
          requestId: res.locals.requestId,
        }
      : {
          error: message,
        };

  if (!(isProduction && isServerError) && err.code) {
    payload.code = err.code;
  }

  if (!(isProduction && isServerError) && err instanceof ZodError) {
    payload.details = err.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
      // Surface the rejected field names when strict() rejects unknown keys.
      ...(issue.code === "unrecognized_keys"
        ? { keys: (issue as import("zod").ZodUnrecognizedKeysIssue).keys }
        : {}),
    }));
  }

  if (nodeEnv === "development" && err.stack) {
    payload.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}

export function createError(message: string, statusCode: number, code?: string): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
