import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3100),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:5100'),

  DATABASE_URL: Joi.string().required(),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_USERNAME: Joi.string().allow('').default(''),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_TLS: Joi.boolean().default(false),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('300m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  SEED_ADMIN_NAME: Joi.string().default('Administrator'),
  // tlds disabled: local/internal domains like "lms.local" are expected here
  // and aren't in Joi's public-TLD list, which would otherwise reject them
  SEED_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .default('admin@lms.local'),
  SEED_ADMIN_USERNAME: Joi.string().default('admin'),
  // no default: an initial admin password must never silently fall back to
  // a well-known value that ends up sitting in a public repo's source code
  SEED_ADMIN_PASSWORD: Joi.string().min(6).required(),

  STORAGE_ENDPOINT: Joi.string().uri().required(),
  STORAGE_REGION: Joi.string().default('auto'),
  STORAGE_BUCKET: Joi.string().required(),
  STORAGE_ACCESS_KEY_ID: Joi.string().required(),
  STORAGE_SECRET_ACCESS_KEY: Joi.string().required(),
  STORAGE_FORCE_PATH_STYLE: Joi.boolean().default(true),
  STORAGE_PUBLIC_URL: Joi.string().uri().required(),
  STORAGE_PRESIGN_EXPIRES_SEC: Joi.number().default(900),

  UPLOADS_DIR: Joi.string().default('uploads'),
});
