import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const NOTIFICATION_LIST_LIMIT = 50;

// Per-viewer read/dismiss state — see AuditNotification's unique
// [userId, incidentId] constraint. Closing a popup and "reading" a
// notification are deliberately different fields: dismissing a toast just
// stops it from reappearing immediately, it doesn't clear the unread badge.
@Injectable()
export class AuditNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  getUnreadCount(userId: string): Promise<number> {
    return this.prisma.auditNotification.count({ where: { userId, readAt: null } });
  }

  list(userId: string) {
    return this.prisma.auditNotification.findMany({
      where: { userId },
      include: { incident: true },
      orderBy: { createdAt: 'desc' },
      take: NOTIFICATION_LIST_LIMIT,
    });
  }

  async markRead(userId: string, incidentId: string): Promise<{ read: true }> {
    await this.prisma.auditNotification.updateMany({
      where: { userId, incidentId },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async markAllRead(userId: string): Promise<{ read: true }> {
    await this.prisma.auditNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async dismissPopup(userId: string, incidentId: string): Promise<{ dismissed: true }> {
    await this.prisma.auditNotification.updateMany({
      where: { userId, incidentId },
      data: { popupDismissedAt: new Date() },
    });
    return { dismissed: true };
  }
}
