// Stage 1 and 2 are both SURVIVAL now that the boss mechanic has been
// removed, so they share this same duration. Cut from 120s to 90s -- the two
// team rounds dragged once the boundary had already done most of its work
// (operator: "팀전이 좀 루즈해서 30초씩 줄여줘"). The boundary schedule
// (BOUNDARY_SHRINK_INTERVAL_* below) still finishes closing comfortably
// before this shorter clock runs out; see that budget comment for the math.
export const SURVIVAL_ROUND_DURATION_MS = 90000; // 1.5 min of playable time (excludes the pre-round countdown)
// 개인전 (SOLO) uses the same stage-1 SURVIVAL round shape as team play (see
// Room's roundDurationMs assignment below) but wants its own, longer clock
// -- there's no lineage carrying forward to a next stage to keep brisk for,
// and the operator originally wanted more individual playtime specifically
// here (operator: "개인전은 게임 시간을 30초만 더 늘려줘"). Derived as an
// offset on top of the current SURVIVAL_ROUND_DURATION_MS rather than a
// value hand-picked independently, so a future change to the shared team
// duration doesn't silently leave this one stale relative to it. Bumped
// from +30s to +60s once 개인전's own safe zone started shrinking all the
// way to full closure (see Room.js's this.maxRowInsetTop/Bottom) with the
// boundary now also converging toward a square instead of exhausting
// columns before ever touching rows (see shrinkBoundary()'s own comment) --
// full closure for SOLO needs 13 total shrink steps under that scheme
// (vs. TEAM's 8), finishing at grace(25s) + 118s = 143s from round start.
// The original +30s (120s round, ending at 135s) would leave the boundary
// finishing 8s *after* the round already ended, letting a few players
// survive the closing zone by luck at the buzzer. +60s (150s round, ending
// at 165s) restores a ~22s margin, matching what the original full-closure
// patch counted on.
export const SOLO_ROUND_DURATION_MS = SURVIVAL_ROUND_DURATION_MS + 60000;
// Stage 3's solo final: rapid shrink to a fixed 6x6 window, then that
// window roams the map (see Room.js's FINAL-mode boundary logic) until
// time runs out or one player is left. Shorter than stage 1/2's SURVIVAL
// round on purpose -- the finale is meant to read as a fast, decisive
// showdown rather than dragging on at the same pace as the earlier team
// rounds now that the field is down to one solo group.
export const FINAL_ROUND_DURATION_MS = 90000;
// Once the rapid shrink phase reaches the fixed 6x6 window, it moves one
// cell at a time on this interval instead of shrinking further -- the
// operator's own example was "15초마다 1칸씩" (one cell every 15s).
export const FINAL_ROAM_STEP_MS = 15000;
// Fixed size of the roaming window once the rapid-shrink phase ends. 6, not
// 8 -- the map is only MAP_ROWS=7 tall, so an 8-tall window couldn't move
// vertically at all; 6 leaves exactly 1 row of slack to roam within.
export const FINAL_ROAM_WINDOW_SIZE = 6;
// FINAL only: once the field is down to a single survivor, the finale doesn't
// need to keep running out its full clock -- the winner is already decided.
// But cutting the round the *instant* the second-to-last player dies would
// freeze the winner's score right at that moment, whereas they should end the
// game with the clearly-highest total for actually being last one standing.
// So instead of ending immediately, give the lone survivor this short extra
// window to keep accruing survival score before finishRoom() fires and the
// final standings show. Operator: "최종 1인이 남으면 3초 정도 더 플레이하고 끝".
export const FINAL_LAST_SURVIVOR_EXTRA_MS = 3000;
// The pre-round countdown, split by stage. Stage 1 gets the longer 15s so
// first-timers can actually read the rules/item tip cards (GameScene's
// createCountdownTips()) before play (operator: "1라운드는 설명 읽으라고
// 15초"); every later round reuses the shorter START_COUNTDOWN_LATER_MS,
// since by then everyone has already seen those tips once and the extra
// read time is just dead air before the action (operator: "그 다음 라운드는
// 10초"). Room.js picks between the two by this.stage and exposes the chosen
// value as this.startCountdownMs (also sent to the client in getSnapshot so
// its countdown overlay/timer/score all agree). Nobody (bots included) can
// move until this long into the round, so the client's countdown is a real
// server-enforced freeze, not just cosmetic.
export const START_COUNTDOWN_MS = 15000; // stage 1 (also the client-side fallback when a snapshot omits startCountdownMs)
export const START_COUNTDOWN_LATER_MS = 10000; // stage 2+
// Open-map free-roam window between the countdown ending and the boundary
// starting to close in. The boundary's actual grace period is derived
// per-room as (that round's countdown) + this, so this ~10s of free-roam
// stays constant whether the countdown was 15s or 10s -- see Room.js's
// this.boundaryGraceMs. (Was a flat BOUNDARY_SHRINK_GRACE_MS that had to be
// hand-bumped in lockstep with the countdown; deriving it removes that trap.)
export const BOUNDARY_FREE_ROAM_MS = 10000;
// The boundary insets by one ring (all 4 sides at once) every this-many ms
// after the grace period, once the first BOUNDARY_SHRINK_EARLY_STEPS rings
// (see BOUNDARY_SHRINK_INTERVAL_EARLY_MS) have already fired at the faster
// cadence.
//
// Both intervals are tuned together against one explicit target: the safe
// zone should reach its minimum size (SAFE_ZONE_MIN_ROWS/COLS in Room.js)
// with a comfortable margin still left on the round clock, not just
// "eventually" or "whenever the schedule happens to land."
// At MAP_ROWS=7/MAP_COLS=18 (mapConfig.js), reaching that minimum takes 8
// total steps (the column axis's 7 rings, MAX_COL_INSET_LEFT/RIGHT, plus
// the row axis's one deferred squeeze, MAX_ROW_INSET_TOP/BOTTOM — see
// Room.js's shrinkBoundary()): BOUNDARY_SHRINK_EARLY_STEPS (3) of them at
// BOUNDARY_SHRINK_INTERVAL_EARLY_MS (6s) = 18s, the remaining 5 at this
// interval (10s) = 50s, for 68s total. Grace is now derived per-round
// (this.boundaryGraceMs = countdown + BOUNDARY_FREE_ROAM_MS): stage 1 is
// 15s + 10s = 25s, so the boundary finishes at 25 + 68 = 93s from round
// start, while the round itself ends at countdown(15s) + playable(90s) =
// 105s -- ~12s of margin. Stage 2's shorter 10s countdown makes grace 20s,
// finishing at 88s against a 100s round end -- the same ~12s margin, by
// design (BOUNDARY_FREE_ROAM_MS keeps the post-countdown open-map window
// identical across rounds). A flat 15s schedule (an old tuning) took well
// over 8*15s = 120s to cover the same 8 steps — past even the old, longer
// round on its own, so the deferred row squeeze that makes the safe zone an
// actual minimum-size rectangle would never have fired. These two constants
// are map-size-sensitive: if MAP_ROWS/MAP_COLS (or SAFE_ZONE_MIN_ROWS/COLS)
// change, re-run the step-count math above rather than assuming the same
// total still lands with margin to spare.
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
// FINAL mode's own early-ring cadence during its rapid-shrink-to-window
// phase (see Room.js's boundaryShrinkStepInterval(), mode-aware for exactly
// this) -- deliberately slower than SURVIVAL's BOUNDARY_SHRINK_INTERVAL_EARLY_MS
// so the finale's opening moments don't feel rushed on top of
// FINAL_ROUND_DURATION_MS already being shorter than a SURVIVAL round.
// Reuses BOUNDARY_SHRINK_EARLY_STEPS (3) for how many rings count as
// "early" -- only the per-ring wait during those rings changes. Needs 6
// total rings (both column edges inset once per step) to reach the fixed
// FINAL_ROAM_WINDOW_SIZE window, so at this pace the shrink phase alone
// takes 3*8s + 3*10s = 54s; FINAL is stage 3, so its derived grace is the
// shorter countdown (10s) + BOUNDARY_FREE_ROAM_MS (10s) = 20s, meaning the
// shrink phase finishes at 20 + 54 = 74s from round start, leaving ~26s of
// FINAL_ROUND_DURATION_MS (90s, ending at countdown(10s) + 90s = 100s) for
// the roam phase after -- so there's comfortable roam room here now.
export const FINAL_BOUNDARY_SHRINK_INTERVAL_EARLY_MS = 8000;
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
// SURVIVAL_ROUND_DURATION_MS with nobody left to threaten the winner (see
// Room.finishRoom()'s reason==='last-survivor' branch, which credits them
// up to the round's natural end time instead of the actual early-ending
// moment, so a fast decisive win is never worth less than merely surviving
// to the buzzer in another concurrent SOLO room).
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
// Raised across the board (BASE_BURST 5->8, PER_ALIVE_PLAYER 2->3,
// MIN_INTERVAL_MS 1000->700 -- roughly doubles baseline throughput) per
// operator feedback that real matches felt slower to recover than bot load
// tests did. That gap wasn't a bug: a bot never stops attempting a ghost
// revive tap the instant its own cooldown clears (see Room.reviveTile /
// moveBotsRandomly), while real eliminated players won't tap anywhere near
// that continuously -- so a bot-heavy test's fast recovery pace was coming
// largely from nonstop tap-driven revives on top of this baseline, not from
// this baseline alone. Boosting the baseline itself keeps recovery feeling
// fast regardless of how much (or little) real ghosts are actually tapping.
export const AUTO_REGEN_BASE_BURST = 8; // minimum tiles restored per burst, even down to a single alive player
export const AUTO_REGEN_BURST_PER_ALIVE_PLAYER = 3; // extra tiles restored per burst, per currently-alive (non-eliminated) player in the room
export const AUTO_REGEN_SOLID_RATIO_THRESHOLD = 0.75; // trigger a regen burst once fewer than 3/4 of the safe zone's tiles are still SOLID
export const AUTO_REGEN_MIN_INTERVAL_MS = 700; // rate-limits how often threshold-triggered bursts can fire

