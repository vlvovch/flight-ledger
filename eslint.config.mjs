/*
 * ESLint flat config, replacing the deprecated interactive `next lint`.
 * The rules are Next's own recommended sets; the ignores are every build
 * artifact and bundled-data directory — only src/ and scripts/ are code.
 */
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    ignores: [
      ".next*/**",
      "out/**",
      "public/**",
      "data/**",
      "fixtures/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
