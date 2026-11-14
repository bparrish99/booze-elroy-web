// Netlify Function: the online leaderboard (logic in ../lib/scores.mjs).
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/scores.mjs";
import { nameChecker, anonLogger } from "../lib/accounts.mjs";

// an account's name only from its own login (the store is opened per request, where Blobs has its context)
const accounts = () => getStore({ name: "accounts", consistency: "strong" });
const nameCheck = (req, name) => nameChecker(accounts())(req, name);
// logged-out scores that place go on the activity page
const logAnon = (req, ...args) => anonLogger(accounts())(req, ...args);

export default (req) => handle(req, getStore({ name: "leaderboard", consistency: "strong" }), { nameCheck, logAnon });

export const config = { path: ["/api/scores", "/api/scores/boards", "/api/scores/reset"] };
