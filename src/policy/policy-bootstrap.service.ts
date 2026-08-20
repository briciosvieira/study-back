import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PolicyBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PolicyBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const activeVersion = await this.prisma.policyVersion.findFirst({
      where: { isActive: true },
    });

    if (activeVersion) {
      return;
    }

    const existingV1 = await this.prisma.policyVersion.findUnique({
      where: { version: '1.0' },
    });

    if (existingV1) {
      this.logger.warn(
        `Policy version ${existingV1.version} exists but is inactive; leaving it unchanged to avoid automatic reactivation.`,
      );
      return;
    }

    const created = await this.prisma.policyVersion.create({
      data: {
        version: '1.0',
        title: 'Política de Uso e Privacidade',
        content:
          'Para utilizar o StudyJA, você precisa ler e aceitar esta Política de Uso e Privacidade. ' +
          'A plataforma utiliza informações necessárias ao funcionamento da conta e das funcionalidades, ' +
          'incluindo dados cadastrais e registros de segurança. ' +
          '[Texto de exemplo — um administrador deve revisar e substituir este conteúdo antes do lançamento em produção.]',
        isActive: true,
        requiresReacceptance: false,
        publishedAt: new Date(),
      },
    });

    this.logger.log(`Active policy ${created.version} created automatically.`);
  }
}
