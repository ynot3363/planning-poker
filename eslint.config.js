const spfxProfile = require('@microsoft/eslint-config-spfx/lib/flat-profiles/react');
const jsdocConfig = require('eslint-plugin-jsdoc').configs['flat/recommended-typescript-error'];
const jsxA11yConfig = require('eslint-plugin-jsx-a11y').flatConfigs.recommended;
const noUnsanitizedPlugin = require('eslint-plugin-no-unsanitized');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'jest-output/**',
      'lib/**',
      'lib-commonjs/**',
      'node_modules/**',
      'release/**',
      'sharepoint/solution/**',
      'solution/**',
      'temp/**'
    ]
  },
  ...spfxProfile,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: './tsconfig.json'
      }
    }
  },
  {
    ...jsdocConfig,
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      ...jsdocConfig.rules,
      'jsdoc/check-tag-names': 'off',
      'jsdoc/require-returns-check': 'off',
      'jsdoc/tag-lines': 'off',
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: [
            'ExportDefaultDeclaration',
            'ExportNamedDeclaration',
            'FunctionDeclaration',
            'MethodDefinition'
          ]
        }
      ]
    }
  },
  {
    ...jsxA11yConfig,
    files: ['src/**/*.tsx'],
    languageOptions: {
      ...jsxA11yConfig.languageOptions,
      parserOptions: {
        ...jsxA11yConfig.languageOptions.parserOptions,
        ecmaFeatures: { jsx: true }
      }
    }
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      'no-unsanitized': noUnsanitizedPlugin
    },
    rules: {
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error'
    }
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      'jsdoc/require-jsdoc': 'off'
    }
  },
  prettierConfig
];
