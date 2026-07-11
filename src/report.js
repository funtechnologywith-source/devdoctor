import path from 'node:path';
import pc from 'picocolors';

const DETECTOR_META = {
  links: { title: 'Broken internal links', icon: '🔗' },
  cli: { title: 'CLI drift', icon: '⌨️ ' },
  code: { title: 'Code blocks that don’t parse', icon: '🧪' },
  versions: { title: 'Stale versions', icon: '🏷️ ' },
  imports: { title: 'Dead imports in examples', icon: '📦' },
};

const SEVERITY_META = {
  broken: { label: 'BROKEN', paint: (s) => pc.bold(pc.red(s)) },
  stale: { label: 'STALE', paint: (s) => pc.bold(pc.yellow(s)) },
  suggestion: { label: 'CHECK', paint: (s) => pc.bold(pc.cyan(s)) },
};

export function printReport({ root, docs, findings, elapsed, quiet }) {
  const out = [];
  const w = (s = '') => out.push(s);

  w();
  w(`  ${pc.bold('devdoctor')} ${pc.dim('·')} check-docs ${pc.dim(shortPath(root))}`);

  if (findings.length === 0) {
    w();
    w(`  ${pc.green('✔')} ${pc.bold('No documentation drift found.')}`);
    w(`  ${pc.dim(`${docs.length} markdown file${docs.length === 1 ? '' : 's'} scanned in ${fmtMs(elapsed)}`)}`);
    w();
    console.log(out.join('\n'));
    return;
  }

  if (!quiet) {
    // group findings by detector, in a fixed order
    const groups = new Map();
    for (const f of findings) {
      if (!groups.has(f.detector)) groups.set(f.detector, []);
      groups.get(f.detector).push(f);
    }

    for (const key of Object.keys(DETECTOR_META)) {
      const group = groups.get(key);
      if (!group) continue;
      const meta = DETECTOR_META[key];
      w();
      w(`  ${meta.icon} ${pc.bold(meta.title)} ${pc.dim(`(${group.length})`)}`);
      w(`  ${pc.dim('─'.repeat(58))}`);
      for (const f of group) {
        const sev = SEVERITY_META[f.severity] ?? SEVERITY_META.suggestion;
        const loc = `${rel(root, f.file)}${f.line ? ':' + f.line : ''}`;
        w(`   ${sev.paint(sev.label.padEnd(7))} ${pc.underline(loc)}`);
        w(`           ${f.message}`);
        if (f.hint) w(`           ${pc.dim('↳ ' + f.hint)}`);
      }
    }
  }

  // summary
  const counts = { broken: 0, stale: 0, suggestion: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const parts = [];
  if (counts.broken) parts.push(pc.red(`${counts.broken} broken`));
  if (counts.stale) parts.push(pc.yellow(`${counts.stale} stale`));
  if (counts.suggestion) parts.push(pc.cyan(`${counts.suggestion} to check`));

  w();
  w(`  ${pc.dim('─'.repeat(60))}`);
  w(
    `  ${pc.bold(`${findings.length} issue${findings.length === 1 ? '' : 's'}`)} ` +
      `(${parts.join(pc.dim(', '))}) ` +
      pc.dim(`· ${docs.length} markdown files · ${fmtMs(elapsed)}`),
  );
  w();
  console.log(out.join('\n'));
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function shortPath(p) {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  return home && p.startsWith(home) ? '~' + p.slice(home.length).split(path.sep).join('/') : p;
}

function fmtMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
