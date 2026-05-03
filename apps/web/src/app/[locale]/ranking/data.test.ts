import { describe, it, expect } from 'vitest';
import { getRanking } from './data';

describe('getRanking — filtre Configuration', () => {
  it('config="all" par défaut : renvoie tous les joueurs avec des stats dans la classe, triés par rankingScore', () => {
    const rows = getRanking('IMOCA60');
    expect(rows.length).toBeGreaterThan(0);
    // tri décroissant par rankingScore
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      expect(prev.rankingScore).toBeGreaterThanOrEqual(cur.rankingScore);
    }
  });

  it('config="series" : ne renvoie que les joueurs avec racesFinishedSeries > 0, triés par rankingScoreSeries', () => {
    const rows = getRanking('IMOCA60', 'series');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.racesFinishedSeries).toBeGreaterThan(0);
    }
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      expect(prev.rankingScoreSeries).toBeGreaterThanOrEqual(cur.rankingScoreSeries);
    }
  });

  it('config="series" sur "ALL" : agrège rankingScoreSeries + racesFinishedSeries toutes classes', () => {
    const rows = getRanking('ALL', 'series');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.racesFinishedSeries).toBeGreaterThan(0);
    }
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      expect(prev.rankingScoreSeries).toBeGreaterThanOrEqual(cur.rankingScoreSeries);
    }
  });

  it('config="series" exclut les joueurs avec racesFinishedSeries === 0', () => {
    const rowsAll = getRanking('IMOCA60', 'all');
    const rowsSeries = getRanking('IMOCA60', 'series');
    // Au moins un joueur (mock) a racesFinishedSeries === 0 sur IMOCA60 → la liste Série est plus courte
    expect(rowsSeries.length).toBeLessThan(rowsAll.length);
  });
});
