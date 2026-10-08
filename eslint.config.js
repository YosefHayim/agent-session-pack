import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

// Exported callables that must carry @param, @returns, and @example.
// Target the function node itself so the required comment attaches above `export`.
const exportedCallableContexts = [
  'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
  'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > FunctionExpression',
  'ExportNamedDeclaration > FunctionDeclaration',
  'ExportDefaultDeclaration > FunctionDeclaration',
];

// Every exported statement must carry a TSDoc summary. Reporting on the export
// statement keeps the required comment in its idiomatic place, directly above `export`.
const exportedStatementContexts = ['ExportNamedDeclaration', 'ExportDefaultDeclaration'];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', '.vault-test/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    plugins: {
      tsdoc,
      jsdoc,
    },
    settings: {
      jsdoc: {
        mode: 'typescript',
      },
    },
    rules: {
      complexity: ['warn', { max: 12 }],
      'max-depth': ['error', 2],
      'no-nested-ternary': 'error',
      'tsdoc/syntax': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration',
          message: 'Use arrow const exports. Only Effect.gen callbacks may use function* syntax.',
        },
      ],
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: exportedStatementContexts,
          require: {
            ArrowFunctionExpression: false,
            FunctionDeclaration: false,
            FunctionExpression: false,
            ClassDeclaration: false,
            MethodDefinition: false,
          },
        },
      ],
      'jsdoc/require-description': ['error', { contexts: exportedStatementContexts }],
      'jsdoc/require-param': ['error', { contexts: exportedCallableContexts }],
      'jsdoc/require-param-description': ['error', { contexts: exportedCallableContexts }],
      'jsdoc/require-returns': ['error', { contexts: exportedCallableContexts }],
      'jsdoc/require-returns-description': ['error', { contexts: exportedCallableContexts }],
      'jsdoc/require-example': [
        'error',
        { contexts: exportedCallableContexts, exemptNoArguments: false },
      ],
    },
  },
);
