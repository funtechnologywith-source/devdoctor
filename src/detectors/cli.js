import fs from 'node:fs';
import path from 'node:path';
import { discoverSources } from '../discover.js';

/**
 * Detector: CLI drift.
 * Builds the set of real subcommands/flags from the code (commander/yargs/
 * click/argparse patterns + package.json bin), then checks every documented
 * invocation of the repo's own binaries against it. Also verifies
 * `npm run <script>` against package.json scripts.
 */
export function detectCliMismatch({ root, docs, ctx }) {
  const findings = [];
  const pkg = ctx.packageJson;

  const binNames = getBinNames(pkg);
  const cliDef = binNames.size > 0 ? extractCliDefinition(root) : null;
  const scripts = new Set(Object.keys(pkg?.scripts ?? {}));

  for (const doc of docs) {
    for (const { text, line } of commandLines(doc)) {
      checkNpmRun(text, line, doc, pkg, scripts, findings);
      if (cliDef) checkOwnCli(text, line, doc, binNames, cliDef, findings);
    }
  }
  return findings;
}

function getBinNames(pkg) {
  const names = new Set();
  if (!pkg) return names;
  if (typeof pkg.bin === 'string' && pkg.name) names.add(pkg.name.replace(/^@[^/]+\//, ''));
  else if (pkg.bin && typeof pkg.bin === 'object') for (const k of Object.keys(pkg.bin)) names.add(k);
  return names;
}

/** Every line of every shell-ish code block + every inline code span. */
function* commandLines(doc) {
  const SHELL = new Set(['bash', 'sh', 'shell', 'console', 'zsh', 'terminal', 'cmd', '']);
  for (const block of doc.codeBlocks) {
    if (!SHELL.has(block.lang)) continue;
    const lines = block.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].replace(/^\s*[$>]\s+/, '').trim();
      if (text && !text.startsWith('#')) yield { text, line: block.line + 1 + i };
    }
  }
  for (const span of doc.inlineCode) {
    yield { text: span.value.replace(/^\s*[$>]\s+/, '').trim(), line: span.line };
  }
}

function checkNpmRun(text, line, doc, pkg, scripts, findings) {
  if (!pkg) return;
  const m = text.match(/^npm\s+(?:run|run-script)\s+([\w:.-]+)/);
  if (m && !scripts.has(m[1])) {
    findings.push({
      detector: 'cli',
      severity: 'broken',
      file: doc.file,
      line,
      message: `script "npm run ${m[1]}" isn't defined in package.json scripts`,
      hint: nearest(m[1], scripts, 'npm run '),
    });
  }
}

