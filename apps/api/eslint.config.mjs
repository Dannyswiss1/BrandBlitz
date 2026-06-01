import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='query'][arguments.0.value=/FROM\\s+(users|challenges|brands)\\b/i]:not([arguments.0.value=/deleted_at\\s+IS\\s+NULL/i]):not([arguments.0.value=/include_deleted/i])",
          message: "Queries on soft-deletable tables must include 'deleted_at IS NULL' or 'include_deleted' comment.",
        }
      ],
    },
  },
];
