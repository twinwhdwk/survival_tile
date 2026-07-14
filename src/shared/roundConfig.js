// Stage 1 (SURVIVAL) and stage 2+ (BOSS) intentionally run different
// lengths: a shorter first round keeps the initial free-for-all snappy,
// while boss fights get the longer window since score there is built up
// gradually through repeated hits rather than just showing up alive.
export const SURVIVAL_ROUND_DURATION_MS = 120000; // 2 minutes for stage 1
export const BOSS_ROUND_DURATION_MS = 180000; // 3 minutes per boss room
export const START_COUNTDOWN_MS = 10000; // nobody (bots included) can move until this long into the round, so the client's pre-game countdown is a real freeze, not just cosmetic
export const BOUNDARY_SHRINK_GRACE_MS = 20000; // the boundary doesn't start closing in until this long into the round
export const BOUNDARY_SHRINK_INTERVAL_MS = 15000; // the boundary insets by one ring (all 4 sides at once) every 15s after the grace period
export const BOUNDARY_WAVE_MS = 3000; // a burning ring crumbles across this window, not all at once
// SURVIVAL rounds don't have a boss to hit for points, so a teammate's score
// contribution is instead how long they personally stayed alive (in whole
// seconds), summed across the whole lineage — a team that all goes down
// early scores worse than one where everyone hangs on longer, even if
// nobody technically "survives" to the safe zone at the buzzer.
export const SURVIVAL_SCORE_PER_SECOND = 1;
// A 36-person (9-room) load test showed every room going to a total wipeout
// within seconds: worst case (at the original BOT_MOVE_INTERVAL_MS=300 in
// server.js, since raised to 600 for more human-like pacing) was
// MAX_PLAYERS bots each stepping onto a new tile every 300ms = up to ~13
// tiles/sec of consumption in one room. The burst size and interval below
// are tuned so sustained regen throughput (TILES_PER_BURST /
// (MIN_INTERVAL_MS/1000)) clears that worst case with margin — 15
// tiles/sec at a 1s cadence, i.e. still comfortably ahead even at the
// original faster/harsher bot pace.
//
// The threshold itself was originally 0.5 (only step in once a *majority*
// of the safe zone was already gone), which in practice reads as "nothing
// happens until the room is already in serious trouble" — a live session
// still went from "about a third of the zone gone" to a full wipeout
// before ever crossing 0.5, since the zone was also actively shrinking
// (each boundary step re-evaluates against a smaller zoneTiles.length, so
// tiles already gone from earlier in the round make up a bigger share of
// the *new*, smaller zone even with no further player action). Raised to
// 0.75 so regen kicks in once roughly a quarter of the zone is gone,
// well before the zone actually feels dangerous, instead of only as a
// last-ditch rescue.
export const AUTO_REGEN_TILES_PER_BURST = 15; // SURVIVAL round only: collapsed tiles restored per burst, scoped to the current safe zone only
export const AUTO_REGEN_SOLID_RATIO_THRESHOLD = 0.75; // trigger a regen burst once fewer than 3/4 of the safe zone's tiles are still SOLID
export const AUTO_REGEN_MIN_INTERVAL_MS = 1000; // rate-limits how often threshold-triggered bursts can fire; matches the 1s server tick, so it can fire every tick while below threshold
