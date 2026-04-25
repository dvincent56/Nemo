export interface RankInput {
  participantId: string;
  dtfNm: number;
}

export function computeRanks(inputs: readonly RankInput[]): Map<string, number> {
  const sorted = [...inputs].sort((a, b) => {
    if (a.dtfNm !== b.dtfNm) return a.dtfNm - b.dtfNm;
    return a.participantId < b.participantId ? -1 : 1;
  });
  const ranks = new Map<string, number>();
  sorted.forEach((entry, idx) => {
    ranks.set(entry.participantId, idx + 1);
  });
  return ranks;
}
