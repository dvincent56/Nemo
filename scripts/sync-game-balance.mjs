#!/usr/bin/env node
// Copies the canonical game-balance.json into apps/web/public/data/ so the
// browser (projection worker + dev simulator) fetches the same values the
// backend loads from the filesystem. Run via predev / prebuild hooks in
// apps/web/package.json — do not edit apps/web/public/data/game-balance.json
// by hand; it is regenerated.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const src = resolve(repoRoot, 'packages/game-balance/game-balance.json');
const dst = resolve(repoRoot, 'apps/web/public/data/game-balance.json');

const content = readFileSync(src, 'utf-8');
mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, content, 'utf-8');

const bytes = Buffer.byteLength(content, 'utf-8');
console.log(`[sync-game-balance] ${src} → ${dst} (${bytes} bytes)`);
