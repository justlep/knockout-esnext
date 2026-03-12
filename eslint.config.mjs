// eslint.config.mjs (place in project root)
import globals from 'globals';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ...getPluginsAndProcessor(),
    rules: {
      'comma-dangle': ['error', 'never']
    }
  },
  {
    files: [
      'rollup.config.mjs',
      'rollup-plugin-inline-macros.mjs',
      'eslint.config.mjs'
    ],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: [
      'src/**/*.js'
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ko: false,
        DEBUG: false
      }
    },
    rules: {
      'eqeqeq': 'error',
      'curly': ['error', 'all'],
      'brace-style': ['error', '1tbs', {'allowSingleLine': true}],
      'max-len': ['warn', {
        'code': 200,
        'ignoreRegExpLiterals': true,
        'ignoreTemplateLiterals': true,
        'ignoreStrings': true,
        'ignoreComments': true
      }],
      'quotes': 'off',
      'no-mixed-spaces-and-tabs': 'error',
      'no-multi-assign': 'off',
      'no-whitespace-before-property': 'error',
      'no-alert': 'error',
      'no-fallthrough': 'warn',
      'no-eval': 'error',
      'no-prototype-builtins': 'off',
      'no-trailing-spaces': 'off',
      'no-unused-expressions': 'off',
      'no-tabs': 'error',
      'no-console': 'error',
      'no-unused-vars': ['error', {'vars': 'local', 'args': 'none'}],
      'no-else-return': 'error',
      'space-unary-ops': ['error', {'words': true, 'nonwords': false}],
      'linebreak-style': 'off',
      'semi': ['error', 'always'],
      'no-cond-assign': 'off',
      'no-lonely-if': 'error',
      'array-bracket-spacing': ['error', 'never'],
      'camelcase': ['warn', {'properties': 'always'}],
      'object-curly-spacing': ['error', 'never'],
      'eol-last': 'off',
      'no-path-concat': 'error',
      'radix': 'error',
      'wrap-iife': ['error', 'inside'],
      'yoda': ['error', 'never'],
      'no-implicit-globals': 'error',
      'no-useless-escape': 'warn'
    }
  }
];

function getPluginsAndProcessor() {
  if (process.argv.indexOf('--format=checkstyle') >= 0) {
    return {};
  }

  let count = 0;

  const logFilenamesPlugin = {
    processors: {
      log: {
        preprocess: function(text, filename) {
          console.log(++count + '. Linting ' + filename);
          return [text];
        },
        postprocess: function(messages /*, filename */) {
          return [].concat(...messages);
        },
        supportsAutofix: true
      }
    }
  };

  return {
    plugins: {
      logFilenamesPlugin
    },
    processor: 'logFilenamesPlugin/log'
  };
}
