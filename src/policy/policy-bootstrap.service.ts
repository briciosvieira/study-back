import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  STUDYJA_POLICY_CONTENT,
  STUDYJA_POLICY_TITLE,
  STUDYJA_POLICY_VERSION,
} from './policy-content';

@Injectable()
export class PolicyBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(PolicyBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const versionOnePointOne = await this.prisma.policyVersion.findUnique({
      where: { version: STUDYJA_POLICY_VERSION },
    });

    if (versionOnePointOne?.isActive) {
      this.logger.log(`Active policy ${versionOnePointOne.version} already present.`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const activePolicies = await tx.policyVersion.findMany({
        where: { isActive: true },
      });

      if (activePolicies.length > 0) {
        await tx.policyVersion.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }

      if (versionOnePointOne) {
        await tx.policyVersion.update({
          where: { id: versionOnePointOne.id },
          data: {
            title: STUDYJA_POLICY_TITLE,
            content: STUDYJA_POLICY_CONTENT,
            isActive: true,
            requiresReacceptance: true,
            publishedAt: new Date(),
          },
        });

        this.logger.log(`Policy ${STUDYJA_POLICY_VERSION} activated and 1.0 preserved as historical version.`);
        return;
      }

      const created = await tx.policyVersion.create({
        data: {
          version: STUDYJA_POLICY_VERSION,
          title: STUDYJA_POLICY_TITLE,
          content: STUDYJA_POLICY_CONTENT,
          isActive: true,
          requiresReacceptance: true,
          publishedAt: new Date(),
        },
      });

      this.logger.log(`Policy ${created.version} published with the official StudyJA content.`);
    });
  }
}
