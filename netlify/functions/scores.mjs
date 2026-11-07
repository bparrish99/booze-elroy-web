// Netlify Function: the online leaderboard (logic in ../lib/scores.mjs).
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/scores.mjs";

export default (req) => handle(req, getStore({ name: "leaderboard", consistency: "strong" }));

export const config = { path: ["/api/scores", "/api/scores/reset"] };
