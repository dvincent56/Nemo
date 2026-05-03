import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      '*.tsbuildinfo',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  // i18n : interdit les strings littérales dans les fichiers déjà migrés
  // sur next-intl. Au fur et à mesure des Plans 3-6, on ajoute les fichiers
  // / dossiers migrés à cette liste de globs. PR 2 ne couvre que le shell
  // (layout) — les routes elles-mêmes contiennent encore des strings FR
  // en dur, leur migration vient en Plans 3-6.
  {
    files: [
      'src/app/\\[locale\\]/layout.tsx',
    ],
    rules: {
      'react/jsx-no-literals': ['error', {
        noStrings: true,
        ignoreProps: true,
        noAttributeStrings: false,
        allowedStrings: ['—', '·', '•', '/', ':', '|', '×', '→', '↑', '↓', '+', '-'],
      }],
    },
  },
];

export default config;
