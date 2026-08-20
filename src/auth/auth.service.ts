import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { AuditService } from '../audit/audit.service';
import { markAudited } from '../audit/audited-exception.util';
import { maskEmail, normalizeEmail } from '../common/utils/normalize-email.util';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityIncidentService } from '../security/security-incident.service';
import type { AuthenticatedUser } from './types/authenticated-user';
import { toAuthenticatedUser } from './types/authenticated-user';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly policyService: PolicyService,
    private readonly auditService: AuditService,
    private readonly securityIncidentService: SecurityIncidentService,
  ) {}

  async validateUser(
    login: string,
    password: string,
    context: LoginRequestContext,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
    });

    // credentials are checked before the active flag so a wrong password and
    // a deactivated account both fail identically for anyone who doesn't
    // already know the real password — only a correct password reveals that
    // the account itself is the thing blocking access
    if (!user) {
      await this.auditService.record({
        eventType: 'LOGIN_FAILED',
        category: 'AUTHENTICATION',
        severity: 'INFO',
        targetEmailMasked: login.includes('@') ? maskEmail(normalizeEmail(login)) : null,
        ...this.contextFields(context),
      });
      await this.securityIncidentService.trackFailure({
        type: 'REPEATED_LOGIN_FAILURE',
        key: context.ipAddress ?? 'unknown',
        ipAddress: context.ipAddress,
      });
      throw markAudited(new UnauthorizedException('Invalid credentials'));
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      await this.auditService.record({
        eventType: 'INVALID_PASSWORD',
        category: 'AUTHENTICATION',
        severity: 'INFO',
        actorUserId: user.id,
        actorName: user.name,
        ...this.contextFields(context),
      });
      await this.securityIncidentService.trackFailure({
        type: 'REPEATED_LOGIN_FAILURE',
        key: user.id,
        userId: user.id,
        ipAddress: context.ipAddress,
      });
      throw markAudited(new UnauthorizedException('Invalid credentials'));
    }

    if (!user.active) {
      await this.auditService.record({
        eventType: 'ACCOUNT_INACTIVE',
        category: 'AUTHENTICATION',
        severity: 'INFO',
        actorUserId: user.id,
        actorName: user.name,
        ...this.contextFields(context),
      });
      throw markAudited(
        new ForbiddenException('Account deactivated. Contact an administrator.'),
      );
    }

    const accessState = await this.policyService.resolveAccessState(user.id, user.active);

    await this.auditService.record({
      eventType: 'LOGIN_SUCCEEDED',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      actorUserId: user.id,
      actorName: user.name,
      ...this.contextFields(context),
    });

    return toAuthenticatedUser(user, this.avatarPublicUrl(), accessState);
  }

  issueTokens(user: AuthenticatedUser): TokenPair {
    return {
      accessToken: this.jwtService.sign(
        { sub: user.id, role: user.role },
        {
          secret: this.configService.get<string>('jwt.accessSecret'),
          expiresIn: this.configService.get<StringValue>('jwt.accessExpiresIn'),
        },
      ),
      refreshToken: this.jwtService.sign(
        { sub: user.id },
        {
          secret: this.configService.get<string>('jwt.refreshSecret'),
          expiresIn: this.configService.get<StringValue>(
            'jwt.refreshExpiresIn',
          ),
        },
      ),
    };
  }

  private contextFields(context: LoginRequestContext) {
    return {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    };
  }

  private avatarPublicUrl(): string {
    return this.configService.get<string>('storage.publicUrl')!;
  }
}
