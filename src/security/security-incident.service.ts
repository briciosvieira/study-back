import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { AuditSeverity } from '../audit/audit.constants';
import { RedisService } from '../common/redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

export interface TrackFailureInput {
  // e.g. REPEATED_INVALID_PASSWORD, REPEATED_FORBIDDEN_ACCESS,
  // REPEATED_RATE_LIMIT, REPEATED_SERVER_ERROR
  type: string;
  // counter/dedupe key component — userId when known, otherwise ip
  key: string;
  userId?: string | null;
  ipAddress?: string | null;
  route?: string | null;
  method?: string | null;
}

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  HIGH: 2,
  CRITICAL: 3,
};

// Aggregates repeated failures into a single, deduplicated SecurityIncident
// row instead of one row per occurrence — Redis counters (with graceful
// degradation if Redis is down) decide *when* a burst crosses a threshold,
// Postgres holds the aggregated, queryable incident itself.
@Injectable()
export class SecurityIncidentService {
  private readonly logger = new Logger(SecurityIncidentService.name);
  private readonly warningAttempts: number;
  private readonly highAttempts: number;
  private readonly criticalAttempts: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    configService: ConfigService,
  ) {
    this.warningAttempts = configService.get<number>('security.warningAttempts')!;
    this.highAttempts = configService.get<number>('security.highAttempts')!;
    this.criticalAttempts = configService.get<number>('security.criticalAttempts')!;
    this.windowSeconds = configService.get<number>('security.incidentWindowSeconds')!;
  }

  async trackFailure(input: TrackFailureInput): Promise<void> {
    const count = await this.incrementCounter(input.type, input.key);
    const severity = this.severityForCount(count);
    if (!severity) return; // below the lowest threshold — just an isolated event, no incident

    await this.upsertIncident({ ...input, severity, occurrenceCount: count });
  }

  private async incrementCounter(type: string, key: string): Promise<number> {
    const redisKey = `security:${type}:${key}`;
    try {
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) {
        await this.redis.client.expire(redisKey, this.windowSeconds);
      }
      return count;
    } catch (error) {
      this.logger.warn(`Redis unavailable for security counters, degrading: ${(error as Error).message}`);
      return 1; // never below the lowest threshold on its own — avoids false incidents while Redis is down
    }
  }

  private severityForCount(count: number): AuditSeverity | null {
    if (count >= this.criticalAttempts) return 'CRITICAL';
    if (count >= this.highAttempts) return 'HIGH';
    if (count >= this.warningAttempts) return 'WARNING';
    return null;
  }

  private async upsertIncident(input: {
    type: string;
    severity: AuditSeverity;
    userId?: string | null;
    ipAddress?: string | null;
    route?: string | null;
    method?: string | null;
    occurrenceCount: number;
  }): Promise<void> {
    const windowStart = new Date(Date.now() - this.windowSeconds * 1000);

    const existing = await this.prisma.securityIncident.findFirst({
      where: {
        type: input.type,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        route: input.route ?? null,
        lastOccurredAt: { gte: windowStart },
      },
      orderBy: { lastOccurredAt: 'desc' },
    });

    let incident;
    if (existing) {
      const escalated =
        SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity as AuditSeverity]
          ? input.severity
          : (existing.severity as AuditSeverity);
      incident = await this.prisma.securityIncident.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: input.occurrenceCount,
          lastOccurredAt: new Date(),
          severity: escalated,
        },
      });
    } else {
      incident = await this.prisma.securityIncident.create({
        data: {
          type: input.type,
          severity: input.severity,
          userId: input.userId ?? null,
          ipAddress: input.ipAddress ?? null,
          route: input.route ?? null,
          method: input.method ?? null,
          occurrenceCount: input.occurrenceCount,
          firstOccurredAt: new Date(),
          lastOccurredAt: new Date(),
        },
      });
    }

    // The bell only ever turns red for HIGH/CRITICAL — a WARNING-level
    // incident is visible in the audit table but never pings anyone.
    if (incident.severity === 'HIGH' || incident.severity === 'CRITICAL') {
      await this.notifyEligibleUsers(incident.id);
    }
  }

  private async notifyEligibleUsers(incidentId: string): Promise<void> {
    const eligible = await this.prisma.user.findMany({
      where: {
        active: true,
        OR: [{ role: Role.ADMIN }, { permissions: { has: 'VIEW_AUDIT_LOGS' } }],
      },
      select: { id: true },
    });
    if (!eligible.length) return;
    await this.prisma.auditNotification.createMany({
      data: eligible.map((user) => ({ userId: user.id, incidentId })),
      skipDuplicates: true,
    });
  }

  // Distinct from trackFailure()'s repeated-failure aggregation: a policy
  // reactivation request is always relevant on its own (PolicyService only
  // calls this once per actual new request — it's already idempotent at the
  // acceptance-row level), and it's notified to a different audience
  // (MANAGE_POLICY_REACTIVATION holders, not VIEW_AUDIT_LOGS ones). WARNING
  // severity per the review-hold spec — it must never make the bell flash
  // red for a routine request.
  async recordReactivationRequested(targetUserId: string): Promise<void> {
    const incident = await this.prisma.securityIncident.create({
      data: {
        type: 'POLICY_REACTIVATION_REQUESTED',
        severity: 'WARNING',
        userId: targetUserId,
        occurrenceCount: 1,
        firstOccurredAt: new Date(),
        lastOccurredAt: new Date(),
      },
    });

    const eligible = await this.prisma.user.findMany({
      where: {
        active: true,
        OR: [{ role: Role.ADMIN }, { permissions: { has: 'MANAGE_POLICY_REACTIVATION' } }],
      },
      select: { id: true },
    });
    if (!eligible.length) return;
    await this.prisma.auditNotification.createMany({
      data: eligible.map((user) => ({ userId: user.id, incidentId: incident.id })),
      skipDuplicates: true,
    });
  }
}
