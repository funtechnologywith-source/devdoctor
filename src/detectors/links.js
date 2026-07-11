import fs from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';

/**
 * Detector: broken internal links.
 * Flags relative links to files that don't exist and #anchors that don't
 * match any heading in the target document.
 */
export function detectBrokenLinks({ root, docs }) {
  const findings = [];
  // anchors per doc file (absolute path -> Set of slugs), for cross-file #links
  const anchorsByFile = new Map(docs.map((d) => [path.resolve(d.file), d.anchors]));

  for (const doc of docs) {
    const docDir = path.dirname(doc.file);
    for (const link of doc.links) {
      const url = (link.url ?? '').trim();
      if (!url) continue;
      // external / special schemes are out of scope
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue;

      const [rawPath, rawAnchor] = splitAnchor(url);

      if (!rawPath) {
        // pure in-page anchor: #section
        if (rawAnchor && !matchAnchor(doc.anchors, rawAnchor)) {
          findings.push({
            detector: 'links',
            severity: 'broken',
            file: doc.file,
            line: link.line,
            message: `anchor "#${rawAnchor}" doesn't match any heading in this file`,
            hint: nearestAnchor(doc.anchors, rawAnchor),
          });
        }
        continue;
      }

      let target = decodeURIComponentSafe(rawPath);
      // leading "/" means repo-root-relative in most renderers
      target = target.startsWith('/')
        ? path.join(root, target)
        : path.resolve(docDir, target);

      if (!fs.existsSync(target)) {
        findings.push({
          detector: 'links',
          severity: 'broken',
          file: doc.file,
          line: link.line,
          message: `${link.image ? 'image' : 'link'} target "${rawPath}" doesn't exist`,
        });
        continue;
      }

      if (rawAnchor) {
        const targetAnchors = getAnchors(anchorsByFile, target);
        if (targetAnchors && !matchAnchor(targetAnchors, rawAnchor)) {
          findings.push({
            detector: 'links',
            severity: 'broken',
            file: doc.file,
            line: link.line,
            message: `anchor "#${rawAnchor}" not found in ${rawPath}`,
            hint: nearestAnchor(targetAnchors, rawAnchor),
          });
        }
      }
    }
  }
  return findings;
}

function splitAnchor(url) {
  const i = url.indexOf('#');
  if (i === -1) return [url, null];
  return [url.slice(0, i), url.slice(i + 1)];
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function getAnchors(anchorsByFile, target) {
  const resolved = path.resolve(target);
  if (anchorsByFile.has(resolved)) return anchorsByFile.get(resolved);
  // linked markdown file that wasn't in our scan set: parse anchors on demand
  if (/\.(md|markdown)$/i.test(resolved) && fs.existsSync(resolved)) {
    try {
      const slugger = new GithubSlugger();
      const text = fs.readFileSync(resolved, 'utf8');
      const set = new Set();
      for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
        set.add(slugger.slug(m[1].replace(/[*_`[\]]/g, '')));
      }
      for (const m of text.matchAll(/(?:name|id)\s*=\s*["']([^"']+)["']/g)) set.add(m[1]);
      anchorsByFile.set(resolved, set);
      return set;
    } catch {
      return null;
    }
  }
  return null; // non-markdown target: can't verify anchors, stay quiet
}

function matchAnchor(anchors, anchor) {
  const a = anchor.toLowerCase();
  if (anchors.has(anchor) || anchors.has(a)) return true;
  // tolerate "-1"-style dedupe suffixes users hand-wrote and stray trailing dashes
  return anchors.has(a.replace(/-+$/, ''));
}

function nearestAnchor(anchors, anchor) {
  if (!anchors || anchors.size === 0) return null;
  const a = anchor.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const candidate of anchors) {
    const score = similarity(a, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.6 ? `did you mean "#${best}"?` : null;
}

/** cheap trigram-ish similarity, good enough for a hint */
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
