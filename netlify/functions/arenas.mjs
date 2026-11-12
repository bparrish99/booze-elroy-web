// Netlify Function: arenas, 24-hour leaderboards (logic in ../lib/arenas.mjs).
import { getStore } from "@netlify/blobs";
import { handleArenas } from "../lib/arenas.mjs";
import { nameChecker } from "../lib/accounts.mjs";

// an account's name only from its own login (the store is opened per request, where Blobs has its context)
const nameCheck = (req, name) => nameChecker(getStore({ name: "accounts", consistency: "strong" }))(req, name);

export default (req) => handleArenas(req, getStore({ name: "arenas", consistency: "strong" }), { nameCheck });

export const config = { path: ["/api/arenas", "/api/arenas/board", "/api/arenas/score", "/api/arenas/delete"] };
