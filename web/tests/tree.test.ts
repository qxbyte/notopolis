import { describe, expect, it } from 'vitest';
import { buildTree, renderTree } from '../src/util/tree';

function leaf(notePath: string) {
  return { notePath, data: { notePath } };
}

describe('buildTree', () => {
  it('按目录嵌套，count 累计', () => {
    const t = buildTree([
      leaf('A/x.md'),
      leaf('A/y.md'),
      leaf('B/C/z.md'),
    ]);
    expect(t.count).toBe(3);
    const names = t.folders.map((f) => f.name).sort();
    expect(names).toEqual(['A', 'B/C']); // B/C 链合并
    const a = t.folders.find((f) => f.name === 'A')!;
    expect(a.count).toBe(2);
    expect(a.leaves.map((l) => l.name).sort()).toEqual(['x', 'y']);
  });

  it('单链目录合并为一行（A/B/C）', () => {
    const t = buildTree([leaf('Spec/Plugin/task/note.md')]);
    expect(t.folders).toHaveLength(1);
    expect(t.folders[0].name).toBe('Spec/Plugin/task');
    expect(t.folders[0].leaves[0].name).toBe('note');
  });

  it('folders 按 count 降序', () => {
    const t = buildTree([
      leaf('Small/a.md'),
      leaf('Big/a.md'),
      leaf('Big/b.md'),
      leaf('Big/c.md'),
    ]);
    expect(t.folders[0].name).toBe('Big');
    expect(t.folders[0].count).toBe(3);
  });

  it('根目录笔记作为顶层叶子', () => {
    const t = buildTree([leaf('readme.md')]);
    expect(t.folders).toHaveLength(0);
    expect(t.leaves.map((l) => l.name)).toEqual(['readme']);
  });
});

describe('renderTree', () => {
  it('生成 tree-folder / tree-children / 叶子行', () => {
    const t = buildTree([leaf('A/x.md')]);
    const html = renderTree(t, (lf, depth) => `<i data-p="${lf.notePath}" data-d="${depth}">${lf.name}</i>`);
    expect(html).toContain('class="tree-folder"');
    expect(html).toContain('class="tree-folder-head"');
    expect(html).toContain('class="tree-children"');
    expect(html).toContain('data-p="A/x.md"');
    expect(html).toContain('data-d="1"'); // 叶子在 depth 1
  });
});
