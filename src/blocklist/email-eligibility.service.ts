import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { maskEmail, normalizeEmail } from '../common/utils/normalize-email.util';
import { PrismaService } from '../prisma/prisma.service';

export interface ListBlocklistQuery {
  page?: number;
  limit?: number;
  includeRemoved?: boolean;
}

// The single place in the app that hashes/checks/adds emails against the
// deletion blocklist — every entry point that can introduce or change an
// email (create user, self profile update, admin update) must call
// assertEligible before persisting.
@Injectable()
export class EmailEligibilityService {
  private readonly hmacKey: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
    private readonly auditService: AuditService,
  ) {
    this.hmacKey = configService.get<string>('emailBlocklist.hmacKey')!;
  }

  hashEmail(email: string): string {
    return createHmac('sha256', this.hmacKey).update(normalizeEmail(email)).digest('hex');
  }

  async isBlocked(email: string): Promise<boolean> {
    const entry = await this.prisma.emailBlocklist.findUnique({
      where: { emailHash: this.hashEmail(email) },
    });
    return !!entry && entry.removedAt === null;
  }

  // Throws a generic, non-revealing error — callers surface it as a plain
  // validation failure, never "this email was previously deleted".
  async assertEligible(email: string): Promise<void> {
    if (await this.isBlocked(email)) {
      throw new ConflictException('This email address is not available');
    }
  }

  // Idempotent: re-blocking an email that's already actively blocked just
  // updates the reason, never creates a duplicate row (emailHash is unique).
  async addToBlocklist(email: string, reason: string): Promise<void> {
    const emailHash = this.hashEmail(email);
    const normalized = normalizeEmail(email);
    await this.prisma.emailBlocklist.upsert({
      where: { emailHash },
      update: { removedAt: null, removedById: null, reason },
      create: { emailHash, maskedEmail: maskEmail(normalized), reason },
    });
  }

  async list(query: ListBlocklistQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = query.includeRemoved ? {} : { removedAt: null };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.emailBlocklist.count({ where }),
      this.prisma.emailBlocklist.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total, page, limit };
  }

  async remove(id: string, adminId: string, adminName: string): Promise<void> {
    const entry = await this.prisma.emailBlocklist.update({
      where: { id },
      data: { removedAt: new Date(), removedById: adminId },
    });

    await this.auditService.record({
      eventType: 'EMAIL_BLOCKLIST_REMOVED',
      category: 'BLOCKLIST',
      severity: 'INFO',
      actorUserId: adminId,
      actorName: adminName,
      targetEmailMasked: entry.maskedEmail,
      resourceType: 'EMAIL_BLOCKLIST',
      resourceId: entry.id,
    });
  }
}
