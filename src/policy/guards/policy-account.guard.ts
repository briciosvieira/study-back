import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditService } from '../../audit/audit.service';
import { markAudited } from '../../audit/audited-exception.util';
import { normalizeRoute } from '../../audit/sanitize-metadata.util';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { getClientIp, getRequestId } from '../../common/utils/request-context.util';
import { POLICY_EXEMPT_KEY } from '../decorators/policy-exempt.decorator';

// Runs after JwtAuthGuard (needs req.user) and before RolesGuard — mirrors
// the mandated order: Authentication -> isActive -> Policy -> Role. Reads
// user.accessState, computed fresh per-request in the passport strategies
// (see AuthenticatedUser), so this guard itself never touches the DB.
@Injectable()
export class PolicyAccountGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return true; // defensive — JwtAuthGuard already ran and would have thrown otherwise

    if (user.accessState === 'ACCOUNT_INACTIVE') {
      this.log('ACCOUNT_INACTIVE', 'AUTHENTICATION', user, request);
      throw markAudited(new ForbiddenException('ACCOUNT_INACTIVE'));
    }

    const isExempt = this.reflector.getAllAndOverride<boolean>(POLICY_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt) return true;

    if (user.accessState !== 'POLICY_ACCEPTED') {
      this.log('POLICY_REQUIRED', 'POLICY', user, request, { accessState: user.accessState });
      throw markAudited(new ForbiddenException(user.accessState));
    }

    return true;
  }

  private log(
    eventType: 'ACCOUNT_INACTIVE' | 'POLICY_REQUIRED',
    category: 'AUTHENTICATION' | 'POLICY',
    user: AuthenticatedUser,
    request: Request,
    metadata?: Record<string, unknown>,
  ) {
    void this.auditService.record({
      eventType,
      category,
      severity: 'INFO',
      actorUserId: user.id,
      actorName: user.name,
      method: request.method,
      route: normalizeRoute(request.originalUrl ?? request.url),
      ipAddress: getClientIp(request),
      requestId: getRequestId(request) ?? null,
      metadata,
    });
  }
}
