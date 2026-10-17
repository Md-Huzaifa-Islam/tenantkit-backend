import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from '../config/env';
import { StorageProvider } from './storage.provider';

export class LocalStorageProvider extends StorageProvider {
  private readonly root: string;

  constructor(private readonly env: Env) {
    super();
    this.root = resolve(env.UPLOAD_DIR);
  }

  async put(key: string, body: Buffer): Promise<string> {
    const path = join(this.root, key);
    if (!path.startsWith(this.root)) throw new Error('Invalid storage key');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return `${this.env.PUBLIC_UPLOAD_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
}
