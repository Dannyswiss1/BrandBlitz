import { createError } from "../middleware/error";
import { config } from "../lib/config";
import { z } from "zod";

const GoogleTokenInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.union([z.literal("true"), z.literal("false")]).optional(),
  aud: z.string().min(1),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

export interface VerifiedGoogleUser {
  googleId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser> {
  if (config.E2E_MOCK_GOOGLE_OAUTH === "true" && idToken.startsWith("e2e:")) {
    const [, rawEmail = "e2e-player@example.com", rawName = "E2E Player"] = idToken.split(":");
    return {
      googleId: `e2e-${rawEmail}`,
      email: rawEmail,
      name: rawName,
    };
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (!response.ok) {
    throw createError("Invalid Google token", 401, "INVALID_GOOGLE_TOKEN");
  }

  const payload = GoogleTokenInfoSchema.parse(await response.json());

  if (payload.email_verified === "false") {
    throw createError("Google email is not verified", 401, "UNVERIFIED_GOOGLE_EMAIL");
  }

  if (config.GOOGLE_CLIENT_ID && payload.aud !== config.GOOGLE_CLIENT_ID) {
    throw createError("Invalid Google token audience", 401, "INVALID_GOOGLE_TOKEN");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.picture,
  };
}
