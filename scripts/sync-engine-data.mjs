#!/usr/bin/env node
// Synchronise les données d'engine canoniques vers apps/web/public/data/
// pour que le navigateur (worker projection, dev simulator, marina) lise
// les mêmes valeurs que le backend.
//
// Source unique :
//   - packages/game-balance/game-balance.json
//   - packages/polar-lib/polars/*.json
//
// Destination régénérée (gitignored) :
//   - apps/web/public/data/game-balance.json
//   - apps/web/public/data/polars/*.json
//
// Lancé via predev / prebuild dans apps/web/package.json. Ne pas éditer
// les fichiers dans apps/web/public/data/ — ils sont régénérés.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function copyFile(src, dst, label) {
  const content = readFileSync(src, 'utf-8');
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, content, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  console.log(`[sync-engine-data] ${label} (${bytes} bytes)`);
}

function copyDir(srcDir, dstDir, ext = '.json') {
  mkdirSync(dstDir, { recursive: true });
  const entries = readdirSync(srcDir);
  let copied = 0;
  for (const name of entries) {
    if (!name.endsWith(ext)) continue;
    const srcPath = join(srcDir, name);
    if (!statSync(srcPath).isFile()) continue;
    const dstPath = join(dstDir, name);
    const content = readFileSync(srcPath);
    writeFileSync(dstPath, content);
    copied += 1;
  }
  console.log(`[sync-engine-data] ${srcDir} → ${dstDir} (${copied} ${ext} files)`);
}

// 1) game-balance.json (file)
copyFile(
  resolve(repoRoot, 'packages/game-balance/game-balance.json'),
  resolve(repoRoot, 'apps/web/public/data/game-balance.json'),
  'game-balance.json synced',
);

// 2) polars/*.json (directory)
copyDir(
  resolve(repoRoot, 'packages/polar-lib/polars'),
  resolve(repoRoot, 'apps/web/public/data/polars'),
);
