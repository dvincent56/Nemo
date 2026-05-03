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
  // i18n : interdit les strings litterales dans les fichiers deja migres
  // sur next-intl. Au fur et a mesure des Plans 5-6, on ajoute les fichiers
  // / dossiers migres a cette liste de globs.
  // Pages legales : chrome migre (cf Plan 4b) mais bodies juridiques restent
  // inline FR -- non-couvertes par la regle. Inclusion de ces globs viendra
  // avec la "vraie traduction" legale.
  {
    files: [
      'src/app/\\[locale\\]/layout.tsx',
      'src/app/\\[locale\\]/page.tsx',
      'src/app/\\[locale\\]/HomeHeroTopbar.tsx',
      'src/app/\\[locale\\]/HomeView.tsx',
      'src/app/\\[locale\\]/login/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/news/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/marina/page.tsx',
      'src/app/\\[locale\\]/marina/MarinaClient.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/page.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/BoatDetailView.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/SlotCard.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/SellModal.tsx',
      'src/components/ui/**/*.{tsx,ts}',
      'src/i18n/**/*.{tsx,ts}',
    ],
    rules: {
      'react/jsx-no-literals': ['error', {
        noStrings: true,
        ignoreProps: true,
        noAttributeStrings: false,
        allowedStrings: [
          '—', '·', '•', '/', ':', '|', '×', '+', '-', '.', '(', ')',
          '→', '←', '↑', '↓', '…', '▸', '✦',
          'NE', 'M', 'O',
          'hello@nemo.sail',
          'G', '⌘',
          '4 820', '07', '12',
          '/login',
          '%', '/7', 'NM',
        ],
      }],
    },
  },
];

export default config;
