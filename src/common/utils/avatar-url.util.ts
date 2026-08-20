// The DB only ever holds the opaque storage key — this turns it into a
// displayable URL at the response boundary, the same way PdfItem/VideoItem
// already expose fileUrl instead of a raw key.
export function buildAvatarUrl(
  avatarStorageKey: string | null,
  publicUrl: string,
): string | null {
  return avatarStorageKey ? `${publicUrl}/${avatarStorageKey}` : null;
}
