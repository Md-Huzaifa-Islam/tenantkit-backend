/** Object storage for uploaded files. Implementations: local disk (dev) and S3-compatible. */
export abstract class StorageProvider {
  /** Stores the object and returns its public URL. */
  abstract put(key: string, body: Buffer, contentType: string): Promise<string>;
}
