import type { Request } from 'express';

// Only trusts CF-Connecting-IP because app.set('trust proxy', 1) in main.ts
// means req.ip already resolves safely from the single trusted reverse-proxy
// hop (nginx) in front of this process — this is not "trust any header a
// client sends", it's "prefer Cloudflare's own header when present, since
// nginx forwards it unmodified, and fall back to the already-trusted req.ip".
export function getClientIp(req: Request): string | null {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();
  return req.ip ?? null;
}

export function getRequestId(req: Request): string | undefined {
  return (req as Request & { requestId?: string }).requestId;
}
