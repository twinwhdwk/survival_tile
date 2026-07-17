// Stage 1 (SURVIVAL) and stage 2+ (BOSS) intentionally run different
// lengths: a shorter first round keeps the initial free-for-all snappy,
// while boss fights get the longer window since score there is built up
// gradually through repeated hits rather than just showing up alive.
export const SURVIVAL_ROUND_DURATION_MS = 120000; // 2 minutes for stage 1
export const BOSS_ROUND_DURATION_MS = 180000; // 3 minutes per boss room
// Stage 3's solo final: rapid shrink to a fixed 6x6 window, then that
// window roams the map (see Room.js's FINAL-mode boundary logic) until
// time runs out or one player is left. Same length as stage 1's SURVIVAL
// round -- long enough for several roam steps (FINAL_ROAM_STEP_MS below)
// after the shrink phase, without dragging the finale out past what the
// rest of the bracket's pacing already establishes.
export const FINAL_ROUND_DURATION_MS = 120000;
// Once the rapid shrink phase reaches the fixed 6x6 window, it moves one
// cell at a time on this interval instead of shrinking further -- the
// operator's own example was "15초마다 1칸씩" (one cell every 15s).
export const FINAL_ROAM_STEP_MS = 15000;
// Fixed size of the roaming window once the rapid-shrink phase ends. 6, not
// 8 -- the map is only MAP_ROWS=7 tall, so an 8-tall window couldn't move
// vertically at all; 6 leaves exactly 1 row of slack to roam within.
export const FINAL_ROAM_WINDOW_SIZE = 6;
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
// 개인전 has no ghost/revival mechanic (see Room.reviveTile's SOLO guard),
// so once only one player is left alive nothing can change that outcome —
// every other participant is already permanently eliminated. Room.js ends
// the round immediately in that moment rather than idling out the rest of
// SURVIVAL_ROUND_DURATION_MS with nobody left to threaten the winner. Doing
// so does cut their own addSurvivalScore() time short, though, which would
// otherwise unfairly under-score a decisive early win next to another
// concurrent SOLO room's winner who happened to survive the round's full
// duration purely by running out the clock — this flat bonus tops the last
// survivor up so being the one who actually won is never worth less than
// merely surviving to the buzzer.
export const SOLO_LAST_SURVIVOR_BONUS_SCORE = 20;
// Once every real player in a 개인전 room is eliminated, nothing further a
// remaining bot does is worth simulating in real time for an empty room —
// the human never even looks at bot scores. Room.randomizeBotResults()
// instead shuffles the bots into a random rank order and walks it giving
// out strictly decreasing scores (this is the top score; each subsequent
// bot's score drops by a random amount in [SOLO_BOT_SCORE_GAP_MIN,
// SOLO_BOT_SCORE_GAP_MAX]) so the results screen shows a clean ranking —
// purely cosmetic filler, not a real measure of anything, but a *tied*
// score read as broken in a way a merely-random-but-unique one doesn't.
export const SOLO_BOT_PLACEHOLDER_SCORE_MAX = 80;
export const SOLO_BOT_SCORE_GAP_MIN = 3;
export const SOLO_BOT_SCORE_GAP_MAX = 12;
// A 36-person (9-room) load test showed every room going to a total wipeout
// within seconds: worst case (at the original BOT_MOVE_INTERVAL_MS=300 in
// server.js, since raised to 600 for more human-like pacing) was
// MAX_PLAYERS bots each stepping onto a new tile every 300ms = up to ~13
// tiles/sec of consumption in one room. That worst case scales directly
// with how many players are still alive in the room — a nearly-full room
// burns through tiles far faster than one down to its last survivor — so
// a single flat burst size can't be right for both: tuned to keep up with
// a full room, it does needlessly large bursts once only one or two
// people are left; tuned for a lone survivor, it can't keep up with a
// full room. AUTO_REGEN_BASE_BURST + AUTO_REGEN_BURST_PER_ALIVE_PLAYER *
// aliveCount (see Room.autoRegenerateTiles) scales burst size with the
// room's actual current alive count instead: at the current 600ms bot
// pace, one alive player consumes up to ~1.7 tiles/sec worst case, so
// ~2 tiles/sec of burst throughput per alive player (at this 1s cadence,
// that's PER_ALIVE_PLAYER=2) clears that with margin per player, plus a
// small flat base so a lone survivor's room still gets a meaningful
// burst rather than rounding down to almost nothing.
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
export const AUTO_REGEN_BASE_BURST = 5; // minimum tiles restored per burst, even down to a single alive player
export const AUTO_REGEN_BURST_PER_ALIVE_PLAYER = 2; // extra tiles restored per burst, per currently-alive (non-eliminated) player in the room
export const AUTO_REGEN_SOLID_RATIO_THRESHOLD = 0.75; // trigger a regen burst once fewer than 3/4 of the safe zone's tiles are still SOLID
export const AUTO_REGEN_MIN_INTERVAL_MS = 1000; // rate-limits how often threshold-triggered bursts can fire; matches the 1s server tick, so it can fire every tick while below threshold

// How long a tile stays immune to re-collapsing right after it comes back
// (via autoRegenerateTiles' burst or a ghost's reviveTile click) — without
// this, a tile could be walked on and start collapsing again the instant it
// reappeared, which reads as "regen didn't actually help" even though it
// technically fired. Deliberately shorter than a full footstep-to-gone
// cycle (WARNING_DELAY_MS + COLLAPSE_DELAY_MS = 1200ms in mapConfig.js) so
// it reads as "freshly solid ground," not permanent invulnerability.
export const REGEN_GRACE_MS = 2000;

// Ghosts (eliminated players) tapping collapsed tiles fill one *shared*,
// room-wide revival gauge — GAUGE_PER_TAP per successful tap from any
// ghost (i.e. one that actually flips a GONE tile back to SOLID;
// rate-limited per ghost by Room.reviveTile's GHOST_REVIVE_COOLDOWN_MS /
// GHOST_REVIVE_LAST_STAND_COOLDOWN_MS gates in bossConfig.js). Filling
// the gauge to GAUGE_MAX respawns ONE random ghost back into the round
// at a random currently-standing tile (Room.respawnRandomGhost), then
// resets to 0 and starts filling again — a shared team effort rather
// than each ghost grinding a private meter.
//
// The shared-gauge design (replacing separate per-player gauges) already
// makes this much more reachable once several ghosts exist to tap
// together, but a SURVIVAL round's very first elimination still has
// exactly one ghost carrying it alone — at the original value that's 10
// taps at a 1500ms cooldown, ~17s minimum, against a round where most
// eliminations land in the final third. Raised from 10 so a lone early
// ghost has a real shot before the round ends, without dropping so low
// that a single ghost can trivially solo-fill it.
export const GHOST_REVIVE_GAUGE_PER_TAP = 14;
export const GHOST_REVIVE_GAUGE_MAX = 100;

// A revived player who stays put has effectively taken themselves out of
// the round again without the tile pressure everyone else is under —
// their respawn tile collapses out from under them if they haven't moved
// off it within this long, same as if they'd just walked onto (and then
// lingered on) any other tile a normal footstep would already be putting
// on the collapse clock. Long enough to get their bearings right after
// coming back, short enough that idling isn't a safe way to wait out a
// round.
export const GHOST_RESPAWN_STILLNESS_MS = 3000;
