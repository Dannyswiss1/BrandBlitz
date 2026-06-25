/**
 * Shared Zod utilities.
 *
 * Use `strictPatchBody` for every PATCH request body schema so that
 * unrecognised keys are rejected rather than silently stripped.  This makes
 * mass-assignment probing visible and keeps intent auditable.
 *
 * ESLint note: an `no-restricted-syntax` rule in eslint.config.ts warns when
 * `z.object(` appears in a PATCH handler without a `.strict()` call, enforcing
 * this pattern for future additions.
 */
import { z, type ZodRawShape } from "zod";

/**
 * Wraps `z.object(shape).strict()` to enforce that PATCH bodies contain only
 * the documented fields.  Zod will emit a `ZodError` with
 * `code === "unrecognized_keys"` for any extra properties, which the global
 * error handler formats as HTTP 400.
 */
export function strictPatchBody<T extends ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}
