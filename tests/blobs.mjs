// Test helper: a real local Netlify Blobs server (from @netlify/blobs) in a temp directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { getStore } from "@netlify/blobs";

export async function startBlobs() {
  const directory = mkdtempSync(join(tmpdir(), "booze-blobs-"));
  const token = "test-token";
  const server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  const store = getStore({ name: "leaderboard", siteID: "test-site", token, edgeURL: url, uncachedEdgeURL: url, consistency: "strong" });
  return { store, async stop() { await server.stop(); rmSync(directory, { recursive: true, force: true }); } };
}
