'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/lib/store';
import styles from './RankingPanel.module.css';

// Mock ranking data — will be replaced by real API data
const MOCK_RANKING = [
  { pos:  1, name: '@laperouse',  flag: '🇫🇷', dtf: 1524, isSeriesConfig: false },
  { pos:  2, name: '@northwind',  flag: '🇳🇱', dtf: 1538, isSeriesConfig: true  },
  { pos:  3, name: '@bora_c',     flag: '🇮🇹', dtf: 1552, isSeriesConfig: false },
  { pos:  4, name: '@finistere',  flag: '🇫🇷', dtf: 1561, isSeriesConfig: true  },
  { pos:  5, name: '@tradewind',  flag: '🇬🇧', dtf: 1574, isSeriesConfig: false },
  { pos:  6, name: '@mistral',    flag: '🇫🇷', dtf: 1588, isSeriesConfig: true  },
  { pos:  7, name: '@cap_horn',   flag: '🇨🇱', dtf: 1601, isSeriesConfig: false },
  { pos:  8, name: '@hebrides',   flag: '🇬🇧', dtf: 1612, isSeriesConfig: true  },
  { pos:  9, name: '@galway_bay', flag: '🇮🇪', dtf: 1624, isSeriesConfig: true  },
  { pos: 10, name: '@portofino',  flag: '🇮🇹', dtf: 1631, isSeriesConfig: false },
  { pos: 11, name: '@bay_biscay', flag: '🇪🇸', dtf: 1638, isSeriesConfig: true  },
  { pos: 12, name: '@vous',       flag: '🇫🇷', dtf: 1642, isMe: true, isSeriesConfig: true },
  { pos: 13, name: '@aurora',     flag: '🇳🇴', dtf: 1651, isSeriesConfig: false },
  { pos: 14, name: '@south_wind', flag: '🇵🇹', dtf: 1668, isSeriesConfig: true  },
  { pos: 15, name: '@meridian',   flag: '🇫🇷', dtf: 1682, isSeriesConfig: false },
];

export default function RankingPanel(): React.ReactElement {
  const t = useTranslations('play.ranking');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('general');
  const toggleBoat = useGameStore((s) => s.toggleBoat);

  const filtered = (() => {
    let base = MOCK_RANKING;
    if (filter === 'series') {
      base = base.filter((r) => r.isSeriesConfig);
    }
    if (search) {
      base = base.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    }
    return base;
  })();

  return (
    <div>
      <div className={styles.searchWrap}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.filterWrap}>
        <p className={styles.filterLabel}>{t('filterLabel')}</p>
        <select className={styles.filterSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="general">{t('filters.general', { n: MOCK_RANKING.length })}</option>
          <option value="friends">{t('filters.friends')}</option>
          <option value="team">{t('filters.team')}</option>
          <option value="city">{t('filters.city')}</option>
          <option value="country">{t('filters.country')}</option>
          <option disabled>{t('filters.separator')}</option>
          <option value="series">{t('filters.series', { n: MOCK_RANKING.filter((r) => r.isSeriesConfig).length })}</option>
        </select>
      </div>

      <div className={styles.list}>
        {filtered.map((r) => (
          <div
            key={r.pos}
            className={`${styles.row} ${'isMe' in r && r.isMe ? styles.rowMe : ''} ${r.pos <= 3 ? styles.podium : ''}`}
            onClick={() => { if (!('isMe' in r && r.isMe)) toggleBoat(`boat-${r.pos}`); }}
          >
            <span className={styles.pos}>{String(r.pos).padStart(2, '0')}</span>
            <div className={styles.name}>
              <span className={styles.flag}>{r.flag}</span>
              {r.name}
            </div>
            <span className={styles.dtf}>{r.dtf.toLocaleString('fr-FR')} NM</span>
          </div>
        ))}
      </div>
    </div>
  );
}