// How long a tile stays immune to re-collapsing right after it comes back
// (via autoRegenerateTiles' burst or a ghost's reviveTile click) — without
// this, a tile could be walked on and start collapsing again the instant it
// reappeared, which reads as "regen didn't actually help" even though it
// technically fired. Deliberately shorter than a full footstep-to-gone
// cycle (WARNING_DELAY_MS + COLLAPSE_DELAY_MS = 1500ms in mapConfig.js) so
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

// A ghost coming back mid-round used to be dropped straight onto a live
// tile with zero protection at all -- if that exact tile (or the player
// themselves, via a bomb blast landing on them) got caught by anything
// else already in flight, they could be eliminated again within an
// instant of returning, often before the player even registered they were
// back (operator: "부활하고 2초간 무적한다던가, 타일이 안깨지게 2초간
// 한다던가... 해야 원활하게 진행할수있을듯"). Deliberately shorter than
// GHOST_RESPAWN_STILLNESS_MS above -- that's the anti-camping check that
// eventually collapses their landing tile if they never move off it, and
// needs to fire strictly *after* this window lapses, or it would just
// silently no-op against this same grace and never get a chance to retry.
export const GHOST_REVIVE_GRACE_MS = 2000;

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
// BOMB_BLAST_RADIUS rings of it (see Room.explodeBombTile()). Anyone still
// standing in that radius at the instant of detonation is eliminated
// immediately; every tile in the radius also still collapses through the
// normal triggerTileCollapse() path (its own warning pulse, then GONE),
// so someone who steps into the blast zone *after* it's already gone off
// is still caught by that the same way an ordinary footstep collapse would
// catch them. Count scales with how many players are *currently alive*
// (~1 per BOMB_TILES_PER_PLAYERS, re-derived every checkRoundState tick via
// Room.bombTileTarget/getAliveCount) rather than a fixed number or the
// room's original headcount, so a dwindling handful of survivors isn't
// still facing a hazard count sized for the room's original size -- same
// reasoning as the removed attack-tile mechanic's own scaling.
export const BOMB_TILES_PER_PLAYERS = 6;
export const BOMB_FUSE_MS = 2000;
// 1 ring = the bomb tile itself plus its 6 hex neighbors (see hexGrid.js's
// getTilesWithinHexRadius()), 7 tiles total -- not a square grid's 9-tile
// "3x3", which doesn't correspond to true adjacency on this hex map.
export const BOMB_BLAST_RADIUS = 1;

