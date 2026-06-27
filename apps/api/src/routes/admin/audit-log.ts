import { Router } from "express";
import { z } from "zod";
import { query } from "../../db";
import { createError } from "../../middleware/error";

const router = Router();

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  entity: string;
  entity_key: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

const QuerySchema = z.object({
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

router.get("/", async (req, res) => {
  const { action, from, to, search, page, pageSize } = QuerySchema.parse(req.query);

  let whereConditions: string[] = [];
  const params: unknown[] = [];

  if (action) {
    params.push(action);
    whereConditions.push(`al.action = $${params.length}`);
  }

  if (from) {
    params.push(from);
    whereConditions.push(`al.created_at >= $${params.length}::timestamp`);
  }

  if (to) {
    params.push(to);
    whereConditions.push(`al.created_at <= $${params.length}::timestamp`);
  }

  if (search) {
    params.push(`%${search}%`);
    whereConditions.push(
      `(u.username ILIKE $${params.length} OR al.entity_key ILIKE $${params.length})`
    );
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM audit_log al
     LEFT JOIN users u ON u.id = al.actor_id
     ${whereClause}`,
    params
  );

  const total = countResult.rows[0]?.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  params.push(pageSize);
  params.push(offset);

  const result = await query<AuditLogEntry>(
    `SELECT
       al.id,
       al.actor_id,
       u.username as actor_username,
       al.action,
       al.entity,
       al.entity_key,
       al.before,
       al.after,
       al.created_at
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.actor_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  res.json({
    entries: result.rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  });
});

export default router;
