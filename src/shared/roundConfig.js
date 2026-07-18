// Stage 1 and 2 are both SURVIVAL now that the boss mechanic has been
// removed, so they share this same duration.
export const SURVIVAL_ROUND_DURATION_MS = 120000; // 2 minutes
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
// The boundary insets by one ring (all 4 sides at once) every this-many ms
// after the grace period, once the first BOUNDARY_SHRINK_EARLY_STEPS rings
// (see BOUNDARY_SHRINK_INTERVAL_EARLY_MS) have already fired at the faster
// cadence.
//
// Both intervals are tuned together against one explicit target: the safe
// zone should reach its minimum size (SAFE_ZONE_MIN_ROWS/COLS in Room.js)
// with 30s still left on SURVIVAL_ROUND_DURATION_MS (120s), i.e. by 90s
// elapsed, not just "eventually" or "whenever the schedule happens to land."
// At MAP_ROWS=7/MAP_COLS=18 (mapConfig.js), reaching that minimum takes 8
// total steps (the column axis's 7 rings, MAX_COL_INSET_LEFT/RIGHT, plus
// the row axis's one deferred squeeze, MAX_ROW_INSET_TOP/BOTTOM — see
// Room.js's shrinkBoundary()): BOUNDARY_SHRINK_EARLY_STEPS (3) of them at
// BOUNDARY_SHRINK_INTERVAL_EARLY_MS (6s) = 18s, the remaining 5 at this
// interval (10s) = 50s, for 68s total — finishing at grace (20s) + 68s =
// 88s elapsed, i.e. with 32s left, comfortably inside the 30s target. A
// flat 15s schedule (the previous tuning) took well over 8*15s = 120s to
// cover the same 8 steps — past the round's own duration on its own, so the
// deferred row squeeze that makes the safe zone an actual minimum-size
// rectangle would never have fired within a real round at all. These two
// constants are map-size-sensitive: if MAP_ROWS/MAP_COLS (or
// SAFE_ZONE_MIN_ROWS/COLS) change, re-run the step-count math above rather
// than assuming the same total still lands inside the 30s target.
export const BOUNDARY_SHRINK_INTERVAL_MS = 10000;
// The first few rings close on this shorter cadence instead of the normal
// BOUNDARY_SHRINK_INTERVAL_MS (see Room.js's boundaryShrinkStepInterval()) —
// right as the grace period ends the map is at its widest, so a long wait
// for a ring that barely changes anything at that size read as the whole
// mechanic being slow to start. Ramping down to the normal cadence after
// BOUNDARY_SHRINK_EARLY_STEPS rings keeps the later, more consequential
// rings (each one a bigger, more felt squeeze at these already-tighter
// dimensions) at a more readable pace instead of rushing those too. See
// BOUNDARY_SHRINK_INTERVAL_MS's own comment for the full timing budget this
// and BOUNDARY_SHRINK_EARLY_STEPS were solved against together.
export const BOUNDARY_SHRINK_INTERVAL_EARLY_MS = 6000;
export const BOUNDARY_SHRINK_EARLY_STEPS = 3;
export const BOUNDARY_WAVE_MS = 3000; // a burning ring crumbles across this window, not all at once
// SURVIVAL rounds have no other scoring mechanic, so a teammate's score
// contribution is how long they personally stayed alive (in whole
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
// GHOST_REVIVE_LAST_STAND_COOLDOWN_MS gates below). Filling
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

// A player's own spawn tile is the one tile triggerTileCollapse() never
// reaches through the normal path — every other tile gets triggered the
// instant a player's movement lands them on it (see Room.movePlayerTo()),
// but the very first spawn placement sets position directly, so a player
// who never moves at all from round start would otherwise sit on
// permanently safe ground for the whole round. Mirrors
// GHOST_RESPAWN_STILLNESS_MS's own one-shot check, just anchored to
// START_COUNTDOWN_MS lifting (movement is impossible before that regardless
// of player action) instead of an individual respawn.
export const ROUND_START_STILLNESS_MS = 2000;

// Base cooldown between a ghost's revive taps (see Room.reviveTile()).
// Formerly lived in the now-removed bossConfig.js -- unrelated to the boss
// mechanic itself, just co-located there historically.
export const GHOST_REVIVE_COOLDOWN_MS = 1500;
// Once only one teammate is still standing (Room.eliminatePlayer's
// aliveCount === 1 check), every ghost's revive-tap cooldown shortens to
// this instead of being waived entirely — a genuinely unlimited-rate tap
// (every client-side click hitting the server with zero throttling) risks
// real server load from a room full of people spam-tapping at once, so
// this stays a real (if much shorter) rate limit rather than none at all.
export const GHOST_REVIVE_LAST_STAND_COOLDOWN_MS = 400;

// Bomb tiles: an environmental hazard layered on top of the normal tile
// map (any mode, not gated to SURVIVAL/FINAL specifically) -- stepping on
// one arms it, and after BOMB_FUSE_MS it blasts every tile within
// BOMB_BLAST_RADIUS rings of it (see Room.explodeBombTile()) through the
// same triggerTileCollapse() path an ordinary footstep already uses, so a
// tile caught in the blast still gets its normal warning pulse before
// actually collapsing, and anyone still standing there when it does is
// eliminated exactly like any other collapse. Count scales with room size
// (~1 per BOMB_TILES_PER_PLAYERS players) rather than a fixed number, the
// same reasoning as the removed attack-tile mechanic's own scaling.
export const BOMB_TILES_PER_PLAYERS = 6;
export const BOMB_FUSE_MS = 2000;
// 1 ring = a 3x3 area centered on the bomb tile.
export const BOMB_BLAST_RADIUS = 1;

// When a real player's socket drops mid-round, they aren't eliminated
// immediately — their avatar is handed to the bot AI as a "proxy" for this
// long, giving them a window to reconnect (a backgrounded phone, a brief
// wifi drop at a busy venue) and reclaim it exactly where it is, at its
// current score, instead of losing the round to a momentary blip. If the
// window elapses with no reconnect, the proxy is dropped and the normal
// disconnect elimination proceeds. Deliberately long enough to cover a real
// reconnect (page reload + re-join round-trip) but not so long that a genuinely
// gone player leaves a bot-piloted seat lingering for the rest of a round.
export const RECONNECT_GRACE_MS = 20000;

// The moment a reconnecting player reclaims their avatar, the bot proxy
// hands control back — but there's a real beat before the human's eyes and
// fingers re-engage, during which the tile the bot last parked them on may
// already be counting down to collapse. Give just that one tile (the
// avatar's current hex, not an area) a brief immunity so a returning player
// doesn't lose the round in the first second back before they can even
// react. Scoped tight and short on purpose: it's a re-entry cushion, not a
// safe-haven.
export const RECONNECT_RESPAWN_GRACE_MS = 3000;
