import "dotenv/config";
import { query } from "../src/db";

const email = process.argv[2];
if (!email) {
  console.error("Usage: pnpm --filter @brandblitz/api admin:grant <email>");
  process.exit(1);
}

async function main() {
  const result = await query(
    "UPDATE users SET role = 'admin', updated_at = NOW() WHERE email = $1 AND deleted_at IS NULL RETURNING id, email, role",
    [email]
  );
  if (result.rows.length === 0) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }
  console.log(`Admin role granted to ${result.rows[0].email} (${result.rows[0].id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to grant admin role:", err);
  process.exit(1);
});
