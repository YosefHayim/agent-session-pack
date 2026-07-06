import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', '.vault-test/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    plugins: {
      tsdoc,
    },
    rules: {
      complexity: ['warn', { max: 12 }],
      'max-depth': ['error', 2],
      'no-nested-ternary': 'error',
      'tsdoc/syntax': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration',
          message: 'Use arrow const exports. Only Effect.gen callbacks may use function* syntax.',
        },
      ],
    },
  },
);
