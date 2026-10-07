// Aura milestones: every tunable Aura number lives here. Each milestone is earned once per
// wallet, at a level. Levels come from the on-chain XP via progress/curve.ts (not stored).

export type Milestone = {
  id: string; // stable key, also the unique key in the DB
  level: number; // minimum level that earns it
  name: string;
  color: string; // used by the generated placeholder image
};

// Same level floors as the ranks D..S.
export const MILESTONES: readonly Milestone[] = [
  { id: "ember", level: 5, name: "Ember Aura", color: "#d98a3d" },
  { id: "flame", level: 10, name: "Flame Aura", color: "#e5533d" },
  { id: "azure", level: 20, name: "Azure Aura", color: "#3d8be5" },
  { id: "violet", level: 35, name: "Violet Aura", color: "#9b5de5" },
  { id: "radiant", level: 55, name: "Radiant Aura", color: "#f5c542" },
];

export const AURA_SYMBOL = "AURA";
/** Royalties on resale: none for a gifted milestone token. */
export const AURA_SELLER_FEE_BPS = 0;

export function milestoneById(id: string): Milestone | undefined {
  return MILESTONES.find((m) => m.id === id);
}

/** Every milestone earned at `level`, lowest first. */
export function earnedMilestones(level: number): Milestone[] {
  return MILESTONES.filter((m) => m.level <= level);
}

/** Placeholder artwork so the NFT has an image with zero hosting. Replace with real art later. */
export function milestoneSvg(m: Milestone): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0b0b0c"/>
<circle cx="256" cy="256" r="190" fill="none" stroke="${m.color}" stroke-width="6" opacity="0.35"/>
<circle cx="256" cy="256" r="130" fill="${m.color}" opacity="0.18"/>
<circle cx="256" cy="256" r="70" fill="${m.color}"/>
<text x="256" y="450" font-family="monospace" font-size="28" fill="#ffffff" text-anchor="middle">${m.name} · LV ${m.level}</text>
</svg>`;
}
