export const GHOST_REVIVE_COOLDOWN_MS = 1500;
// Once only one teammate is still standing (Room.eliminatePlayer's
// aliveCount === 1 check), every ghost's revive-tap cooldown shortens to
// this instead of being waived entirely — a genuinely unlimited-rate tap
// (every client-side click hitting the server with zero throttling) risks
// real server load from a room full of people spam-tapping at once, so
// this stays a real (if much shorter) rate limit rather than none at all.
export const GHOST_REVIVE_LAST_STAND_COOLDOWN_MS = 400;
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

// Attack tiles are separate from the boss's own tile -- stepping on one
// damages the boss and credits the room's shared score exactly like a
// direct boss hit (see Room.js's applyBossDamage()/movePlayerTo()), giving
// the team more than one live target to chase at once. Count scales with
// room size (1 per 4 players, e.g. 2 for an 8-player room) rather than a
// fixed number, so a 10-player room isn't just as sparse as a 4-player one.
export const ATTACK_TILES_PER_PLAYERS = 4;

const BOSS_HP_PER_SURVIVOR = 10;

// Boss toughness matches how many humans actually made it into the room —
// a bigger merged team faces a beefier boss, not a fixed per-stage number.
export function getBossMaxHp(survivorCount) {
  return Math.max(10, survivorCount * BOSS_HP_PER_SURVIVOR);
}
