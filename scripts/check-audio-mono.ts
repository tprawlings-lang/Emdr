// CI step: produced audio is mono or identical stereo (Handoff 10 §8.3).
//
//   npx tsx scripts/check-audio-mono.ts [dir]      (default: assets/audio)
//
// The rule lives in src/lib/governance/audio-mono.ts, where the tests reach it.

import { AUDIO_ASSET_DIR, checkAudioDir } from "../src/lib/governance/audio-mono";

const dir = process.argv[2] ?? AUDIO_ASSET_DIR;
const results = checkAudioDir(dir);
const bad = results.filter((r) => !r.ok);
for (const r of bad) console.error(`FAIL ${r.file}: ${r.reason}`);
if (bad.length > 0) process.exit(1);
console.log(`audio: ${results.length} file(s) under ${dir}, all mono or identical stereo`);
