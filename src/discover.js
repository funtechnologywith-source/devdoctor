import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'vendor', 'dist', 'build', 'out',
  'target', 'coverage', '.next', '.nuxt', '.venv', 'venv', '__pycache__',
  '.tox', 'site-packages', 'bower_components', '.cache', '.idea', '.vscode',
]);

const MAX_DOCS = 200;
const MAX_DOC_BYTES = 300 * 1024; // giant generated docs aren't worth the parse time

/** Changelogs churn by design and old versions live there on purpose. */
function isChangelogFile(name) {
  return /^(changelog|changes|history|news|releases|release[-_]?notes)\b/i.test(name);
}

/**
 * Find markdown files worth checking, README-first so the cap never
 * crowds out the main docs.
 */
export function discoverDocs(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (found.length >= MAX_DOCS || depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = [];
    const dirs = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) dirs.push(entry.name);
      } else if (/\.(md|markdown)$/i.test(entry.name) && !isChangelogFile(entry.name)) {
        try {
          if (fs.statSync(path.join(dir, entry.name)).size <= MAX_DOC_BYTES) {
            files.push(entry.name);
          }
        } catch { /* unreadable: skip */ }
      }
    }
    // READMEs first within each directory
    files.sort((a, b) => Number(/^readme/i.test(b)) - Number(/^readme/i.test(a)));
    for (const f of files) {
      if (found.length >= MAX_DOCS) return;
      found.push(path.join(dir, f));
    }
    for (const d of dirs) walk(path.join(dir, d), depth + 1);
  };
  walk(root, 0);
  return found;
}

const sourceCache = new Map();

/** Source files for import/CLI analysis: js/ts/py, same ignore rules. */
export function discoverSources(root) {
  if (sourceCache.has(root)) return sourceCache.get(root);
  const found = [];
  const MAX_SOURCES = 2000;
  const walk = (dir, depth) => {
    if (found.length >= MAX_SOURCES || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (/\.(mjs|cjs|jsx?|tsx?|py)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        if (found.length >= MAX_SOURCES) return;
        found.push(full);
      }
    }
  };
  walk(root, 0);
  sourceCache.set(root, found);
  return found;
}
