/** OpenAPI schemas for /sessions routes (#143). */

import { z } from "zod";
import { registerEndpoint } from "@/lib/openapi-registry";

const SessionToken = z.object({ challengeToken: z.string() }).openapi("ChallengeToken");

registerEndpoint({
  method: "post",
  path: "/sessions/:id/warmup-start",
  tags: ["sessions"],
  summary: "Mark warmup as started; server records the timer baseline",
  authenticated: true,
  request: {
    params: z.object({ id: z.string() }),
    body: z.object({ deviceId: z.string().optional() }).optional(),
  },
  responses: {
    200: {
      description: "Warmup initialised",
      schema: z.object({
        sessionId: z.string(),
        warmupStartedAt: z.string().datetime(),
      }),
    },
    401: { description: "Unauthenticated" },
    404: { description: "Challenge not found" },
  },
});

registerEndpoint({
  method: "post",
  path: "/sessions/:id/warmup-complete",
  tags: ["sessions"],
  summary: "Mark warmup as complete and return a challenge token (#151)",
  authenticated: true,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Warmup complete", schema: SessionToken },
    400: {
      description: "Warmup minimum-time not yet elapsed",
      schema: z.object({ remainingMs: z.number().int().nonnegative() }),
    },
    401: { description: "Unauthenticated" },
  },
});

registerEndpoint({
  method: "post",
  path: "/sessions/:id/answer/:round",
  tags: ["sessions"],
  summary: "Submit an answer for a specific challenge round (#154)",
  authenticated: true,
  request: {
    params: z.object({
      id: z.string(),
      round: z.enum(["1", "2", "3"]),
    }),
    body: z.object({
      selectedOption: z.enum(["A", "B", "C", "D"]),
      reactionTimeMs: z.number().int().min(0),
    }),
  },
  responses: {
    200: {
      description: "Answer recorded",
      schema: z.object({
        score: z.number().int(),
        correct: z.boolean(),
      }),
    },
    400: { description: "Malformed payload" },
    401: { description: "Unauthenticated" },
    409: { description: "Round already submitted" },
  },
});
