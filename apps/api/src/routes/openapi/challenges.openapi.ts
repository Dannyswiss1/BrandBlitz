/** OpenAPI schemas for /challenges routes (#143). */

import { z } from "zod";
import { registerEndpoint } from "@/lib/openapi-registry";

const Challenge = z
  .object({
    id: z.string(),
    brand_id: z.string(),
    challenge_id: z.string(),
    pool_amount_usdc: z.string(),
    status: z.enum(["active", "paused", "completed"]),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    brand_name: z.string(),
    tagline: z.string().nullable().optional(),
    logo_url: z.string().nullable().optional(),
  })
  .openapi("Challenge");

const Question = z
  .object({
    id: z.string(),
    challenge_id: z.string(),
    round: z.number().int().min(1).max(3),
    question_type: z.string(),
    prompt_type: z.enum(["text", "brand_image", "product_image"]),
    question_text: z.string(),
    option_a: z.string(),
    option_b: z.string(),
    option_c: z.string(),
    option_d: z.string(),
  })
  .openapi("ChallengeQuestion");

registerEndpoint({
  method: "get",
  path: "/challenges/:id",
  tags: ["challenges"],
  summary: "Fetch a single challenge with its question set",
  authenticated: true,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Challenge",
      schema: z.object({ challenge: Challenge, questions: z.array(Question) }),
    },
    401: { description: "Unauthenticated" },
    404: { description: "Challenge not found" },
  },
});

registerEndpoint({
  method: "get",
  path: "/challenges",
  tags: ["challenges"],
  summary: "List active challenges (paginated)",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: "Challenges page",
      schema: z.object({
        challenges: z.array(Challenge),
        nextCursor: z.string().nullable(),
      }),
    },
  },
});
