import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditCategory, AuditEventType, AuditSeverity } from './audit.constants';
import { sanitizeMetadata, truncate } from './sanitize-metadata.util';

export interface RecordAuditEventInput {
  eventType: AuditEventType;
  category: AuditCategory;
  severity: AuditSeverity;
  actorUserId?: string | null;
  actorName?: string | null;
  targetUserId?: string | null;
  targetName?: string | null;
  targetEmailMasked?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  method?: string | null;
  route?: string | null;
  httpStatus?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const MAX_USER_AGENT_LENGTH = 300;

// The single write path for AuditEvent — nothing else in the app touches
// that table directly. Append-only by construction: there is no update/
// delete method here, matching the "logs can never be edited or deleted"
// requirement at the code level, not just by convention.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          eventType: input.eventType,
          category: input.category,
          severity: input.severity,
          actorUserId: input.actorUserId ?? null,
          actorName: input.actorName ?? null,
          targetUserId: input.targetUserId ?? null,
          targetName: input.targetName ?? null,
          targetEmailMasked: input.targetEmailMasked ?? null,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          method: input.method ?? null,
          route: input.route ?? null,
          httpStatus: input.httpStatus ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ? truncate(input.userAgent, MAX_USER_AGENT_LENGTH) : null,
          requestId: input.requestId ?? null,
          metadata: input.metadata
            ? (sanitizeMetadata(input.metadata) as object)
            : undefined,
        },
      });
    } catch (error) {
      // Audit logging must never break the request it's observing — a
      // failure here is itself an operational problem, logged and swallowed.
      this.logger.error('Failed to record audit event', error as Error);
    }
  }
}
