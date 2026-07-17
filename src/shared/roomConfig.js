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
