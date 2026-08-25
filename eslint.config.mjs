// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      '**/node_modules/**',
      'packages/shared/src/db.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The Supabase service-role key is a full-database-bypass secret. It must
    // only ever be read in services/worker (see services/worker/src/config.ts).
    // Any *string literal* mentioning SERVICE_ROLE outside services/worker is
    // almost certainly someone copy-pasting a secret reference into client or
    // edge-function code — fail the build, don't wait for code review.
    files: ['apps/mobile/**', 'supabase/functions/**', 'packages/**'],
    ignores: ['packages/shared/src/db.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/SERVICE_ROLE/]",
          message:
            'The Supabase service-role key must never be referenced outside services/worker.',
        },
      ],
    },
  },
  eslintConfigPrettier,
);
