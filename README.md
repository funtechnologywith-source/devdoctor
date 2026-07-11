# devdoctor 🩺

**Documentation drift detector.** Your README was true once. devdoctor finds
the places where it stopped being true — broken links, commands that no longer
exist, examples that import functions you deleted last quarter.

## It finds real bugs

This is devdoctor running against [dotenv](https://github.com/motdotla/dotenv)
— the package with **120 million weekly downloads** that half the JavaScript
world loads its secrets with:

```
$ devdoctor check-docs ../dotenv

  devdoctor · check-docs ../dotenv

  🔗 Broken internal links (2)
  ──────────────────────────────────────────────────────────
   BROKEN  README.md:67
           anchor "#how-do-i-use-dotenv-with-import"
           doesn't match any heading in this file
   BROKEN  README-es.md:65
           anchor "#como-uso-dotenv-con-import"
           doesn't match any heading in this file

  ────────────────────────────────────────────────────────────
  2 issues (2 broken) · 6 markdown files · 525ms
```

Verify it yourself in ten seconds: open [dotenv's README](https://github.com/motdotla/dotenv#readme),
find `Import with ES6` near the top, click it. Nothing happens — the FAQ
heading it points to no longer exists in the file. Same story in the Spanish
translation, and devdoctor found both in half a second.

Zero config. No network. Nothing in the scanned repo is ever executed —
code blocks are parsed, never run.

## Quick start

```bash
npx @sajurjyabora/devdoctor check-docs            # check the current directory
npx @sajurjyabora/devdoctor check-docs ../repo    # check another repo
npx @sajurjyabora/devdoctor check-docs --json     # machine-readable output
```

Or install it globally and use the short command:

```bash
npm install -g @sajurjyabora/devdoctor
devdoctor check-docs
```

Exit code `0` when docs are clean, `1` when drift is found.

## Use it in CI

Drop this in `.github/workflows/devdoctor.yml` and drifted docs fail the build:

```yaml
name: docs

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx @sajurjyabora/devdoctor check-docs
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

## How it works

- Markdown is parsed to an AST with [remark](https://github.com/remarkjs/remark)
  — links, headings, code fences, and inline code with exact positions.
- CLI definitions are recovered from `package.json` `bin` entries plus
  commander/yargs (JS) and click/argparse (Python) patterns in the source,
  then diffed against every documented invocation.
- JS/TS snippets are parsed with [`@babel/parser`](https://babeljs.io/docs/babel-parser);
  Python snippets are compiled in a single local `python` subprocess
  (skipped when Python isn't installed).
- Doc snippets are treated as fragments, not programs: indented excerpts are
  dedented, decorator-only blocks get a stub body, and blocks containing
  `...` placeholders or `>>>` REPL transcripts are left alone.

## What it deliberately ignores

- External URLs (that's a job for a link checker with a network budget)
- `CHANGELOG` / `HISTORY` / release-notes files — old versions live there on purpose
- Version ranges (`^1.2.0`) and other projects' versions in prose
- Imports of third-party packages in examples

## Requirements

Node.js 18.11+. Python 3 on `PATH` is optional and only used to validate
Python code blocks.

## License

[MIT](LICENSE)
