// Netlify Function: player accounts, username + password (logic in ../lib/accounts.mjs).
import { getStore } from "@netlify/blobs";
import { handleAccounts } from "../lib/accounts.mjs";

// (the leaderboard store too: achievements earned before they existed are read off the boards, see retroAward; and the
// arenas store: chicken dinner for an arena this account won, whatever name it used, see arenaWins)
export default (req) => handleAccounts(req, getStore({ name: "accounts", consistency: "strong" }), { scoresStore: getStore({ name: "leaderboard", consistency: "strong" }), arenasStore: getStore({ name: "arenas", consistency: "strong" }) });

export const config = { path: ["/api/account/signup", "/api/account/login", "/api/account/me", "/api/account/logout", "/api/account/achievements", "/api/account/placed", "/api/account/played", "/api/account/anonplayed", "/api/account/activity", "/api/account/favorites", "/api/account/unfavorite", "/api/account/picks"] };
