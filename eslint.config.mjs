import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
        varsIgnorePattern: "^_",
      }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { "no-undef": "error" },
  },
  {
    ignores: [
      "node_modules/**", ".next/**", ".next-*/**", "out/**", "build/**",
      "**/dist/**", "next-env.d.ts", "examples/**", "skills", ".agenthub/**",
      ".verification/**", "output/**", ".tmp-*/**", "**/.venv/**", "db/ui-library/**",
      // User-created runnable projects are independent deliverables, not app sources.
      "lmstudio-local-agent/workspace/projects/**",
    ],
  },
];

export default eslintConfig;
