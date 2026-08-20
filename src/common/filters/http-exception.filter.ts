import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../../audit/audit.service';
import { isAudited } from '../../audit/audited-exception.util';
import { normalizeRoute } from '../../audit/sanitize-metadata.util';
import { SecurityIncidentService } from '../../security/security-incident.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { getClientIp, getRequestId } from '../utils/request-context.util';

// Safety net for 401/403/429/5xx that no specific call site already logged
// with richer context (see isAudited/markAudited) — RolesGuard rejections,
// JwtAuthGuard rejections, ThrottlerGuard rejections, and unhandled 500s all
// land here with nothing more specific to say than "this route, this
// status, this actor". 400s and other validation noise are intentionally
// never recorded.
@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly securityIncidentService: SecurityIncidentService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { user?: AuthenticatedUser }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as Record<string, unknown>).message ??
          exceptionResponse);

    if (!isHttpException) {
      this.logger.error(exception);
    }

    this.maybeRecordSecurityEvent(exception, status, request);

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }

  private maybeRecordSecurityEvent(
    exception: unknown,
    status: number,
    request: Request & { user?: AuthenticatedUser },
  ) {
    if (isAudited(exception)) return; // a specific call site already logged this

    const classification = this.classify(status);
    if (!classification) return;

    const ipAddress = getClientIp(request);
    const route = normalizeRoute(request.originalUrl ?? request.url);
    const actorUserId = request.user?.id ?? null;

    // fire-and-forget — never let audit/incident bookkeeping delay or break
    // the error response already being sent above
    void this.auditService.record({
      eventType: classification.eventType,
      category: classification.category,
      severity: classification.severity,
      actorUserId,
      actorName: request.user?.name ?? null,
      method: request.method,
      route,
      httpStatus: status,
      ipAddress,
      userAgent: request.headers['user-agent'] ?? null,
      requestId: getRequestId(request) ?? null,
    });

    void this.securityIncidentService.trackFailure({
      type: classification.incidentType,
      key: actorUserId ?? ipAddress ?? 'unknown',
      userId: actorUserId,
      ipAddress,
      route,
      method: request.method,
    });
  }

  private classify(status: number): {
    eventType: 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'SERVER_ERROR';
    category: 'AUTHENTICATION' | 'SECURITY' | 'SYSTEM';
    severity: 'INFO' | 'WARNING';
    incidentType: string;
  } | null {
    if (status === 401) {
      return {
        eventType: 'UNAUTHORIZED',
        category: 'AUTHENTICATION',
        severity: 'INFO',
        incidentType: 'REPEATED_UNAUTHORIZED',
      };
    }
    if (status === 403) {
      return {
        eventType: 'FORBIDDEN',
        category: 'SECURITY',
        severity: 'INFO',
        incidentType: 'REPEATED_FORBIDDEN_ACCESS',
      };
    }
    if (status === 429) {
      return {
        eventType: 'RATE_LIMITED',
        category: 'SECURITY',
        severity: 'WARNING',
        incidentType: 'REPEATED_RATE_LIMIT_ABUSE',
      };
    }
    if (status >= 500) {
      return {
        eventType: 'SERVER_ERROR',
        category: 'SYSTEM',
        severity: 'WARNING',
        incidentType: 'REPEATED_SERVER_ERROR',
      };
    }
    return null;
  }
}
