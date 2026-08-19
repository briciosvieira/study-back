import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PresignedUpload, StorageProvider } from './storage.provider.interface';

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

@Injectable()
export class StorageService implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly presignExpiresSec: number;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.get<string>('storage.bucket')!;
    this.publicUrl = this.configService.get<string>('storage.publicUrl')!;
    this.presignExpiresSec = this.configService.get<number>(
      'storage.presignExpiresSec',
    )!;

    this.client = new S3Client({
      endpoint: this.configService.get<string>('storage.endpoint'),
      region: this.configService.get<string>('storage.region'),
      forcePathStyle: this.configService.get<boolean>('storage.forcePathStyle'),
      credentials: {
        accessKeyId: this.configService.get<string>('storage.accessKeyId')!,
        secretAccessKey: this.configService.get<string>(
          'storage.secretAccessKey',
        )!,
      },
    });
  }

  async presignUpload(params: {
    keyPrefix: string;
    fileName: string;
    contentType: string;
  }): Promise<PresignedUpload> {
    const key = `${params.keyPrefix}/${randomUUID()}-${sanitizeFileName(params.fileName)}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.presignExpiresSec,
    });

    return { uploadUrl, key, publicUrl: this.getPublicUrl(key) };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }
}
