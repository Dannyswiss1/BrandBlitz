import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-level SQL-injection regression tests for the one query that builds a
// dynamic SET clause (#113). The DB layer is mocked so these run without a
// database — they assert how the SQL is *constructed*, not its execution.
vi.mock("../index", () => ({ query: vi.fn() }));

import { query } from "../index";
import { updateBrand } from "./brands";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("updateBrand SQL-injection hardening (#113)", () => {
  it("rejects a non-allowlisted column key and never touches the DB", async () => {
    await expect(
      updateBrand("brand-1", "owner-1", {
        // identifier-injection attempt smuggled in as an object key
        ["name = '' , deleted_at = NOW() --"]: "x",
      } as never)
    ).rejects.toThrow(/disallowed column/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("fails closed when a bad key is mixed with a valid one", async () => {
    await expect(
      updateBrand("brand-1", "owner-1", {
        name: "ok",
        ["x); DROP TABLE brands; --"]: 1,
      } as never)
    ).rejects.toThrow(/disallowed column/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("treats a malicious VALUE as a bound parameter, never interpolated SQL", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: "brand-1" }], rowCount: 1 } as never);

    const evil = "'; DROP TABLE brands; --";
    await updateBrand("brand-1", "owner-1", { name: evil });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    // The SET clause carries only a placeholder for the value …
    expect(sql).toContain("SET name = $3");
    // … and the attacker string is never spliced into the SQL text.
    expect(sql).not.toContain(evil);
    // It is passed as a bound parameter instead.
    expect(params).toEqual(["brand-1", "owner-1", evil]);
  });

  it("builds a parameterised multi-column update for allowed columns", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: "brand-1" }], rowCount: 1 } as never);

    await updateBrand("brand-1", "owner-1", {
      name: "New",
      tagline: "Tag",
      primary_color: "#fff",
    });

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SET name = $3, tagline = $4, primary_color = $5");
    expect(sql).toContain("WHERE id = $1 AND owner_user_id = $2");
    expect(params).toEqual(["brand-1", "owner-1", "New", "Tag", "#fff"]);
  });
});
