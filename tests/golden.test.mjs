// Gameplay must not change by accident: replays the core with a seeded RNG and a bot player across many configurations and
// compares per-frame state fingerprints with tests/golden.json (recorded from a known-good core). If gameplay is meant to
// change, re-record with `node tools/golden.mjs --record` and say why in the commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GOLDEN, SCENARIOS, replay, loadCore } from "../tools/golden.mjs";

const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);
for (const [name, cfg] of Object.entries(SCENARIOS)) {
  test("golden replay: " + name, () => {
    const r = replay(create, cfg), want = golden[name];
    assert.ok(want, "no recording for " + name);
    const i = r.checkpoints.findIndex((c, k) => c !== want.checkpoints[k]);
    assert.equal(r.final, want.final, "gameplay diverged" + (i >= 0 ? " by frame " + (i + 1) * 600 : ""));
  });
}
