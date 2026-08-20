import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const name = process.env.SEED_ADMIN_NAME ?? 'Administrator';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@lms.local';
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD must be set — refusing to seed an admin with a default password');
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    console.log(`Seed admin already exists (${existing.email}), skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: { name, email, username, passwordHash, role: Role.ADMIN },
  });

  console.log(`Seed admin created: ${admin.email} / ${admin.username}`);
}

// Without an active PolicyVersion, AccountAccessService treats every user as
// already-accepted (nothing to gate against) — this placeholder exists so
// the feature is functional out of the box. It intentionally makes no legal
// claims (e.g. no "LGPD compliant" language); an admin should replace this
// text with the organization's actual reviewed policy before going live.
async function seedInitialPolicy() {
  const existing = await prisma.policyVersion.findFirst({ where: { isActive: true } });
  if (existing) {
    console.log(`Active policy version already exists (${existing.version}), skipping.`);
    return;
  }

  const policy = await prisma.policyVersion.create({
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

  console.log(`Seed policy version created: ${policy.version} (placeholder text — review before production use)`);
}

async function run() {
  await main();
  await seedInitialPolicy();
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
