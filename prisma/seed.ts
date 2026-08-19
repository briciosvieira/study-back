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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
