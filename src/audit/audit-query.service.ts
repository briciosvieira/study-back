import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditEventsDto } from './dto/query-audit-events.dto';
import { QueryIncidentsDto } from './dto/query-incidents.dto';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(query: QueryAuditEventsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = this.buildEventsWhere(query);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total, page, limit };
  }

  // Shared by the list endpoint and the PDF export, so the export always
  // reflects exactly what the on-screen filters were showing.
  async listAllEventsForExport(query: QueryAuditEventsDto, maxRows: number) {
    const where = this.buildEventsWhere(query);
    return this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: maxRows,
    });
  }

  async getEvent(id: string) {
    const event = await this.prisma.auditEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException('Audit event not found');
    }
    return event;
  }

  async listIncidents(query: QueryIncidentsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: Prisma.SecurityIncidentWhereInput = query.severity
      ? { severity: query.severity }
      : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.securityIncident.count({ where }),
      this.prisma.securityIncident.findMany({
        where,
        orderBy: { lastOccurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total, page, limit };
  }

  private buildEventsWhere(query: QueryAuditEventsDto): Prisma.AuditEventWhereInput {
    const where: Prisma.AuditEventWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.severity) where.severity = query.severity;
    if (query.eventType) where.eventType = query.eventType;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.targetUserId) where.targetUserId = query.targetUserId;
    if (query.method) where.method = query.method;
    if (query.httpStatus !== undefined) where.httpStatus = query.httpStatus;
    if (query.ipAddress) where.ipAddress = query.ipAddress;
    if (query.requestId) where.requestId = query.requestId;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { actorName: { contains: search, mode: 'insensitive' } },
        { targetName: { contains: search, mode: 'insensitive' } },
        { eventType: { contains: search, mode: 'insensitive' } },
        { resourceId: { contains: search, mode: 'insensitive' } },
        { route: { contains: search, mode: 'insensitive' } },
        { requestId: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
