'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store';
import styles from './RankingPanel.module.css';

// Mock ranking data — will be replaced by real API data
const MOCK_RANKING = [
  { pos: 1, name: '@laperouse', flag: '🇫🇷', dtf: 1524 },
  { pos: 2, name: '@northwind', flag: '🇳🇱', dtf: 1538 },
  { pos: 3, name: '@bora_c', flag: '🇮🇹', dtf: 1552 },
  { pos: 4, name: '@finistere', flag: '🇫🇷', dtf: 1561 },
  { pos: 5, name: '@tradewind', flag: '🇬🇧', dtf: 1574 },
  { pos: 6, name: '@mistral', flag: '🇫🇷', dtf: 1588 },
  { pos: 7, name: '@cap_horn', flag: '🇨🇱', dtf: 1601 },
  { pos: 8, name: '@hebrides', flag: '🇬🇧', dtf: 1612 },
  { pos: 9, name: '@galway_bay', flag: '🇮🇪', dtf: 1624 },
  { pos: 10, name: '@portofino', flag: '🇮🇹', dtf: 1631 },
  { pos: 11, name: '@bay_biscay', flag: '🇪🇸', dtf: 1638 },
  { pos: 12, name: '@vous', flag: '🇫🇷', dtf: 1642, isMe: true },
  { pos: 13, name: '@aurora', flag: '🇳🇴', dtf: 1651 },
  { pos: 14, name: '@south_wind', flag: '🇵🇹', dtf: 1668 },
  { pos: 15, name: '@meridian', flag: '🇫🇷', dtf: 1682 },
];

export default function RankingPanel(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('general');
  const toggleBoat = useGameStore((s) => s.toggleBoat);

  const filtered = search
    ? MOCK_RANKING.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : MOCK_RANKING;

  return (
    <div>
      {/* Search */}
      <div className={styles.searchWrap}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Rechercher un joueur…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter */}
      <div className={styles.filterWrap}>
        <p className={styles.filterLabel}>Filtre</p>
        <select className={styles.filterSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="general">Général · {MOCK_RANKING.length} skippers</option>
          <option value="friends">Mes amis</option>
          <option value="team">Mon équipe</option>
          <option value="city">Ma ville</option>
          <option value="country">Mon pays</option>
        </select>
      </div>

      {/* Ranking list */}
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
