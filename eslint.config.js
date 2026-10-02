const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", "fonts/**", "images/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser, Log: "readonly", moment: "readonly" }
    },
    // Existing code has some unused variables and repeated `var` declarations;
    // report them as warnings so only real problems (undefined names, syntax errors) fail CI.
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-redeclare": ["warn", { builtinGlobals: false }],
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn"
    }
  }
];
