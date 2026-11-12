// Netlify Function: the online leaderboard (logic in ../lib/scores.mjs).
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/scores.mjs";
import { nameChecker } from "../lib/accounts.mjs";

// an account's name only from its own login (the store is opened per request, where Blobs has its context)
const nameCheck = (req, name) => nameChecker(getStore({ name: "accounts", consistency: "strong" }))(req, name);

export default (req) => handle(req, getStore({ name: "leaderboard", consistency: "strong" }), { nameCheck });

export const config = { path: ["/api/scores", "/api/scores/boards", "/api/scores/reset"] };
