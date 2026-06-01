import type { Request, Response, NextFunction } from "express";
import { createError } from "./error";
import { getCurrentLegalDocument, findUserLegalAcceptance } from "../db/queries/legal";

export async function requireCurrentTosAccepted(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    throw createError("No token provided", 401);
  }

  const tos = await getCurrentLegalDocument("tos");
  if (!tos) {
    next();
    return;
  }

  const acceptance = await findUserLegalAcceptance(req.user.sub, "tos", tos.version);
  if (!acceptance) {
    throw createError("Current Terms of Service must be accepted", 403, "TOS_NOT_ACCEPTED");
  }

  next();
}
