import type { Request, Response, NextFunction } from "express";
import { createError } from "./error";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

const SKIP_PREFIXES = ["/upload"];

export function requireJsonContentType(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  for (const prefix of SKIP_PREFIXES) {
    if (req.path.startsWith(prefix)) {
      next();
      return;
    }
  }

  if (!req.is("application/json")) {
    next(createError("Unsupported Media Type", 415));
    return;
  }

  next();
}
