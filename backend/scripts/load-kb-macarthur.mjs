// backend/scripts/load-kb-macarthur.mjs
//
// Macarthur DEMO KB loader. Reads backend/db/kb-seed-macarthur.md, parses it,
// and replaces all kb_entries rows for deployment_slug 'macarthur' with the
// parsed set. Idempotent (delete-then-insert) — the seed file is the source
// of truth.
//
// DRAFT-FOR-APPROVAL: every entry is sourced/inferred from Macarthur's site +
// audit files and stays [CONFIRM] until Macarthur signs off. The draft status
// is recorded in the `source` column (SOURCE_TAG below), not embedded in
// bot-facing bodies (build-time meta-notes were stripped to avoid leaking
// "[Bot guidance: ...]" / "[CONFIRM ...]" text to customers in the demo).
//
// Usage (Node 24+, native --env-file):
//   node --env-file=backend/.env backend/scripts/load-kb-macarthur.mjs
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { parseSeedFile, replaceKbForDeployment } from '../lib/kb.js';
import { macarthurConfig } from '../config/macarthur.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEED_PATH = resolve(__dirname, '..', 'db', 'kb-seed-macarthur.md');
const DEPLOYMENT_SLUG = macarthurConfig.client_slug;
const SOURCE_TAG = 'macarthur-demo-draft-CONFIRM';

async function main() {
  console.log(`[load-kb-macarthur] reading: ${SEED_PATH}`);
  const markdown = await readFile(SEED_PATH, 'utf8');

  const parsed = parseSeedFile(markdown);
  if (!parsed.ok) {
    console.error('[load-kb-macarthur] parse failed:', parsed.error);
    process.exit(1);
  }

  console.log(`[load-kb-macarthur] parsed ${parsed.entries.length} entries`);
  parsed.entries.forEach((e, i) => {
    console.log(
      `  [${i + 1}] ${e.content_type.padEnd(9)} ${e.question.slice(0, 60)}` +
      (e.attribution ? ` (attr: ${e.attribution})` : '')
    );
  });

  console.log(`[load-kb-macarthur] replacing kb_entries for deployment: ${DEPLOYMENT_SLUG}`);
  const result = await replaceKbForDeployment(
    DEPLOYMENT_SLUG,
    parsed.entries,
    SOURCE_TAG
  );

  if (!result.ok) {
    console.error('[load-kb-macarthur] replace failed:', result.error);
    process.exit(1);
  }

  console.log(`[load-kb-macarthur] inserted ${result.inserted} entries successfully`);
  console.log('[load-kb-macarthur] done.');
}

main().catch(err => {
  console.error('[load-kb-macarthur] fatal:', err);
  process.exit(1);
});
