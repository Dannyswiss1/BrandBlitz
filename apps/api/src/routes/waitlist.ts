import { Router } from "express";
import { z } from "zod";
import { query } from "../db/index";
import { createError } from "../middleware/error";
import { apiLimiter, waitlistLimiter } from "../middleware/rate-limit";

const router = Router();

const WaitlistSchema = z.object({
  email: z.string().email(),
  referral_code: z.string().max(64).optional(),
});

router.post("/", waitlistLimiter, async (req, res) => {
  const body = WaitlistSchema.parse(req.body);
  const email = body.email.toLowerCase().trim();

  await query(
    `INSERT INTO waitlist (email, referral_code)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, body.referral_code ?? null]
  );

  // Always return 200 to prevent email enumeration.
  res.json({ success: true });
});

router.get("/position/:email", apiLimiter, async (req, res) => {
  const email = z.string().email().parse(req.params.email);
  const result = await query<{ position: number }>(
    "SELECT position FROM waitlist_signups WHERE email = $1",
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    throw createError("Email not found on waitlist", 404);
  }

  res.json({ position: result.rows[0].position });
});

export default router;
