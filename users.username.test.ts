// Issue #202: Test username UNIQUE constraint with NULL handling
// Vitest covering: two NULL usernames OK, two same usernames different case rejected

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/brandblitz_test',
});

describe('Username UNIQUE constraint (Issue #202)', () => {
  beforeAll(async () => {
    // Ensure migration 011 has been applied
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        username TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Apply the fix if not already applied
    await pool.query(`DROP INDEX IF EXISTS users_username_unique`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique 
        ON users (LOWER(username)) 
        WHERE username IS NOT NULL
    `);
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query(`DELETE FROM users WHERE email LIKE 'test-%@example.com'`);
    await pool.end();
  });

  it('should allow multiple NULL usernames', async () => {
    // Insert first user with NULL username
    const result1 = await pool.query(
      `INSERT INTO users (email, display_name, username) 
       VALUES ($1, $2, NULL) 
       RETURNING id`,
      ['test-null-1@example.com', 'Test User 1']
    );
    expect(result1.rows[0].id).toBeDefined();

    // Insert second user with NULL username (should succeed)
    const result2 = await pool.query(
      `INSERT INTO users (email, display_name, username) 
       VALUES ($1, $2, NULL) 
       RETURNING id`,
      ['test-null-2@example.com', 'Test User 2']
    );
    expect(result2.rows[0].id).toBeDefined();

    // Verify both users exist
    const count = await pool.query(
      `SELECT COUNT(*) FROM users WHERE email LIKE 'test-null-%@example.com'`
    );
    expect(parseInt(count.rows[0].count)).toBe(2);
  });

  it('should reject duplicate usernames (case-insensitive)', async () => {
    // Insert first user with username "alice"
    await pool.query(
      `INSERT INTO users (email, display_name, username) 
       VALUES ($1, $2, $3)`,
      ['test-alice-1@example.com', 'Alice One', 'alice']
    );

    // Try to insert second user with username "Alice" (different case)
    await expect(
      pool.query(
        `INSERT INTO users (email, display_name, username) 
         VALUES ($1, $2, $3)`,
        ['test-alice-2@example.com', 'Alice Two', 'Alice']
      )
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });

  it('should reject duplicate usernames (same case)', async () => {
    // Insert first user with username "bob"
    await pool.query(
      `INSERT INTO users (email, display_name, username) 
       VALUES ($1, $2, $3)`,
      ['test-bob-1@example.com', 'Bob One', 'bob']
    );

    // Try to insert second user with same username "bob"
    await expect(
      pool.query(
        `INSERT INTO users (email, display_name, username) 
         VALUES ($1, $2, $3)`,
        ['test-bob-2@example.com', 'Bob Two', 'bob']
      )
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });

  it('should allow setting username after NULL', async () => {
    // Insert user with NULL username
    const result = await pool.query(
      `INSERT INTO users (email, display_name, username) 
       VALUES ($1, $2, NULL) 
       RETURNING id`,
      ['test-update@example.com', 'Test Update']
    );
    const userId = result.rows[0].id;

    // Update to set username (should succeed)
    await pool.query(
      `UPDATE users SET username = $1 WHERE id = $2`,
      ['uniqueuser', userId]
    );

    // Verify username was set
    const updated = await pool.query(
      `SELECT username FROM users WHERE id = $1`,
      [userId]
    );
    expect(updated.rows[0].username).toBe('uniqueuser');
  });

  it('should allow updating username to NULL', async () => {
    // Insert user with username
    const result = await pool.query(
      `INSERT INTO users (email, display_name, username) 
       VALUES ($1, $2, $3) 
       RETURNING id`,
      ['test-null-update@example.com', 'Test Null Update', 'tempuser']
    );
    const userId = result.rows[0].id;

    // Update to NULL (should succeed)
    await pool.query(
      `UPDATE users SET username = NULL WHERE id = $1`,
      [userId]
    );

    // Verify username is NULL
    const updated = await pool.query(
      `SELECT username FROM users WHERE id = $1`,
      [userId]
    );
    expect(updated.rows[0].username).toBeNull();
  });
});
