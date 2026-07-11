import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import GithubSlugger from 'github-slugger';

const processor = unified().use(remarkParse).use(remarkGfm);

/**
 * Parse one markdown file into the pieces detectors care about.
 * Returns { file, text, headings, anchors, links, codeBlocks, inlineCode }.
 */
export function parseDoc(file) {
  const text = fs.readFileSync(file, 'utf8');
  const tree = processor.parse(text);

  const slugger = new GithubSlugger();
  const doc = {
    file,
    text,
    headings: [],
    anchors: new Set(),
    links: [],
    codeBlocks: [],
    inlineCode: [],
  };

  visit(tree, (node) => {
    const line = node.position?.start?.line ?? 1;
    switch (node.type) {
      case 'heading': {
        const label = textOf(node);
        doc.headings.push({ text: label, depth: node.depth, line });
        doc.anchors.add(slugger.slug(label));
        break;
      }
      case 'link':
      case 'definition':
        doc.links.push({ url: node.url ?? '', line, text: textOf(node) });
        break;
      case 'image':
        doc.links.push({ url: node.url ?? '', line, text: node.alt ?? '', image: true });
        break;
      case 'code':
        doc.codeBlocks.push({
          lang: (node.lang ?? '').toLowerCase(),
          meta: node.meta ?? '',
          value: node.value ?? '',
          line,
        });
        break;
      case 'inlineCode':
        doc.inlineCode.push({ value: node.value ?? '', line });
        break;
      case 'html': {
        // pick up <a name="..."> / id="..." anchors and href/src links in raw HTML
        const raw = node.value ?? '';
        for (const m of raw.matchAll(/(?:name|id)\s*=\s*["']([^"']+)["']/g)) {
          doc.anchors.add(m[1]);
        }
        for (const m of raw.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
          doc.links.push({ url: m[1], line, text: '', html: true });
        }
        break;
      }
    }
  });

  return doc;
}

function visit(node, fn) {
  fn(node);
  if (node.children) for (const child of node.children) visit(child, fn);
}

function textOf(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (!node.children) return '';
  return node.children.map(textOf).join('');
}
