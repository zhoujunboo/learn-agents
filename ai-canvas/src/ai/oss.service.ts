import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface OssUploadSignature {
  host: string;
  key: string;
  url: string;
  OSSAccessKeyId: string;
  policy: string;
  Signature: string;
  expire: string;
}

@Injectable()
export class OssService {
  private readonly logger = new Logger(OssService.name);
  private readonly client: OSS;
  private readonly postClient: OSS;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.trimEnv('OSS_BUCKET');
    this.region = this.trimEnv('OSS_REGION');
    const accessKeyId = this.trimEnv('OSS_ACCESS_KEY_ID');
    const accessKeySecret = this.trimEnv('OSS_ACCESS_KEY_SECRET');

    // 原始 OSS SDK
    this.client = new OSS({
      region: this.region,
      accessKeyId,
      accessKeySecret,
      authorizationV4: true,
      bucket: this.bucket,
    });

    // 创建后 OSS SDK
    this.postClient = new OSS({
      region: this.region,
      accessKeyId,
      accessKeySecret,
      bucket: this.bucket,
    });
  }

  createUploadPolicy(ext = '.jpg'): OssUploadSignature {
    const prefix = this.config.get<string>(
      'OSS_UPLOAD_PREFIX',
      'ai-canvas/uploads',
    );
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    const key = `${prefix}/${Date.now()}-${randomUUID()}${normalizedExt}`;

    const expire = new Date();
    expire.setHours(expire.getHours() + 1);

    const policy = {
      expiration: expire.toISOString(),
      conditions: [
        ['content-length-range', 0, 1048576000],
        ['eq', '$key', key],
      ],
    };

    try {
      const signature = this.postClient.calculatePostSignature(policy);
      const host = `https://${this.bucket}.${this.region}.aliyuncs.com`;

      return {
        host,
        key,
        url: `${host}/${key}`,
        OSSAccessKeyId: signature.OSSAccessKeyId,
        policy: signature.policy,
        Signature: signature.Signature,
        expire: expire.toISOString(),
      };
    } catch (error) {
      throw this.wrapOssError(error, 'create upload signature');
    }
  }

  resolveReadableUrl(imageUrl: string): string {
    const host = `${this.bucket}.${this.region}.aliyuncs.com`;
    if (!imageUrl.includes(host)) {
      return imageUrl;
    }

    const objectKey = decodeURIComponent(new URL(imageUrl).pathname.slice(1));
    return this.getSignedUrl(objectKey);
  }

  async uploadBuffer(
    buffer: Buffer,
    prefix: string,
    filename: string,
  ): Promise<{ url: string; objectKey: string }> {
    const ext = extname(filename) || '.png';
    const objectKey = `${prefix}/${Date.now()}-${randomUUID()}${ext}`;

    try {
      const result = await this.client.put(objectKey, buffer);
      return { url: result.url, objectKey };
    } catch (error) {
      throw this.wrapOssError(error, 'upload to OSS');
    }
  }

  getSignedUrl(objectKey: string, expires = 3600): string {
    return this.client.signatureUrl(objectKey, { expires });
  }

  async uploadFromUrl(sourceUrl: string): Promise<string> {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch generated image: ${response.status}`,
      );
    }

    const prefix = this.config.get<string>('OSS_PREFIX', 'ai-canvas/edited');
    const buffer = Buffer.from(await response.arrayBuffer());
    const { url } = await this.uploadBuffer(buffer, prefix, 'result.png');

    return url;
  }

  private trimEnv(key: string): string {
    return this.config.getOrThrow<string>(key).trim();
  }

  private wrapOssError(error: unknown, action: string): Error {
    const ossError = error as {
      code?: string;
      message?: string;
      status?: number;
    };

    this.logger.error(
      `OSS ${action} failed: ${ossError.code ?? 'UnknownError'} - ${ossError.message ?? error}`,
    );

    if (ossError.code === 'InvalidAccessKeyId') {
      return new InternalServerErrorException(
        'OSS AccessKeyId 无效，请检查 .env 中的 OSS_ACCESS_KEY_ID 是否为当前阿里云账号下有效的 RAM 密钥',
      );
    }

    if (ossError.code === 'SignatureDoesNotMatch') {
      return new InternalServerErrorException(
        'OSS AccessKeySecret 不正确，请检查 .env 中的 OSS_ACCESS_KEY_SECRET',
      );
    }

    if (ossError.code === 'NoSuchBucket') {
      return new InternalServerErrorException(
        'OSS Bucket 不存在，请检查 OSS_BUCKET 和 OSS_REGION 是否匹配',
      );
    }

    return new InternalServerErrorException(
      `OSS ${action} failed: ${ossError.message ?? 'unknown error'}`,
    );
  }
}
