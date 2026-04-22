// Shared boat/route color assignment for the dev simulator.
//
// Convention: the primary boat is always #c9a557 (gold). Every other boat
// picks from OTHER_PALETTE by its position in the *non-primary* subset — so
// the first non-primary is always blue, the second purple, regardless of
// which boat is primary. Using a consistent function everywhere (FleetLayer,
// RouteLayer, ComparisonPanel) keeps the boat marker and its routed line in
// the same color.

export const PRIMARY_COLOR = '#c9a557';
export const OTHER_PALETTE = ['#6ba3c9', '#a57cc9', '#7cc9a5', '#c98c6b'];

export function boatColor(id: string, primaryId: string | null, boatIds: string[]): string {
  if (id === primaryId) return PRIMARY_COLOR;
  const others = boatIds.filter((bid) => bid !== primaryId);
  const idx = others.indexOf(id);
  return OTHER_PALETTE[idx % OTHER_PALETTE.length] ?? OTHER_PALETTE[0]!;
}
