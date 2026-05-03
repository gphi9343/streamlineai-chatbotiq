// backend/scripts/load-kb.js
//
// One-shot loader. Reads backend/db/kb-seed.md, parses it, and replaces
// all kb_entries rows for the configured deployment with the parsed set.
//
// Usage (from backend/ directory):
//   node scripts/load-kb.js
//
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.
// On Railway: set these in env vars and run via `railway run node scripts/load-kb.js`.
// Locally: load from a .env file (not committed) before running.
//
// This script is idempotent — running it twice gives the same result. It
// deletes existing entries for the deployment before inserting, so the
// seed file is the source of truth.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { parseSeedFile, replaceKbForDeployment } from '../lib/kb.js';
import { upuntConfig } from '../config/upunt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEED_PATH = resolve(__dirname, '..', 'db', 'kb-seed.md');
const DEPLOYMENT_SLUG = upuntConfig.client_slug;
const SOURCE_TAG = 'manual-seed-v1.2';

async function main() {
  console.log(`[load-kb] reading: ${SEED_PATH}`);
  const markdown = await readFile(SEED_PATH, 'utf8');

  const parsed = parseSeedFile(markdown);
  if (!parsed.ok) {
    console.error('[load-kb] parse failed:', parsed.error);
    process.exit(1);
  }

  console.log(`[load-kb] parsed ${parsed.entries.length} entries`);
  parsed.entries.forEach((e, i) => {
    console.log(
      `  [${i + 1}] ${e.content_type.padEnd(9)} ${e.question.slice(0, 60)}` +
      (e.attribution ? ` (attr: ${e.attribution})` : '')
    );
  });

  console.log(`[load-kb] replacing kb_entries for deployment: ${DEPLOYMENT_SLUG}`);
  const result = await replaceKbForDeployment(
    DEPLOYMENT_SLUG,
    parsed.entries,
    SOURCE_TAG
  );

  if (!result.ok) {
    console.error('[load-kb] replace failed:', result.error);
    process.exit(1);
  }

  console.log(`[load-kb] inserted ${result.inserted} entries successfully`);
  console.log('[load-kb] done.');
}

main().catch(err => {
  console.error('[load-kb] fatal:', err);
  process.exit(1);
});
