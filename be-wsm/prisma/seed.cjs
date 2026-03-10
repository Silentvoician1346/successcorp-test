const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@wms.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123456';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      name: 'Admin',
    },
    create: {
      email,
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      name: 'Admin',
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  console.log(`Seeded admin user: ${user.email} (${user.role})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`Default admin password: ${password}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
