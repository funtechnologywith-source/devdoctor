import fs from 'node:fs';
import path from 'node:path';

/**
 * Load everything detectors want to know about the repo itself:
 * manifests (package.json / requirements.txt / Cargo.toml / pyproject.toml)
 * and the dependency->version map they declare.
 */
export function loadRepoContext(root) {
  const ctx = {
    root,
    packageJson: null,
    /** Map of dependency name -> declared version range, across ecosystems */
    deps: new Map(),
    /** The project's own { name, version } if a manifest declares one */
    self: null,
  };

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      ctx.packageJson = pkg;
      if (pkg.name && pkg.version) ctx.self = { name: pkg.name, version: pkg.version };
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(pkg[key] ?? {})) {
          if (!ctx.deps.has(name)) ctx.deps.set(name, String(range));
        }
      }
    } catch {
      /* malformed package.json: proceed without it */
    }
  }

  const reqPath = path.join(root, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      for (const line of fs.readFileSync(reqPath, 'utf8').split('\n')) {
        const m = line.trim().match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*([=<>!~]=?\s*[\w.*+-]+)?/);
        if (m && m[1] && !line.trim().startsWith('#')) {
          ctx.deps.set(m[1].toLowerCase(), (m[2] ?? '').replace(/\s+/g, ''));
        }
      }
    } catch { /* ignore */ }
  }

  const pyprojectPath = path.join(root, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const toml = fs.readFileSync(pyprojectPath, 'utf8');
      const nameM = toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      const verM = toml.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
      if (nameM && verM && !ctx.self) ctx.self = { name: nameM[1], version: verM[1] };
    } catch { /* ignore */ }
  }

  const cargoPath = path.join(root, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      const toml = fs.readFileSync(cargoPath, 'utf8');
      const pkgSection = toml.split(/^\[/m).find((s) => s.startsWith('package]'));
      if (pkgSection) {
        const nameM = pkgSection.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
        const verM = pkgSection.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
        if (nameM && verM && !ctx.self) ctx.self = { name: nameM[1], version: verM[1] };
      }
      const depSection = toml.split(/^\[/m).find((s) => s.startsWith('dependencies]'));
      if (depSection) {
        for (const m of depSection.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']+)["']/gm)) {
          ctx.deps.set(m[1], m[2]);
        }
      }
    } catch { /* ignore */ }
  }

  return ctx;
}
