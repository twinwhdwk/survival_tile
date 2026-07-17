// Target group size for stage-1 room assignment (chunkForInitialRound() in
// server.js caps every group at this, adding a whole extra group rather than
// growing past it). Stage 1 is TEAM mode -- a lone 1-person "team" doesn't
// make sense, so this is picked so ceil(total/MAX_PLAYERS) never produces a
// singleton group for any realistic headcount (5 people -> 1 group of 5, not
// split at all; 6 -> 2 groups of 3; 10 -> 2 groups of 5; 11 -> 3 groups of
// 4/4/3), not just "the biggest a room should get."
export const MAX_PLAYERS = 5;
export const NICKNAME_MAX_LENGTH = 8;
// Hard cap on lobby size (real players + bots combined) -- keeps a real
// event's stage-1 group count (MAX_PLAYERS-capped, see chunkForInitialRound
// in server.js) and stage-2 pooling (STAGE_2_GROUP_COUNT/
// STAGE_2_MAX_ROOM_SIZE below) within the range they were actually tuned
// against, rather than however many groups an unbounded headcount could
// otherwise produce.
export const MAX_LOBBY_PLAYERS = 40;
// Stage 2 pools every stage-1 survivor (regardless of how many stage-1
// rooms they came from) and randomly redistributes them into exactly this
// many groups -- see formStage2Groups() in server.js. Capped per-room at
// STAGE_2_MAX_ROOM_SIZE rather than just dividing evenly, since a very
// lopsided survival rate (e.g. one room's whole team living) could
// otherwise overload a single stage-2 room.
export const STAGE_2_GROUP_COUNT = 4;
export const STAGE_2_MAX_ROOM_SIZE = 10;
