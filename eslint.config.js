// Flat config for ESLint 9 + typescript-eslint.
// `recommended` keeps the rule set small: unused vars, no-explicit-any,
// strict-boolean basics — no stylistic churn on existing code.
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['lib/**', 'node_modules/**', 'test-dist/**', '.npm-cache/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed names signal "unused by design" (e.g. dispatch-uniform
      // command signatures like `list(_argv)`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
