import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser, ...globals.node,
        BoozeCore: "readonly", BoozeAudio: "readonly", BoozeRender: "readonly", BoozeScoreKey: "readonly", BoozeLeaderboard: "readonly", BoozeRewind: "readonly",
      },
    },
  },
  {
    files: ["netlify/**/*.mjs", "tests/**/*.mjs", "tools/**/*.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
  },
  // Playwright page.evaluate() callbacks run in the page
  { files: ["tests/**/*.mjs"], languageOptions: { globals: { ...globals.browser } } },
];