function checkOwnCli(text, line, doc, binNames, cliDef, findings) {
  // strip runner prefixes so "npx tool ..." and "$ tool ..." both match
  const cleaned = text.replace(/^(?:npx|pnpm\s+exec|yarn\s+dlx|bunx)\s+/, '');
  const tokens = tokenize(cleaned);
  if (tokens.length === 0 || !binNames.has(tokens[0])) return;

  const args = tokens.slice(1);
  const sub = args.find((t) => !t.startsWith('-'));
  const flags = args
    .filter((t) => t.startsWith('--'))
    .map((t) => t.split('=')[0])
    .filter((t) => !GLOBAL_FLAGS.has(t));

  if (cliDef.commands.size > 0 && sub && !cliDef.commands.has(sub)) {
    findings.push({
      detector: 'cli',
      severity: 'broken',
      file: doc.file,
      line,
      message: `command "${tokens[0]} ${sub}" isn't defined by the CLI`,
      hint: nearest(sub, cliDef.commands, `${tokens[0]} `),
    });
    return; // flags of an unknown command aren't worth piling on
  }

  if (cliDef.flags.size > 0) {
    for (const flag of flags) {
      if (!cliDef.flags.has(flag) && !cliDef.flags.has(flag.replace(/^--no-/, '--'))) {
        findings.push({
          detector: 'cli',
          severity: 'broken',
          file: doc.file,
          line,
          message: `flag "${flag}" isn't defined by the CLI${sub ? ` (in "${tokens[0]} ${sub} ..."`  + ')' : ''}`,
          hint: nearest(flag, cliDef.flags, ''),
        });
      }
    }
  }
}

const GLOBAL_FLAGS = new Set(['--help', '--version', '--no-color', '--color']);

function tokenize(text) {
  // good-enough shell tokenizer: whitespace split, respecting simple quotes,
  // stop at pipes/redirects/chaining
  const tokens = [];
  const re = /"[^"]*"|'[^']*'|\S+/g;
  for (const m of text.matchAll(re)) {
    const t = m[0];
    if (/^(\||&&|\|\||;|>|>>|<)$/.test(t)) break;
    tokens.push(t.replace(/^["']|["']$/g, ''));
  }
  return tokens;
}

/**
 * Scan source files for CLI framework definitions.
 * Returns { commands: Set, flags: Set } (long flags only).
 */
function extractCliDefinition(root) {
  const commands = new Set();
  const flags = new Set();

  for (const file of discoverSources(root)) {
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const isPy = file.endsWith('.py');
    // comments and docstrings are full of example invocations; don't
    // mistake them for definitions
    src = isPy ? stripPyComments(src) : stripJsComments(src);

    if (!isPy) {
      // commander / yargs: .command('name <args>')
      for (const m of src.matchAll(/\.command\(\s*['"`]([^'"`\n]+)['"`]/g)) {
        const name = m[1].trim().split(/\s+/)[0];
        if (name && name !== '*' && name !== '$0') commands.add(name);
      }
      // commander: .option('-f, --flag <x>', ...) / .requiredOption / new Option('--x')
      for (const m of src.matchAll(/(?:\.(?:option|requiredOption)|new\s+Option)\(\s*['"`]([^'"`\n]+)['"`]/g)) {
        for (const f of m[1].matchAll(/--[\w-]+/g)) flags.add(f[0]);
        // yargs-style bare name: .option('watch', {...})
        if (!m[1].includes('-') && /^[\w-]+$/.test(m[1].trim())) flags.add('--' + m[1].trim());
      }
      // yargs: .options({ watch: {...}, out: {...} })
      for (const m of src.matchAll(/\.options\(\s*\{([^}]+)\}/g)) {
        for (const key of m[1].matchAll(/(?:^|[,{]\s*)['"]?([\w-]+)['"]?\s*:/g)) flags.add('--' + key[1]);
      }
    } else {
      // click: @x.command("name") / @x.command() def name():
      for (const m of src.matchAll(
        /@[\w.]*command\s*\((?:\s*['"]([^'"]+)['"])?[^)]*\)\s*((?:@[^\n]*\n\s*)*)def\s+(\w+)/g,
      )) {
        commands.add(m[1] ?? m[3].replaceAll('_', '-'));
      }
      // click: @x.option("--flag", ...)
      for (const m of src.matchAll(/@[\w.]*option\s*\(\s*((?:['"][^'"]+['"]\s*,?\s*)+)/g)) {
        for (const f of m[1].matchAll(/--[\w-]+/g)) flags.add(f[0]);
      }
      // argparse: add_parser("name"), add_argument("--flag", "-f")
      for (const m of src.matchAll(/add_parser\(\s*['"]([^'"]+)['"]/g)) commands.add(m[1]);
      for (const m of src.matchAll(/add_argument\(\s*((?:['"][^'"]+['"]\s*,?\s*)+)/g)) {
        for (const f of m[1].matchAll(/--[\w-]+/g)) flags.add(f[0]);
      }
    }
  }
  return { commands, flags };
}

/** Rough comment strip — good enough for definition extraction. */
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function stripPyComments(src) {
  return src
    .replace(/("""|''')[\s\S]*?\1/g, '')
    .replace(/(^|\s)#[^\n]*/g, '$1');
}

function nearest(input, candidates, prefix) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = similarity(input.toLowerCase(), c.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.4 ? `did you mean "${prefix}${best}"?` : null;
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
