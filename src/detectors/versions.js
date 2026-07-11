/**
 * Detector: stale versions.
 * Compares versions the docs claim against what the manifests declare:
 *  - "version is X" / "vX" mentions of the project's own version
 *  - pkg@X install pins
 *  - static shields.io version badges
 * Only exact-version claims are checked; ranges and other projects' versions
 * are left alone.
 */
export function detectStaleVersions({ docs, ctx }) {
  const findings = [];
  const self = ctx.self;
  if (!self) return findings;

  const selfName = escapeRe(self.name);
  const shortName = escapeRe(self.name.replace(/^@[^/]+\//, ''));
  const SEMVER = '(\\d+\\.\\d+\\.\\d+(?:[-+][\\w.]+)?)';

  const prosePatterns = [
    // "current version is 2.0.0", "version: 2.0.0", "Version 2.0.0"
    new RegExp(`\\bversion(?:\\s+is|:)?\\s+v?${SEMVER}`, 'gi'),
    // "myproject v2.0.0" / "myproject 2.0.0"
    new RegExp(`\\b(?:${selfName}|${shortName})\\s+v?${SEMVER}`, 'gi'),
  ];
  const pinPattern = new RegExp(`(?:${selfName}|${shortName})@v?${SEMVER}`, 'g');
  const badgePattern = new RegExp(
    `shields\\.io/badge/(?:version|release|npm|pypi|crates)[^\\s)]*?-v?${SEMVER}`,
    'gi',
  );

  for (const doc of docs) {
    if (isChangelog(doc.file)) continue; // old versions live there on purpose
    const lines = doc.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const seen = new Set();
      const flag = (mentioned, what) => {
        if (mentioned === self.version || seen.has(mentioned)) return;
        seen.add(mentioned);
        findings.push({
          detector: 'versions',
          severity: 'stale',
          file: doc.file,
          line: i + 1,
          message: `${what} says ${mentioned}, but ${manifestName(ctx)} says ${self.version}`,
        });
      };

      for (const re of prosePatterns) {
        for (const m of line.matchAll(re)) flag(m[1], 'docs text');
      }
      for (const m of line.matchAll(pinPattern)) flag(m[1], `"${self.name}@${m[1]}" pin`);
      for (const m of line.matchAll(badgePattern)) flag(m[1], 'version badge');
    }
  }
  return findings;
}

function isChangelog(file) {
  const base = file.split(/[\\/]/).pop() ?? '';
  return /^(changelog|changes|history|news|releases|release[-_]?notes|migration|upgrading|upgrade)\b/i.test(base);
}

function manifestName(ctx) {
  return ctx.packageJson ? 'package.json' : 'the project manifest';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
