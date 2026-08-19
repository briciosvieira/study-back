const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

// Parses short duration strings used in JWT expiresIn config (e.g. "15m", "7d")
// into milliseconds, so the refresh cookie's maxAge always matches the token's TTL.
export function parseDurationToMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration: "${value}". Use formats like "15m", "7d".`,
    );
  }
  const [, amount, unit] = match;
  return parseInt(amount, 10) * UNIT_TO_MS[unit];
}
