// Netlify Function: the online leaderboard (logic in ../lib/scores.mjs).
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/scores.mjs";
import { nameChecker, anonLogger, accountOf } from "../lib/accounts.mjs";

// an account's name only from its own login (the store is opened per request, where Blobs has its context)
const accounts = () => getStore({ name: "accounts", consistency: "strong" });
const nameCheck = (req, name) => nameChecker(accounts())(req, name);
// logged-out scores that place go on the activity page
const logAnon = (req, ...args) => anonLogger(accounts())(req, ...args);

// replays (2026-11-18): their own store, shared with the arenas; one per top-10 entry that has one
const replays = () => getStore({ name: "replays", consistency: "strong" });

export default (req) => handle(req, getStore({ name: "leaderboard", consistency: "strong" }), { nameCheck, logAnon, accountOf: (req) => accountOf(accounts())(req), replays: replays() });

export const config = { path: ["/api/scores", "/api/scores/boards", "/api/scores/reset", "/api/scores/replay", "/api/scores/replays", "/api/scores/unreplay"] };
