/** OpenAPI schemas for /leaderboard routes (#143). */

import { z } from "zod";
import { registerEndpoint } from "@/lib/openapi-registry";

const LeaderboardRow = z
  .object({
    rank: z.number().int().positive(),
    userId: z.string(),
    displayName: z.string().nullable(),
    totalScore: z.number().int(),
  })
  .openapi("LeaderboardRow");

registerEndpoint({
  method: "get",
  path: "/leaderboard/:challengeId",
  tags: ["leaderboard"],
  summary: "Top-N leaderboard for a single challenge",
  request: {
    params: z.object({ challengeId: z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  },
  responses: {
    200: {
      description: "Leaderboard page",
      schema: z.object({ rows: z.array(LeaderboardRow), generatedAt: z.string().datetime() }),
    },
  },
});
