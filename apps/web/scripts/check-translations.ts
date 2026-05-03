import * as ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface UsedKey {
  ns: string;
  key: string;
}

export interface ValidationOptions {
  messagesDir: string;
  srcDir: string;
  locales: readonly string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const TRANSLATION_FN_NAMES = new Set(['useTranslations', 'getTranslations']);

function walkFiles(dir: string, exts: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry.startsWith('.next')) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else if (exts.includes(extname(full))) out.push(full);
    }
  }
  return out;
}

function extractFromFile(filePath: string): UsedKey[] {
  const source = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, string>();
  const used: UsedKey[] = [];

  function visit(node: ts.Node): void {
    // const t = useTranslations('namespace')
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      // also handle: const t = await getTranslations(...)
      const callExpr = ts.isAwaitExpression(init) ? init.expression : init;
      if (ts.isCallExpression(callExpr) && ts.isIdentifier(callExpr.expression)) {
        if (TRANSLATION_FN_NAMES.has(callExpr.expression.text)) {
          const arg = callExpr.arguments[0];
          if (arg && ts.isStringLiteral(arg)) {
            bindings.set(node.name.text, arg.text);
          } else if (arg && ts.isObjectLiteralExpression(arg)) {
            // getTranslations({ locale, namespace: 'marina' })
            for (const prop of arg.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text === 'namespace' &&
                ts.isStringLiteral(prop.initializer)
              ) {
                bindings.set(node.name.text, prop.initializer.text);
              }
            }
          }
        }
      }
    }

    // t('key') ou tEvent('code')
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text;
      if (bindings.has(fnName)) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          used.push({ ns: bindings.get(fnName)!, key: arg.text });
        }
      } else if (fnName === 'tEvent') {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          used.push({ ns: 'events', key: arg.text });
        }
      }
    }

    // t.rich('key', ...) ou t.raw('key') — méthodes du translator next-intl
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ts.isIdentifier(node.expression.name)
    ) {
      const fnName = node.expression.expression.text;
      const method = node.expression.name.text;
      if (bindings.has(fnName) && (method === 'rich' || method === 'raw' || method === 'markup')) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          used.push({ ns: bindings.get(fnName)!, key: arg.text });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return used;
}

export function extractUsedKeys(srcDir: string): UsedKey[] {
  const files = walkFiles(srcDir, ['.ts', '.tsx']);
  const all: UsedKey[] = [];
  for (const f of files) {
    if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
    all.push(...extractFromFile(f));
  }
  return all;
}

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function loadLocaleKeys(messagesDir: string, locale: string): Set<string> {
  const file = join(messagesDir, `${locale}.json`);
  if (!existsSync(file)) {
    throw new Error(`Missing messages file: ${file}`);
  }
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  return new Set(flattenKeys(data));
}

export function validateTranslations(opts: ValidationOptions): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const used = extractUsedKeys(opts.srcDir);
  const usedSet = new Set(used.map((u) => `${u.ns}.${u.key}`));

  const localeSets = new Map<string, Set<string>>();
  for (const locale of opts.locales) {
    localeSets.set(locale, loadLocaleKeys(opts.messagesDir, locale));
  }

  // 1. Missing : clé utilisée mais absente d'une locale
  for (const fullKey of usedSet) {
    for (const locale of opts.locales) {
      if (!localeSets.get(locale)!.has(fullKey)) {
        errors.push(`Missing key ${fullKey} in messages/${locale}.json`);
      }
    }
  }

  // 2. Inconsistent : clé présente dans fr.json mais absente d'une autre locale
  const frKeys = localeSets.get('fr');
  if (frKeys) {
    for (const key of frKeys) {
      for (const locale of opts.locales) {
        if (locale === 'fr') continue;
        if (!localeSets.get(locale)!.has(key)) {
          errors.push(`Inconsistent: key ${key} present in fr.json but missing in ${locale}.json`);
        }
      }
    }
  }

  // 3. Orphan : clé présente mais jamais utilisée (warn)
  if (frKeys) {
    for (const key of frKeys) {
      if (!usedSet.has(key)) {
        warnings.push(`Orphan key ${key} (in messages but never referenced in code)`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// CLI entry
function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  const result = validateTranslations({
    messagesDir: join(repoRoot, 'messages'),
    srcDir: join(repoRoot, 'src'),
    locales: ['fr', 'en', 'es', 'de'],
  });

  for (const w of result.warnings) console.warn(`⚠ ${w}`);
  for (const e of result.errors) console.error(`✗ ${e}`);

  if (result.ok) {
    const usedCount = extractUsedKeys(join(repoRoot, 'src')).length;
    console.log(`✓ ${usedCount} clés utilisées, ${result.warnings.length} orphelines, 4 locales complètes`);
    process.exit(0);
  } else {
    console.error(`\n✗ ${result.errors.length} erreur(s) i18n`);
    process.exit(1);
  }
}

// ESM-safe "is main module" check (project compile en module: ESNext)
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
