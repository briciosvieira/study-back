import type { StringValue } from 'ms';

export interface AppConfig {
  env: string;
  port: number;
  frontendUrl: string;
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    tls: boolean;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: StringValue;
    refreshSecret: string;
    refreshExpiresIn: StringValue;
  };
  seedAdmin: {
    name: string;
    email: string;
    username: string;
    password: string;
  };
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    publicUrl: string;
    presignExpiresSec: number;
  };
  uploads: {
    // absolute or cwd-relative path to the local uploads root — point this at
    // a mounted volume in production/Docker so files survive redeploys
    dir: string;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3100', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5100',
  database: {
    url: process.env.DATABASE_URL as string,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: (process.env.REDIS_TLS ?? 'false') === 'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ??
      '15m') as StringValue,
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
      '7d') as StringValue,
  },
  seedAdmin: {
    name: process.env.SEED_ADMIN_NAME ?? 'Administrator',
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@lms.local',
    username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
    password: process.env.SEED_ADMIN_PASSWORD as string,
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT as string,
    region: process.env.STORAGE_REGION ?? 'auto',
    bucket: process.env.STORAGE_BUCKET as string,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY as string,
    forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
    publicUrl: process.env.STORAGE_PUBLIC_URL as string,
    presignExpiresSec: parseInt(
      process.env.STORAGE_PRESIGN_EXPIRES_SEC ?? '900',
      10,
    ),
  },
  uploads: {
    dir: process.env.UPLOADS_DIR ?? 'uploads',
  },
});
