// Netlify Function: arenas, 24-hour leaderboards (logic in ../lib/arenas.mjs).
import { getStore } from "@netlify/blobs";
import { handleArenas } from "../lib/arenas.mjs";
import { nameChecker, anonLogger } from "../lib/accounts.mjs";

// an account's name only from its own login (the store is opened per request, where Blobs has its context)
const accounts = () => getStore({ name: "accounts", consistency: "strong" });
const nameCheck = (req, name) => nameChecker(accounts())(req, name);
// logged-out scores that place go on the activity page
const logAnon = (req, ...args) => anonLogger(accounts())(req, ...args);

export default (req) => handleArenas(req, getStore({ name: "arenas", consistency: "strong" }), { nameCheck, logAnon });

export const config = { path: ["/api/arenas", "/api/arenas/board", "/api/arenas/score", "/api/arenas/delete"] };
