import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env';
import { StorageProvider } from './storage.provider';

/** Works with AWS S3 and S3-compatible services (MinIO, Cloudflare R2) via S3_ENDPOINT. */
export class S3StorageProvider extends StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly env: Env) {
    super();
    this.client = new S3Client({
      region: env.S3_REGION ?? 'us-east-1',
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
    const base = this.env.S3_PUBLIC_URL ?? `https://${this.env.S3_BUCKET}.s3.amazonaws.com`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}
