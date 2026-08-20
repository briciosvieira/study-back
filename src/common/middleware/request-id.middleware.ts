import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// One id per request, attached before any guard/controller/filter runs —
// lets audit events and error responses reference the same request without
// ever having to log the request body.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}
