import js from '@eslint/js'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/** Слои FSD сверху вниз: каждый может зависеть только от тех, что ниже. */
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared']

const layersBelow = (layer) => LAYERS.slice(LAYERS.indexOf(layer) + 1)

/**
 * Политики зависимостей. На каждый слой их две:
 *   1) вниз по слоям — только через публичный API среза (index.ts);
 *   2) внутрь собственного среза — куда угодно.
 * `shared` — единственный слой, срезы которого (ui, lib, config, api) видят друг друга,
 * тоже через index.ts. Всё остальное отсекается `default: 'disallow'`.
 */
const policies = LAYERS.flatMap((layer) => {
  const targets = layer === 'shared' ? ['shared'] : layersBelow(layer)
  const result = []

  if (targets.length > 0) {
    result.push({
      from: { element: { type: layer } },
      allow: { to: { element: { types: { anyOf: targets } } } },
    })
  }

  // Внутри одного среза публичный API не нужен: это один и тот же модуль.
  if (layer !== 'app' && layer !== 'shared') {
    result.push({
      from: { element: { type: layer } },
      allow: {
        to: { element: { type: layer, captured: { slice: '{{from.element.captured.slice}}' } } },
      },
    })
  }

  return result
})

// Последняя политика бьёт предыдущие: что бы ни разрешил слой, лезть внутрь чужого
// среза мимо его index.ts нельзя.
policies.push({
  disallow: { to: { element: { fileInternalPath: '!index.ts' } } },
  message:
    'FSD: «{{to.type}}/{{to.internalPath}}» — это внутренность среза. Импортируйте его публичный API',
})

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'pages', pattern: 'src/pages/*', capture: ['slice'] },
        { type: 'widgets', pattern: 'src/widgets/*', capture: ['slice'] },
        { type: 'features', pattern: 'src/features/*', capture: ['slice'] },
        { type: 'entities', pattern: 'src/entities/*', capture: ['slice'] },
        { type: 'shared', pattern: 'src/shared/*', capture: ['segment'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message: 'FSD: «{{from.type}}» не может импортировать «{{to.type}}»',
          policies,
        },
      ],
      // Каждый файл внутри src обязан принадлежать слою.
      'boundaries/no-unknown-files': 'error',
    },
  },
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
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
)
