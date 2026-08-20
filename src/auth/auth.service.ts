import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './types/authenticated-user';
import { toAuthenticatedUser } from './types/authenticated-user';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateUser(
    login: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
    });

    // credentials are checked before the active flag so a wrong password and
    // a deactivated account both fail identically for anyone who doesn't
    // already know the real password — only a correct password reveals that
    // the account itself is the thing blocking access
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      throw new ForbiddenException(
        'Account deactivated. Contact an administrator.',
      );
    }

    return toAuthenticatedUser(user, this.avatarPublicUrl());
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

  private avatarPublicUrl(): string {
    return this.configService.get<string>('storage.publicUrl')!;
  }
}
