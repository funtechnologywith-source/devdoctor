import path from 'node:path';
import { discoverDocs } from './discover.js';
import { parseDoc } from './markdown.js';
import { loadRepoContext } from './repo-context.js';
import { detectBrokenLinks } from './detectors/links.js';
import { detectCliMismatch } from './detectors/cli.js';
import { detectBadCodeBlocks } from './detectors/codeblocks.js';
import { detectStaleVersions } from './detectors/versions.js';
import { detectDeadImports } from './detectors/imports.js';
import { printReport } from './report.js';

const DETECTORS = [
  detectBrokenLinks,
  detectCliMismatch,
  detectBadCodeBlocks,
  detectStaleVersions,
  detectDeadImports,
];

export async function checkDocs(root, opts = {}) {
  const started = Date.now();

  const docFiles = discoverDocs(root);
  const docs = [];
  for (const file of docFiles) {
    try {
      docs.push(parseDoc(file));
    } catch {
      // unreadable/binary-ish file: skip, never crash the run
    }
  }

  const ctx = loadRepoContext(root);
  const findings = [];
  for (const detector of DETECTORS) {
    try {
      const out = await detector({ root, docs, ctx });
      if (out) findings.push(...out);
    } catch {
      // a detector failure must not take down the run
    }
  }

  // stable order: by file, then line, then severity
  const sevRank = { broken: 0, stale: 1, suggestion: 2 };
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9),
  );

  const elapsed = Date.now() - started;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          root,
          docsScanned: docs.length,
          elapsedMs: elapsed,
          findings: findings.map((f) => ({ ...f, file: rel(root, f.file) })),
        },
        null,
        2,
      ),
    );
  } else {
    printReport({ root, docs, findings, elapsed, quiet: opts.quiet });
  }

  return findings.length > 0 ? 1 : 0;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}
