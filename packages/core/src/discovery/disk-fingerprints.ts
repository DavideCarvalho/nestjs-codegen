import { readFileSync, statSync } from 'node:fs';

/**
 * Tells which of the files a long-lived ts-morph Project read from disk no longer
 * match the disk.
 *
 * A file is compared by content the first time it is checked, and from then on by
 * its stat: an unchanged mtime and size skip the read, so checking a few thousand
 * declaration files per watch pass costs stat calls, not reads. A changed stat
 * falls back to the content, so touching a file without editing it is not a change.
 */
export class DiskFingerprints {
  private readonly stats = new Map<string, string>();

  /** The paths whose disk content differs from `text`, or that no longer exist. */
  changed(files: Iterable<{ path: string; text: string }>): string[] {
    const changed: string[] = [];
    for (const { path, text } of files) {
      let key: string;
      try {
        const stat = statSync(path);
        key = `${stat.mtimeMs}:${stat.size}`;
      } catch {
        this.stats.delete(path);
        changed.push(path);
        continue;
      }
      if (this.stats.get(path) === key) continue;
      let disk: string | undefined;
      try {
        disk = readFileSync(path, 'utf-8');
      } catch {
        disk = undefined;
      }
      if (disk === text) {
        this.stats.set(path, key);
      } else {
        this.stats.delete(path);
        changed.push(path);
      }
    }
    return changed;
  }

  /** Forget `path`, so its next check compares content again. */
  forget(path: string): void {
    this.stats.delete(path);
  }
}
