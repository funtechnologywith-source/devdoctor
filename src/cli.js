import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import { checkDocs } from './check-docs.js';

const HELP = `
${pc.bold('devdoctor')} — documentation drift detector

${pc.bold('Usage')}
  devdoctor check-docs [path] [options]

${pc.bold('Commands')}
  check-docs    Scan a repo for README/docs that no longer match the code

${pc.bold('Options')}
  --json        Emit findings as JSON instead of the terminal report
  --no-color    Disable colored output
  --quiet       Only print the summary line
  -h, --help    Show this help
  -v, --version Show version

${pc.bold('Exit codes')}
  0  no issues found
  1  issues found
  2  usage or internal error
`;

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        color: { type: 'boolean', default: true },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (err) {
    console.error(pc.red(`devdoctor: ${err.message}`));
    console.error(HELP);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    console.log(pkg.version);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }

  const [command, targetArg] = positionals;
  if (command !== 'check-docs') {
    console.error(pc.red(`devdoctor: unknown command "${command}"`));
    console.error(HELP);
    return 2;
  }

  const target = path.resolve(targetArg ?? '.');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(pc.red(`devdoctor: "${target}" is not a directory`));
    return 2;
  }

  return checkDocs(target, {
    json: values.json,
    quiet: values.quiet,
  });
}
