// Netlify Function: arenas, 24-hour leaderboards (logic in ../lib/arenas.mjs).
import { getStore } from "@netlify/blobs";
import { handleArenas } from "../lib/arenas.mjs";

export default (req) => handleArenas(req, getStore({ name: "arenas", consistency: "strong" }));

export const config = { path: ["/api/arenas", "/api/arenas/board", "/api/arenas/score", "/api/arenas/delete"] };
