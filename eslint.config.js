import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // У apps/web свой конфиг: там подключены boundaries и правила React.
    // Он запускается через `pnpm -r lint` (см. скрипт `lint` в корневом package.json).
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'apps/web/**'],
  },
  {
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Скрипты CI — обычный Node без TypeScript. Глобалии перечислены руками:
    // ради двух имён тянуть пакет `globals` в зависимости нечего.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
)
