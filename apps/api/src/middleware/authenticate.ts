import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import { redis } from "../lib/redis";

export interface AuthPayload {
  sub: string;   // user ID
  email: string;
  role: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export function tokenRevocationKey(token: string): string {
  return `auth:revoked:${token}`;
}

export function tokenTtlSeconds(payload: { exp: number }): number {
  return Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as AuthPayload & { iss?: string; aud?: string };

    if (payload.iss !== config.JWT_ISSUER || payload.aud !== config.JWT_AUDIENCE) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const revoked = await redis.get(tokenRevocationKey(token));
    if (revoked) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as AuthPayload & { iss?: string; aud?: string };

      if (payload.iss !== config.JWT_ISSUER || payload.aud !== config.JWT_AUDIENCE) {
        next();
        return;
      }

      const revoked = await redis.get(tokenRevocationKey(token));
      if (!revoked) {
        req.user = payload;
      }
    } catch {
      // ignore — optional auth
    }
  }

  next();
}

export const authenticateOptional = optionalAuth;
