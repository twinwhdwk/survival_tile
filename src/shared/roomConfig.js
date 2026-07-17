export const MAX_PLAYERS = 4; // target group size for room assignment
export const NICKNAME_MAX_LENGTH = 8;
// Hard cap on lobby size (real players + bots combined) -- an operator
// running a fixed-format event wants a predictable stage 1 shape (always
// STAGE_1_GROUP_COUNT groups) rather than however many groups an
// unbounded headcount happens to produce.
export const MAX_LOBBY_PLAYERS = 40;
// Stage 1 always targets exactly this many groups (sizes as even as
// possible via chunkForInitialRound's remainder-spreading), instead of the
// old fixed-group-*size* (MAX_PLAYERS) approach that let group count grow
// unpredictably with turnout.
export const STAGE_1_GROUP_COUNT = 8;
// Stage 2 pools every stage-1 survivor (regardless of which of the 8
// stage-1 rooms they came from) and randomly redistributes them into
// exactly this many groups -- see formStage2Groups() in server.js. Capped
// per-room at STAGE_2_MAX_ROOM_SIZE rather than just dividing evenly,
// since a very lopsided survival rate (e.g. one room's whole team living)
// could otherwise overload a single stage-2 room.
export const STAGE_2_GROUP_COUNT = 4;
export const STAGE_2_MAX_ROOM_SIZE = 10;
