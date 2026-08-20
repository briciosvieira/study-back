// Defense in depth: even if a forbidden field somehow reaches metadata, it
// never gets persisted or exported. Matched case-insensitively against key
// names, not values, since secrets are identified by where they live in the
// payload, not by pattern-matching their content.
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'temporarypassword',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'jwt',
  'secret',
  'accesskeyid',
  'secretaccesskey',
  'presignedurl',
  'uploadurl',
]);

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 20;
const MAX_DEPTH = 4;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
      result[key] = sanitizeMetadata(val, depth + 1);
    }
    return result;
  }

  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}…`;
  }

  return value;
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

// Strips query strings entirely (may carry tokens/signatures) and replaces
// UUID path segments with :id so /users/<uuid> and /users/<uuid2> count as
// the same route for incident detection instead of two unrelated ones.
const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function normalizeRoute(path: string): string {
  const withoutQuery = path.split('?')[0];
  return withoutQuery.replace(UUID_SEGMENT, ':id');
}
