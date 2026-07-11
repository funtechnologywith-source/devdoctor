import fs from 'node:fs';
import { discoverSources } from '../discover.js';

const JS_LANGS = new Set(['js', 'javascript', 'jsx', 'mjs', 'cjs', 'node', 'ts', 'typescript', 'tsx']);
const PY_LANGS = new Set(['python', 'py', 'python3']);

/**
 * Detector: dead imports in doc examples.
 * When a README code block imports from *this* package (or a relative path),
 * verify the imported names actually exist in the source.
 */
export function detectDeadImports({ root, docs, ctx }) {
  const findings = [];
  const selfNames = new Set();
  if (ctx.self) {
    selfNames.add(ctx.self.name);
    selfNames.add(ctx.self.name.replace(/^@[^/]+\//, ''));
    selfNames.add(ctx.self.name.replace(/-/g, '_')); // python module convention
  }

  let jsExports = null; // lazy: only scan sources if a doc actually imports
  let pyNames = null;

  for (const doc of docs) {
    for (const block of doc.codeBlocks) {
      if (JS_LANGS.has(block.lang)) {
        for (const imp of jsImports(block.value)) {
          const line = block.line + imp.lineOffset;
          if (imp.source.startsWith('.')) {
            // relative imports in doc examples almost always refer to the
            // reader's own project ("./errorReporter.mjs"), not this repo —
            // that's not drift, so stay quiet
            continue;
          }
          if (!selfNames.has(imp.source)) continue; // third-party: not our drift
          jsExports ??= collectJsExports(root);
          if (jsExports.size === 0) continue; // compiled/bundled repo: can't verify
          for (const name of imp.named) {
            if (!jsExports.has(name)) {
              findings.push({
                detector: 'imports',
                severity: 'broken',
                file: doc.file,
                line,
                message: `example imports { ${name} } from "${imp.source}" but no such export exists in the source`,
                hint: nearest(name, jsExports),
              });
            }
          }
        }
      } else if (PY_LANGS.has(block.lang)) {
        for (const imp of pyImports(block.value)) {
          const rootModule = imp.module.split('.')[0];
          if (!selfNames.has(rootModule)) continue;
          pyNames ??= collectPyNames(root);
          if (pyNames.size === 0) continue;
          for (const name of imp.named) {
            if (!pyNames.has(name)) {
              findings.push({
                detector: 'imports',
                severity: 'broken',
                file: doc.file,
                line: block.line + imp.lineOffset,
                message: `example does "from ${imp.module} import ${name}" but "${name}" isn't defined in the source`,
                hint: nearest(name, pyNames),
              });
            }
          }
        }
      }
    }
  }
  return findings;
}

/* ---------- docs side ---------- */

function* jsImports(code) {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // import defaultName, { a, b as c } from 'x'
    for (const m of line.matchAll(
      /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g,
    )) {
      yield { named: namedList(m[1]), source: m[2], lineOffset: i + 1 };
    }
    // bare/default import: only source matters (for relative-path checks)
    for (const m of line.matchAll(/import\s+(?:[\w$]+\s+from\s+)?['"]([^'"]+)['"]/g)) {
      yield { named: [], source: m[1], lineOffset: i + 1 };
    }
    // const { a, b } = require('x')
    for (const m of line.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      yield { named: namedList(m[1]), source: m[2], lineOffset: i + 1 };
    }
  }
}

function namedList(inner) {
  return inner
    .split(',')
    .map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim())
    .filter((s) => /^[\w$]+$/.test(s));
}

function* pyImports(code) {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*from\s+([\w.]+)\s+import\s+(.+)/);
    if (!m || m[2].trim() === '*') continue;
    const named = m[2]
      .replace(/[()#].*$/, '')
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter((s) => /^\w+$/.test(s));
    yield { module: m[1], named, lineOffset: i + 1 };
  }
}

/* ---------- source side ---------- */

function collectJsExports(root) {
  const names = new Set();
  for (const file of discoverSources(root)) {
    if (!/\.(mjs|cjs|jsx?|tsx?)$/.test(file)) continue;
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(
      /export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|type|interface|enum)\s+([\w$]+)/g,
    )) names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[\w$]+$/.test(name)) names.add(name);
      }
    }
    for (const m of src.matchAll(/(?:^|\s)exports\.([\w$]+)\s*=/g)) names.add(m[1]);
    for (const m of src.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(':')[0].trim();
        if (/^[\w$]+$/.test(name)) names.add(name);
      }
    }
  }
  return names;
}

function collectPyNames(root) {
  const names = new Set();
  for (const file of discoverSources(root)) {
    if (!file.endsWith('.py')) continue;
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/^(?:async\s+)?(?:def|class)\s+(\w+)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*/gm)) names.add(m[1]);
  }
  return names;
}

function nearest(input, candidates) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = similarity(input.toLowerCase(), c.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.5 ? `did you mean "${best}"?` : null;
}

function similarity(a, b) {
  if (a === b) return 1;
  const grams = (s) => {
    const g = new Set();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return (2 * hit) / (ga.size + gb.size);
}
