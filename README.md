# devdoctor 🩺

**Documentation drift detector.** Scans a repo and flags the places where the
README and docs no longer match the code — broken links, commands that don't
exist anymore, examples that import functions you deleted last quarter.

Zero config. No network. CI-friendly. Runs in seconds.

```bash
npx devdoctor check-docs
```

## What it catches

| Detector | Example finding |
|---|---|
| 🔗 Broken internal links | `[config guide](docs/config.md)` → file was moved |
| ⌨️ CLI drift | README says `mytool deploy --minify`, the CLI defines neither |
| 🧪 Code blocks that don't parse | JS/TS checked with Babel, Python with your local interpreter |
| 🏷️ Stale versions | README pins `yourpkg@2.0.0`, `package.json` says `3.1.0` |
| 📦 Dead imports in examples | `import { destroyWidget } from 'yourpkg'` → export no longer exists |

Every finding comes with file, line number, and — when devdoctor can guess —
a `did you mean …?` hint.

## Usage

```bash
# check the current directory
npx devdoctor check-docs

# check another repo
npx devdoctor check-docs ../some-project

# machine-readable output
npx devdoctor check-docs --json

# just the summary line
npx devdoctor check-docs --quiet
```

Exit code is `0` when the docs are clean and `1` when drift is found, so it
drops straight into CI:

```yaml
- name: Check docs for drift
  run: npx devdoctor check-docs
```

## How it works

- Markdown is parsed to an AST with [remark](https://github.com/remarkjs/remark)
  — links, headings, code fences, and inline code with exact positions.
- CLI definitions are recovered from `package.json` `bin` entries plus
  commander/yargs (JS) and click/argparse (Python) patterns in the source,
  then diffed against every documented invocation.
- JS/TS snippets are parsed with [`@babel/parser`](https://babeljs.io/docs/babel-parser);
  Python snippets are compiled in a single local `python` subprocess
  (skipped when Python isn't installed).
- Doc snippets are treated as fragments: indented excerpts are dedented,
  decorator-only blocks get a stub body, and blocks containing `...`
  placeholders or `>>>` REPL transcripts are left alone.
- Changelogs are skipped — old version numbers live there on purpose.

Everything runs locally. Nothing is executed from the repo being scanned —
code blocks are parsed, never run.

## What it deliberately ignores

- External URLs (that's a job for a link checker with a network budget)
- `CHANGELOG` / `HISTORY` / release-notes files
- Version ranges (`^1.2.0`) and other projects' versions in prose
- Imports of third-party packages in examples

## Requirements

Node.js 18.11+. Python 3 on `PATH` is optional and only used to validate
Python code blocks.

## License

MIT
