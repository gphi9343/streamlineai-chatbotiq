// backend/scripts/load-kb-demo-kawana.mjs
//
// Kawana Flooring DEMO KB loader. Reads backend/db/kb-seed-demo-kawana.md,
// parses it, and replaces all kb_entries rows for deployment_slug 'demo-kawana'
// with the parsed set. Idempotent (delete-then-insert) — the seed file is the
// source of truth.
//
// DRAFT-FOR-APPROVAL: every entry is sourced/inferred from Kawana's site + the
// content draft and stays [CONFIRM] until Kawana signs off. Draft status is
// recorded in the `source` column (SOURCE_TAG below), not embedded in bot-facing
// bodies.
//
// Usage (Node 24+, native --env-file):
//   node --env-file=backend/.env backend/scripts/load-kb-demo-kawana.mjs
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { parseSeedFile, replaceKbForDeployment } from '../lib/kb.js';
import { demoKawanaConfig } from '../config/demo-kawana.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEED_PATH = resolve(__dirname, '..', 'db', 'kb-seed-demo-kawana.md');
const DEPLOYMENT_SLUG = demoKawanaConfig.client_slug;
const SOURCE_TAG = 'demo-kawana-draft-CONFIRM';

async function main() {
  console.log(`[load-kb-demo-kawana] reading: ${SEED_PATH}`);
  const markdown = await readFile(SEED_PATH, 'utf8');

  const parsed = parseSeedFile(markdown);
  if (!parsed.ok) {
    console.error('[load-kb-demo-kawana] parse failed:', parsed.error);
    process.exit(1);
  }

  console.log(`[load-kb-demo-kawana] parsed ${parsed.entries.length} entries`);
  parsed.entries.forEach((e, i) => {
    console.log(
      `  [${i + 1}] ${e.content_type.padEnd(9)} ${e.question.slice(0, 60)}` +
      (e.attribution ? ` (attr: ${e.attribution})` : '')
    );
  });

  console.log(`[load-kb-demo-kawana] replacing kb_entries for deployment: ${DEPLOYMENT_SLUG}`);
  const result = await replaceKbForDeployment(
    DEPLOYMENT_SLUG,
    parsed.entries,
    SOURCE_TAG
  );

  if (!result.ok) {
    console.error('[load-kb-demo-kawana] replace failed:', result.error);
    process.exit(1);
  }

  console.log(`[load-kb-demo-kawana] inserted ${result.inserted} entries successfully`);
  console.log('[load-kb-demo-kawana] done.');
}

main().catch(err => {
  console.error('[load-kb-demo-kawana] fatal:', err);
  process.exit(1);
});
