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
  // dev/simulator/** : outil interne gate par NODE_ENV !== 'production',
  // jamais expose aux utilisateurs finaux. Volontairement hors scope i18n.
  {
    files: [
      'src/app/\\[locale\\]/layout.tsx',
      'src/app/\\[locale\\]/page.tsx',
      'src/app/\\[locale\\]/HomeHeroTopbar.tsx',
      'src/app/\\[locale\\]/HomeView.tsx',
      'src/app/\\[locale\\]/not-found.tsx',
      'src/app/\\[locale\\]/login/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/news/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/marina/page.tsx',
      'src/app/\\[locale\\]/marina/MarinaClient.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/page.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/BoatDetailView.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/SlotCard.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/SellModal.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/SlotDrawer.tsx',
      'src/app/\\[locale\\]/marina/inventory/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/races/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/ranking/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/profile/page.tsx',
      'src/app/\\[locale\\]/profile/ProfileView.tsx',
      'src/app/\\[locale\\]/profile/\\[username\\]/**/*.{tsx,ts}',
      'src/app/\\[locale\\]/profile/settings/page.tsx',
      'src/app/\\[locale\\]/profile/settings/SettingsView.tsx',
      'src/app/\\[locale\\]/profile/social/page.tsx',
      'src/app/\\[locale\\]/profile/social/SocialView.tsx',
      'src/app/\\[locale\\]/team/\\[slug\\]/page.tsx',
      'src/app/\\[locale\\]/team/\\[slug\\]/TeamView.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/customize/page.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/customize/CustomizeLoader.tsx',
      'src/app/\\[locale\\]/marina/\\[boatId\\]/customize/CustomizeView.tsx',
      'src/app/\\[locale\\]/play/\\[raceId\\]/page.tsx',
      'src/app/\\[locale\\]/play/\\[raceId\\]/PlayClient.tsx',
      'src/components/play/HudBar.tsx',
      'src/components/play/Compass.tsx',
      'src/components/play/CoordsDisplay.tsx',
      'src/components/play/WindLegend.tsx',
      'src/components/play/CursorTooltip.tsx',
      'src/components/play/RankingPanel.tsx',
      'src/components/play/LayersWidget.tsx',
      'src/components/play/MapAppearanceModal.tsx',
      'src/components/play/SailPanel.tsx',
      'src/components/play/ConfirmReplaceProgModal.tsx',
      'src/components/play/RouterPanel.tsx',
      'src/components/play/RouterControls.tsx',
      'src/components/play/ProgPanel.tsx',
      'src/components/play/prog/ProgBanner.tsx',
      'src/components/play/prog/ProgToast.tsx',
      'src/components/play/prog/ProgFooter.tsx',
      'src/components/play/prog/ProgQueueView.tsx',
      'src/components/play/prog/CapEditor.tsx',
      'src/components/play/prog/WpEditor.tsx',
      'src/components/play/prog/FinalCapEditor.tsx',
      'src/components/play/prog/SailEditor.tsx',
      'src/components/play/compass/CompassReadouts.tsx',
      'src/components/play/compass/CompassLockToggle.tsx',
      'src/components/play/TimeStepper.tsx',
      'src/components/play/ZoomCompact.tsx',
      'src/components/play/SlidePanel.tsx',
      'src/components/play/timeline/TimelineHeader.tsx',
      'src/components/play/timeline/TimelineControls.tsx',
      'src/components/play/timeline/TimelineTrack.tsx',
      // EffectsSummary intentionnellement non couvert : composition dynamique
      // de strings FR ("vitesse au près", "temps virement"...) — refactor
      // dédié quand on touchera vraiment aux traductions.
      // CustomizeView intentionnellement non couvert : 832 lignes, sera fait
      // dans un commit dédié (Plan 5b-customize).
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
          '→', '←', '↑', '↓', '…', '▸', '✦', '✕', '▲', '▼', '@',
          'NE', 'M', 'O',
          'hello@nemo.sail',
          'G', '⌘',
          '4 820', '07', '12',
          '/login',
          '%', '/7', 'NM',
          '01', '02', '03', '04', '05',
          '⌕', 'e',
          '°',
          'BSP', 'TWS', 'TWD', 'TWA', 'HDG', 'VMG', 'DTF', 'Factor',
          'Pos', 'DTU', 'SWH', 'Dir', 'kn', 'm ·', 'nds', 's', '−',
          '📍', 'nm', 'h', 'm',
          '−6h', '+6h', '❚❚', '▶',
          '°,', '★', '° ·',
          'N', 'S', 'E',
          '47°N', '04°W', '45°N', '02°W',
        ],
      }],
    },
  },
];

export default config;
