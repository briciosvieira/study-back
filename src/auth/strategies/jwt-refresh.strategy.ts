import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PolicyService } from '../../policy/policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuthenticatedUser } from '../types/authenticated-user';

interface RefreshTokenPayload {
  sub: string;
}

function extractFromCookie(req: Request): string | null {
  const value: unknown = req?.cookies?.['refresh_token'];
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly policyService: PolicyService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractFromCookie]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.refreshSecret')!,
    });
  }

  async validate(payload: RefreshTokenPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('User not found or inactive');
    }
    // Re-resolved on every refresh, not carried over from the old access
    // token — a rejection/revocation that happened since the last refresh
    // must show up in the very next minted access token's accessState.
    const accessState = await this.policyService.resolveAccessState(user.id, user.active);
    return toAuthenticatedUser(
      user,
      this.configService.get<string>('storage.publicUrl')!,
      accessState,
    );
  }
}
