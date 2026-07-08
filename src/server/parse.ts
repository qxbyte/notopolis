import matter from 'gray-matter';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  wordCount: number;
  openTasks: number;
  linkTargets: string[];
  excerpt: string;
}

export function parseNote(raw: string): ParsedNote {
  const { data, content } = matter(raw);
  const body = content.replace(/```[\s\S]*?```/g, '');
  const linkTargets = [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  );
  const openTasks = (body.match(/^\s*[-*]\s\[ \]/gm) ?? []).length;
  const cjk = (body.match(/[一-鿿]/g) ?? []).length;
  const latinWords = (body.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  const desc = typeof data.description === 'string' ? data.description : undefined;
  const firstPara =
    body
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#')) ?? '';
  return {
    frontmatter: data,
    wordCount: cjk + latinWords,
    openTasks,
    linkTargets,
    excerpt: (desc ?? firstPara).slice(0, 120),
  };
}
