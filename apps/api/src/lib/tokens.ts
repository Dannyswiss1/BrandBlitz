/**
 * tokens.ts — JWT signing, verification, and Redis-backed revocation list.
 * Access token TTL: 15 min | Refresh token TTL: 30 days
 */
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { redis } from "./redis";
import { config } from "./config";

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL = "30d";
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AccessPayload { sub: string; email: string; role: string; jti: string; iat: number; exp: number; }
export interface RefreshPayload { sub: string; email: string; type: "refresh"; jti: string; iat: number; exp: number; }

function accessSecret() { return config.JWT_SECRET; }
function refreshSecret() { return config.JWT_REFRESH_SECRET ?? config.JWT_SECRET; }

/**
 * Returns the previous JWT secret (set as JWT_SECRET_PREVIOUS) that is still
 * accepted during the dual-verify rotation window.  Tokens signed with the old
 * secret remain valid for the access-token TTL (15 min) after the new secret
 * is deployed, allowing zero-downtime rotation without forced sign-outs.
 *
 * Rotation steps:
 *   1. Generate a new secret.
 *   2. Set JWT_SECRET_PREVIOUS = <old secret>, JWT_SECRET = <new secret>.
 *   3. Deploy — both secrets are accepted simultaneously.
 *   4. After 15 min (access TTL) all live tokens are signed with the new secret.
 *   5. Remove JWT_SECRET_PREVIOUS from the environment.
 */
function previousAccessSecret(): string | undefined {
  return config.JWT_SECRET_PREVIOUS;
}

export function signAccessToken(user: { id: string; email: string; role?: string | null }): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role ?? "player",
      jti: randomUUID(),
      iss: config.JWT_ISSUER,
      aud: config.JWT_AUDIENCE,
    },
    accessSecret(),
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

export function signRefreshToken(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email, type: "refresh", jti: randomUUID() }, refreshSecret(), { expiresIn: REFRESH_TOKEN_TTL });
}

/**
 * Verify an access token.  Tries the current secret first; if that fails and
 * JWT_SECRET_PREVIOUS is set, attempts verification with the previous secret
 * to support zero-downtime rotation (dual-verify window = access-token TTL).
 */
export function verifyAccessToken(token: string): AccessPayload {
  try {
    return jwt.verify(token, accessSecret()) as AccessPayload;
  } catch (primaryError) {
    const prev = previousAccessSecret();
    if (prev) {
      // May throw — let the error propagate so callers see a proper JWT error
      return jwt.verify(token, prev) as AccessPayload;
    }
    throw primaryError;
  }
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const p = jwt.verify(token, refreshSecret()) as RefreshPayload;
  if (p.type !== "refresh") throw new Error("Not a refresh token");
  return p;
}

const jtiKey = (jti: string) => `jti:${jti}`;
const userRefreshSetKey = (uid: string) => `user_refresh_jtis:${uid}`;

/** Returns true if jti was already used (reuse detected). */
export async function markJtiUsed(jti: string): Promise<boolean> {
  const result = await redis.set(jtiKey(jti), "used", "EX", REFRESH_TTL_SECONDS, "NX");
  return result === null;
}

export async function registerRefreshJti(userId: string, jti: string): Promise<void> {
  const k = userRefreshSetKey(userId);
  await redis.sadd(k, jti);
  await redis.expire(k, REFRESH_TTL_SECONDS);
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  const k = userRefreshSetKey(userId);
  const jtis = await redis.smembers(k);
  if (jtis.length > 0) {
    const pipe = redis.pipeline();
    for (const jti of jtis) pipe.set(jtiKey(jti), "revoked", "EX", REFRESH_TTL_SECONDS);
    pipe.del(k);
    await pipe.exec();
  }
}

export async function isJtiRevoked(jti: string): Promise<boolean> {
  return (await redis.get(jtiKey(jti))) !== null;
}
