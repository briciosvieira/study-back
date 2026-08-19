import { BadRequestException } from '@nestjs/common';

const ORDER_LABEL_REGEX = /^\d+(\.\d+)?$/;

// orderLabel is dewey-decimal style (e.g. "1", "1.1", "2"), not an arbitrary
// number: "1.10" and "1.1" would collide into the same orderNum (1.1), so the
// format is restricted to a single sub-level to avoid reintroducing that ambiguity.
export function parseOrderLabel(orderLabel: string): number {
  if (!ORDER_LABEL_REGEX.test(orderLabel)) {
    throw new BadRequestException(
      `Invalid orderLabel: "${orderLabel}". Use the format "1", "1.1", "2"...`,
    );
  }
  return parseFloat(orderLabel);
}
