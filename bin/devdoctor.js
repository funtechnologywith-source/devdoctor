#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error('devdoctor: unexpected error');
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  },
);