// Shield tiles: an environmental boon layered on top of the normal tile map
// in any mode (not gated to SURVIVAL/FINAL). Went through two earlier
// designs, both rejected by operator feedback: a fixed count scaled by
// alive-player count read as "way too many shields" once the boundary
// shrank well past the player count shrinking (the same handful of shields
// crammed into a much smaller space), and a follow-up fix that scaled the
// count by the safe zone's own tile count instead still started a round
// with several shields all present at once ("초반에 4개는 너무 많다").
// Now there is only ever *one* shield tile on the map at a time (see
// Room.armShieldTile()/maintainShieldTiles()) -- once it's used (or swept
// away by the shrinking boundary), the next one appears after
// shieldSpawnIntervalMs(), not instantly. That interval itself still scales
// with the safe zone's current size, same reasoning as before: a big zone
// can comfortably wait longer between shields, while a small one should
// hand out replacements quickly. SHIELD_SPAWN_INTERVAL_MIN_MS is a hard
// floor regardless of how small the zone gets ("최소 3초에 1개는
// 나왔으면 함" -- never rarer than one every 3 seconds), and
// SHIELD_SPAWN_INTERVAL_MAX_MS is the slow end, reached once the zone is
// still at (or near) its full ~126-tile size.
export const SHIELD_SPAWN_INTERVAL_MIN_MS = 3000;
export const SHIELD_SPAWN_INTERVAL_MAX_MS = 8000;
// Stepping on the shield tile shields every tile within SHIELD_RADIUS rings
// of it (itself included) from collapsing for SHIELD_GRACE_MS -- see
// Room.armShieldTile(), which reuses the same regenGraceUntil map every
// other "this tile is briefly immune" case already writes into (auto-regen
// burst, ghost respawn, reconnect immunity).
export const SHIELD_GRACE_MS = 5000;
// 1 ring = the shield tile itself plus its 6 hex neighbors, 7 tiles total --
// see BOMB_BLAST_RADIUS's own comment on why this isn't a square "3x3".
export const SHIELD_RADIUS = 1;

