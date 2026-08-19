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

// Next whole-number label after whatever's already in the list — upload
// forms don't ask the instructor to type an order, they just append; reorder
// (which can still use "1.1"-style sub-levels) is a separate, explicit step.
export function nextOrderLabel(maxOrderNum: number | null): string {
  return String(Math.floor(maxOrderNum ?? 0) + 1);
}
