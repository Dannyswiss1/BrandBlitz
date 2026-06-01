# Security

## SQL injection — parameterised queries (issue #113)

### Policy

All database access goes through `query(sql, params)` (`apps/api/src/db/index.ts`,
a thin wrapper over `pg`). The rules:

1. **Values are always bound parameters** — `$1`, `$2`, … — never string-concatenated
   or template-interpolated into the SQL text.
2. **Identifiers (table/column names) are never taken from caller input.** When a
   statement must be built dynamically, the identifier must come from a **fixed
   allowlist** defined in code, not from request data or object keys.

### Audit (`apps/api/src/db/queries/*.ts`)

Every production query file was reviewed. All values are passed as bound parameters;
there is **no** string concatenation of values into SQL. Two files build SQL with a
dynamic **identifier**, and both are constrained:

| File | Query calls | Dynamic identifier? | Status |
| --- | --- | --- | --- |
| `brands.ts` | 7 | `updateBrand` SET clause column names | **Fixed** — see below |
| `sessions.ts` | 11 | `recordRoundScore` `round_${round}_(score\|answer)` | Safe — `round` is validated to be `1 \| 2 \| 3` before the identifier is built |
| `challenges.ts` | 11 | none | Safe |
| `users.ts` | 8 | none | Safe |
| `leagues.ts` | 6 | none | Safe |
| `payouts.ts` | 5 | none | Safe |
| `config.ts` | 4 | none | Safe |
| `fraud-flags.ts` | 1 | none | Safe |

### `updateBrand` hardening

`updateBrand` builds its `SET` clause from the keys of an `updates` object. The
**values** were already parameterised, but the **column names** were interpolated
directly from `Object.keys(updates)`. Because TypeScript types are erased at runtime,
a caller passing an unchecked object (e.g. a request body) could smuggle a crafted key
such as `"name = '' , deleted_at = NOW() --"` straight into the SQL.

Fix: an explicit `UPDATABLE_BRAND_COLUMNS` allowlist. `updateBrand` now rejects (throws)
any key not in the allowlist **before** building the clause, so the interpolated
identifiers can only ever be known-safe column names. Regression coverage lives in
`apps/api/src/db/queries/brands.security.test.ts` (a non-allowlisted key is rejected
without touching the DB; a malicious *value* is shown to travel as a bound parameter,
never as interpolated SQL).

### Recommended follow-up — lint enforcement

To enforce rule (1)/(2) automatically, enable
[`eslint-plugin-security`](https://github.com/eslint-community/eslint-plugin-security)
on the API and add a project rule forbidding tagged/template-literal SQL that embeds
values, e.g.:

```jsonc
// eslint config for apps/api
{
  "plugins": ["security"],
  "extends": ["plugin:security/recommended"],
  "rules": {
    "security/detect-non-literal-fs-filename": "warn",
    "security/detect-object-injection": "warn"
  }
}
```

This was **not** wired up in this change because `apps/api` currently has no ESLint
configuration and CI runs no lint step; adding a from-scratch config (and triaging the
pre-existing violations it would surface) is a larger, separate task. The runtime
allowlist above is the actual control; the lint rule is defence-in-depth on top of it.