// Angel tile: a rescue mechanic, not a hazard whose pressure should scale
// with room size -- unlike bomb/shield tiles there is ever only one on the
// map at a time, placed at most once every ANGEL_TILE_INTERVAL_MS (see
// Room.maintainAngelTile()). Stepping on it immediately revives one random
// ghost from the room's own roster (Room.armAngelTile()). TEAM-only -- this
// room's whole player list already *is* its "team" (see
// chunkForInitialRound()/formStage2Groups() in server.js), and 개인전 (SOLO)
// has no ghost/revival mechanic at all (Room.reviveTile()'s own SOLO guard),
// so an angel tile there would have nothing to do.
export const ANGEL_TILE_INTERVAL_MS = 30000;
// Once fewer than this much time is left in the round, Room.armAngelTile()
// reschedules the next spawn on ANGEL_TILE_FINAL_INTERVAL_MS instead of the
// normal ANGEL_TILE_INTERVAL_MS -- a deliberate late-round rush of revival
// chances rather than the same steady 30s cadence all the way to the buzzer.
// Only takes effect at the moment a tile is actually picked up (or at the
// very first scheduling, in the constructor) -- an already-placed, unpicked
// tile just sits there regardless (there's ever only one on the map at a
// time), so this doesn't spawn a second one on top of it.
export const ANGEL_TILE_FINAL_STRETCH_MS = 30000;
export const ANGEL_TILE_FINAL_INTERVAL_MS = 10000;

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
