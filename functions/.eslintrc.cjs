module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    "no-undef": "error",
    "no-unreachable": "error",
    "no-dupe-keys": "error",
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "eqeqeq": ["warn", "always", { null: "ignore" }],
  },
};
