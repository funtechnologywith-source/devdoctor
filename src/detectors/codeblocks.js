import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as babelParse } from '@babel/parser';

const JS_LANGS = new Set(['js', 'javascript', 'jsx', 'mjs', 'cjs', 'node']);
const TS_LANGS = new Set(['ts', 'typescript', 'tsx']);
const PY_LANGS = new Set(['python', 'py', 'python3']);
const MAX_PY_BLOCKS = 200;

/**
 * Detector: fenced code blocks that don't parse.
 * JS/TS via @babel/parser. Python blocks are all compiled in a single
 * `python` subprocess (skipped silently when no Python is on PATH).
 * Doc snippets are fragments, so we dedent them and tolerate
 * decorator-only blocks before calling one broken.
 */
export function detectBadCodeBlocks({ docs }) {
  const findings = [];
  const pyBlocks = [];

  for (const doc of docs) {
    for (const block of doc.codeBlocks) {
      if (looksLikePlaceholder(block.value)) continue;

      if (JS_LANGS.has(block.lang) || TS_LANGS.has(block.lang)) {
        const err = checkJs(block.value, TS_LANGS.has(block.lang));
        if (err) {
          findings.push({
            detector: 'code',
            severity: 'broken',
            file: doc.file,
            line: block.line + (err.line ?? 0),
            message: `${block.lang} block doesn't parse: ${err.message}`,
          });
        }
      } else if (PY_LANGS.has(block.lang) && !isReplTranscript(block.value)) {
        if (pyBlocks.length < MAX_PY_BLOCKS) pyBlocks.push({ doc, block });
      }
    }
  }

  for (const { doc, block, err } of checkPythonBatch(pyBlocks)) {
    if (!err) continue;
    findings.push({
      detector: 'code',
      severity: 'broken',
      file: doc.file,
      line: block.line + (err.line ?? 0),
      message: `python block doesn't parse: ${err.message}`,
    });
  }
  return findings;
}

/** Docs often use "..." or <angle-placeholders>; don't punish those blocks. */
function looksLikePlaceholder(code) {
  if (/^\s*(\.\.\.|…)\s*$/m.test(code)) return true;
  if (/<[a-z][\w-]*(\s+[\w-]+)*>/i.test(code) && !/=>/.test(code) && !/<\/|<[A-Z]/.test(code)) {
    // "<your-token>"-style placeholder (but not JSX/HTML)
    return true;
  }
  return false;
}

function isReplTranscript(code) {
  return /^\s*>>>/m.test(code);
}

function checkJs(code, ts) {
  const plugins = ['jsx', 'importAttributes', ['decorators', { version: '2023-11' }]];
  if (ts) plugins.push('typescript');
  try {
    babelParse(code, {
      sourceType: 'unambiguous',
      errorRecovery: false,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowUndeclaredExports: true,
      plugins,
    });
    return null;
  } catch (err) {
    return {
      message: String(err.message).replace(/\s*\(\d+:\d+\)\s*$/, ''),
      line: err.loc?.line ?? 0,
    };
  }
}

/**
 * Compile every python block in ONE subprocess. The driver dedents each
 * snippet and retries decorator-only fragments with a stub `def` appended,
 * so normal documentation fragments don't get flagged.
 */
const PY_DRIVER = `
import json, sys, textwrap
results = []
for p in sys.argv[1:]:
    with open(p, encoding="utf-8") as f:
        src = textwrap.dedent(f.read())
    err = None
    for attempt in (src, src + "\\n\\ndef _devdoctor_stub():\\n    pass\\n"):
        try:
            compile(attempt, "<block>", "exec")
            err = None
            break
        except SyntaxError as e:
            err = {"line": e.lineno or 0, "msg": "%s: %s" % (type(e).__name__, e.msg)}
    results.append(err)
print(json.dumps(results))
`;

function checkPythonBatch(pyBlocks) {
  if (pyBlocks.length === 0) return [];
  const python = findPython();
  if (!python) return [];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdoctor-'));
  try {
    const driver = path.join(dir, '_driver.py');
    fs.writeFileSync(driver, PY_DRIVER, 'utf8');
    const files = pyBlocks.map(({ block }, i) => {
      const f = path.join(dir, `block-${i}.py`);
      fs.writeFileSync(f, block.value, 'utf8');
      return f;
    });
    const r = spawnSync(python, [driver, ...files], {
      timeout: 15000,
      shell: false,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.status !== 0) return [];
    const results = JSON.parse(r.stdout);
    return pyBlocks.map(({ doc, block }, i) => ({
      doc,
      block,
      err: results[i] ? { line: results[i].line, message: results[i].msg } : null,
    }));
  } catch {
    return []; // python misbehaved: stay quiet rather than guess
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

let pythonCmd; // memoized: null = not found, string = command
function findPython() {
  if (pythonCmd !== undefined) return pythonCmd;
  const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 3000, shell: false, windowsHide: true });
      if (r.status === 0) {
        pythonCmd = cmd;
        return cmd;
      }
    } catch { /* try next */ }
  }
  pythonCmd = null;
  return null;
}
