import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NoteMeta, ScanResult } from '../shared/types.js';
import { parseNote } from './parse.js';

const IGNORED = new Set(['node_modules']);

export async function scanVault(root: string): Promise<ScanResult> {
  const notes: NoteMeta[] = [];
  const errors: ScanResult['errors'] = [];

  async function walk(abs: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (e) {
      errors.push({ path: rel || '.', reason: (e as Error).message });
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || IGNORED.has(ent.name)) continue;
      const absChild = path.join(abs, ent.name);
      const relChild = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        await walk(absChild, relChild);
        continue;
      }
      if (!ent.name.endsWith('.md')) continue;
      try {
        const [raw, st] = await Promise.all([readFile(absChild, 'utf8'), stat(absChild)]);
        const parsed = parseNote(raw);
        notes.push({
          path: relChild,
          title: ent.name.replace(/\.md$/, ''),
          dir: relChild.includes('/') ? relChild.split('/')[0] : '',
          wordCount: parsed.wordCount,
          openTasks: parsed.openTasks,
          links: parsed.linkTargets,
          frontmatter: parsed.frontmatter,
          excerpt: parsed.excerpt,
          mtimeMs: st.mtimeMs,
          birthtimeMs: st.birthtimeMs,
        });
      } catch (e) {
        errors.push({ path: relChild, reason: (e as Error).message });
      }
    }
  }

  await walk(root, '');
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return { notes, errors };
}
