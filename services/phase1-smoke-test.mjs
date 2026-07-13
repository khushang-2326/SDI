import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      name: "Phase 1 Tester",
      email: `phase1+${stamp}@example.com`,
      passwordHash: "test:hash"
    }
  });

  const lead = await prisma.lead.create({
    data: {
      fullName: "Test Lead",
      mobileNumber: "5551234567",
      email: `lead+${stamp}@example.com`,
      address: "123 Test Street",
      message: "Phase 1 smoke test",
      companyName: "Test Co",
      userId: user.id
    }
  });

  const website = await prisma.targetWebsite.create({
    data: {
      websiteName: "Demo Target",
      websiteUrl: "https://example.com",
      contactPageUrl: "https://example.com/contact",
      status: "active",
      notes: "Smoke test target",
      userId: user.id
    }
  });

  const created = {
    users: await prisma.user.count({ where: { id: user.id } }),
    leads: await prisma.lead.count({ where: { id: lead.id } }),
    websites: await prisma.targetWebsite.count({ where: { id: website.id } })
  };

  await prisma.user.delete({ where: { id: user.id } });

  const cascadeAfterUserDelete = {
    leads: await prisma.lead.count({ where: { id: lead.id } }),
    websites: await prisma.targetWebsite.count({ where: { id: website.id } })
  };

  console.log(
    JSON.stringify({ created, cascadeAfterUserDelete }, null, 2)
  );
} finally {
  await prisma.$disconnect();
}
