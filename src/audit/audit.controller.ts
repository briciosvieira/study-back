import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ParseUuidPipe } from '../common/pipes/parse-uuid.pipe';
import { assertAuditPermission, assertNotificationAccess } from './audit-access.util';
import { AuditExportService } from './audit-export.service';
import { AuditNotificationService } from './audit-notification.service';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';
import { QueryAuditEventsDto } from './dto/query-audit-events.dto';
import { QueryIncidentsDto } from './dto/query-incidents.dto';

const MAX_EXPORT_ROWS = 5000;

// Everything lives on this one controller — a single "Auditoria e
// Segurança" screen with filters, not separate pages per concern.
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditQueryService: AuditQueryService,
    private readonly auditExportService: AuditExportService,
    private readonly auditNotificationService: AuditNotificationService,
    private readonly auditService: AuditService,
  ) {}

  @Get('events')
  listEvents(@Query() query: QueryAuditEventsDto, @CurrentUser() user: AuthenticatedUser) {
    assertAuditPermission(user, Permission.VIEW_AUDIT_LOGS);
    return this.auditQueryService.listEvents(query);
  }

  @Get('events/:id')
  getEvent(@Param('id', ParseUuidPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    assertAuditPermission(user, Permission.VIEW_AUDIT_LOGS);
    return this.auditQueryService.getEvent(id);
  }

  @Get('incidents')
  listIncidents(@Query() query: QueryIncidentsDto, @CurrentUser() user: AuthenticatedUser) {
    assertAuditPermission(user, Permission.VIEW_AUDIT_LOGS);
    return this.auditQueryService.listIncidents(query);
  }

  @Get('notifications/unread-count')
  getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    assertNotificationAccess(user);
    return this.auditNotificationService.getUnreadCount(user.id).then((count) => ({ count }));
  }

  @Get('notifications')
  listNotifications(@CurrentUser() user: AuthenticatedUser) {
    assertNotificationAccess(user);
    return this.auditNotificationService.list(user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('notifications/read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    assertNotificationAccess(user);
    return this.auditNotificationService.markAllRead(user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('notifications/:incidentId/read')
  markRead(
    @Param('incidentId', ParseUuidPipe) incidentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertNotificationAccess(user);
    return this.auditNotificationService.markRead(user.id, incidentId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('notifications/:incidentId/dismiss-popup')
  dismissPopup(
    @Param('incidentId', ParseUuidPipe) incidentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertNotificationAccess(user);
    return this.auditNotificationService.dismissPopup(user.id, incidentId);
  }

  @Get('export')
  async exportPdf(
    @Query() query: QueryAuditEventsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    assertAuditPermission(user, Permission.VIEW_AUDIT_LOGS);
    assertAuditPermission(user, Permission.EXPORT_AUDIT_LOGS);

    const events = await this.auditQueryService.listAllEventsForExport(query, MAX_EXPORT_ROWS);

    const filtersDescription = this.describeFilters(query);
    const periodDescription =
      query.dateFrom || query.dateTo
        ? `${query.dateFrom ?? '…'} – ${query.dateTo ?? '…'}`
        : 'Todos os registros disponíveis';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="studyja-auditoria-${new Date().toISOString().slice(0, 10)}.pdf"`,
    );

    const stream = this.auditExportService.generatePdf(events, {
      generatedByName: user.name,
      filtersDescription,
      periodDescription,
    });
    stream.pipe(res);

    await this.auditService.record({
      eventType: 'AUDIT_LOG_EXPORTED',
      category: 'SYSTEM',
      severity: 'INFO',
      actorUserId: user.id,
      actorName: user.name,
      metadata: { filters: filtersDescription, period: periodDescription, rowCount: events.length },
    });
  }

  private describeFilters(query: QueryAuditEventsDto): string {
    const parts: string[] = [];
    if (query.category) parts.push(`Categoria: ${query.category}`);
    if (query.severity) parts.push(`Severidade: ${query.severity}`);
    if (query.eventType) parts.push(`Evento: ${query.eventType}`);
    if (query.actorUserId) parts.push(`Actor: ${query.actorUserId}`);
    if (query.targetUserId) parts.push(`Target: ${query.targetUserId}`);
    if (query.method) parts.push(`Método: ${query.method}`);
    if (query.httpStatus !== undefined) parts.push(`Status: ${query.httpStatus}`);
    if (query.ipAddress) parts.push(`IP: ${query.ipAddress}`);
    if (query.requestId) parts.push(`Request ID: ${query.requestId}`);
    if (query.search) parts.push(`Busca: "${query.search}"`);
    return parts.length ? parts.join(' | ') : 'Nenhum filtro aplicado';
  }
}
