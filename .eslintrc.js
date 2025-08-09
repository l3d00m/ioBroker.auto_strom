module.exports = {
  root: true, // Don't look outside this project for inherited configs
  parser: '@typescript-eslint/parser', // Specifies the ESLint parser
  parserOptions: {
    ecmaVersion: 2018, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module', // Allows for the use of imports
    project: './tsconfig.json',
    },
  extends: [
        'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint/eslint-plugin,
    'google'
  ],
    plugins: [],
  rules: {
    'indent': 'off',
    '@typescript-eslint/indent': [
      'error',
      2,
      {
        'SwitchCase': 1,
      },
    ],
    'quotes': [
      'error',
      'single',
      {
        'avoidEscape': true,
        'allowTemplateLiterals': true,
      },
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      },
    ],
    '@typescript-eslint/no-object-literal-type-assertion': 'off',
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off', // This is necessary for Map.has()/get()!
    'camelcase': 'off',
    'max-len': ['warn', {'code': 160}],
    "complexity": ["warn", { "max": 20 }],
    "max-depth": 'warn',
    'require-jsdoc': 'off',
    'valid-jsdoc': 'off',
    eqeqeq: 'warn', // don't error on wrong equality signs
    'comma-dangle': 'off',
    'spaced-comment': 'warn',
    semi: ['warn',"never"],
    'no-warning-comments': 'warn',
  },
  overrides: [
    {
            files: ['*.test.ts'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
};