import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdaptiveStartupCheckpointBinding, AdaptiveStartupCheckpointStore } from '../../src/features/meta-search/domain/adaptiveSearchCheckpoint';

/** Local private storage only. No connector, credentials, URL or network client is accepted. */
export function adaptiveStartupFileCheckpoint(directory: string, binding: AdaptiveStartupCheckpointBinding): AdaptiveStartupCheckpointStore {
  const key = createHash('sha256').update(JSON.stringify([binding.profile_id.toLowerCase(), binding.scope.project_ref,
    binding.scope.search_id.toLowerCase(), binding.scope.run_id.toLowerCase()])).digest('hex');
  const path = join(directory, `${key}.json`);
  const secureDirectory = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('Checkpoint directory must already be private.');
  };
  const read = async () => {
    await secureDirectory();
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.mode & 0o077 || stat.size > 1024 * 1024) throw new Error('Checkpoint file is unsafe.');
      return await handle.readFile('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally { await handle?.close(); }
  };
  const write = async (value: string) => {
    await secureDirectory();
    if (Buffer.byteLength(value) > 1024 * 1024) throw new Error('Checkpoint file is oversized.');
    try {
      const existing = await lstat(path);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.mode & 0o077) throw new Error('Checkpoint file is unsafe.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = join(directory, `.${key}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(value, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporary, path);
      const parent = await open(directory, constants.O_RDONLY);
      try { await parent.sync(); } finally { await parent.close(); }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(() => undefined);
    }
  };
  const withLock = async <T>(action: () => Promise<T>): Promise<T> => {
    await secureDirectory();
    // An interrupted holder leaves this lock behind. Fail closed; never infer stale-lock ownership.
    const lockPath = join(directory, `${key}.lock`);
    const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      return await action();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  };
  return {
    read: () => withLock(read),
    compareAndSwap: (expected, replacement) => withLock(async () => {
      if (await read() !== expected) return false;
      await write(replacement);
      return true;
    }),
  };
}
