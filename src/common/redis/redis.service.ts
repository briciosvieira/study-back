import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// A second, general-purpose Redis connection alongside BullMQ's own —
// BullMQ doesn't expose its internal connection for arbitrary commands, and
// a plain counter/TTL client is a different usage pattern (fire-and-forget,
// must never block a request) from a queue client. Same connection config
// as BullMQ (see AppModule), just not shared with it.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(configService: ConfigService) {
    this.client = new Redis({
      host: configService.get<string>('redis.host'),
      port: configService.get<number>('redis.port'),
      username: configService.get<string>('redis.username') || undefined,
      password: configService.get<string>('redis.password') || undefined,
      tls: configService.get<boolean>('redis.tls') ? {} : undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    this.client.on('error', (error) => {
      this.logger.warn(`Redis connection issue (security counters degrade gracefully): ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => {});
  }
}
