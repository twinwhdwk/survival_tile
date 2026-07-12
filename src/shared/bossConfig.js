export const GHOST_REVIVE_COOLDOWN_MS = 1500;
export const BOSS_METEOR_DAMAGE = 1;

export const BOSS_HIT_SCORE = 10;
export const BOSS_KILL_SCORE = 50;

// Admin-only "balance lever" for a room the admin has selected on the
// dashboard (see DashboardScene's C/S keys and Room.js's armCriticalHit/
// triggerBossShatterSkill) — deliberately produces no visible cue that
// wasn't already part of normal play (a bigger-than-usual damage number, a
// handful of tiles collapsing), since the admin's screen may be shown on a
// TV and the whole point is other players can't tell it happened.
export const CRITICAL_DAMAGE_MULTIPLIER = 8; // "C": next boss hit in the targeted room deals this many times normal damage
export const ADMIN_CRITICAL_COOLDOWN_MS = 5000; // rate-limits how often "C" can be re-armed per room
export const ADMIN_SHATTER_TILE_COUNT = 5; // "S": this many random standing tiles crack and collapse at once
export const ADMIN_SHATTER_COOLDOWN_MS = 8000; // rate-limits how often "S" can fire per room

const BOSS_HP_PER_SURVIVOR = 10;

// Boss toughness matches how many humans actually made it into the room —
// a bigger merged team faces a beefier boss, not a fixed per-stage number.
export function getBossMaxHp(survivorCount) {
  return Math.max(10, survivorCount * BOSS_HP_PER_SURVIVOR);
}
