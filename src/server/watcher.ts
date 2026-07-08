import chokidar, { type FSWatcher } from 'chokidar';

export function watchVaults(
  vaults: { id: string; path: string }[],
  onChange: (vaultId: string) => void,
  debounceMs = 500,
): FSWatcher[] {
  return vaults.map((v) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = chokidar.watch(v.path, {
      ignored: /(^|[/\\])\./,
      ignoreInitial: true,
      depth: 12,
    });
    watcher.on('all', (_event, p) => {
      if (!p.endsWith('.md')) return;
      clearTimeout(timer);
      timer = setTimeout(() => onChange(v.id), debounceMs);
    });
    return watcher;
  });
}
