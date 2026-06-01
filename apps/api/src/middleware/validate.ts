import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { createError } from "./error";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const first = result.error.issues[0];
      throw createError(
        first ? `${first.path.join(".")}: ${first.message}` : "Validation error",
        400,
        "VALIDATION_ERROR"
      );
    }
    req[source] = result.data;
    next();
  };
}
