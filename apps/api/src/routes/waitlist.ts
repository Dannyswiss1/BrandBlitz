import { Router } from "express";
import { z } from "zod";
import { query } from "../db/index";
import { createError } from "../middleware/error";
import { apiLimiter } from "../middleware/rate-limit";
import crypto from "crypto";

const router = Router();

const WaitlistSchema = z.object({
  email: z.string().email(),
});

router.post("/", apiLimiter, async (req, res) => {
  const body = WaitlistSchema.parse(req.body);
  const emailHash = crypto.createHash("sha256").update(body.email.toLowerCase().trim()).digest("hex").slice(0, 16);

  const existing = await query(
    "SELECT id, position FROM waitlist_signups WHERE email = $1",
    [body.email.toLowerCase().trim()]
  );

  if (existing.rows.length > 0) {
    res.json({
      success: true,
      position: existing.rows[0].position,
      message: "You are already on the waitlist.",
      ref: emailHash,
    });
    return;
  }

  const result = await query<{ position: number }>(
    `INSERT INTO waitlist_signups (email, email_hash)
     VALUES ($1, $2)
     RETURNING position`,
    [body.email.toLowerCase().trim(), emailHash]
  );

  res.status(201).json({
    success: true,
    position: result.rows[0].position,
    message: "You have been added to the waitlist!",
    ref: emailHash,
  });
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
