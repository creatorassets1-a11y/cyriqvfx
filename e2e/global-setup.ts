import { PrismaClient } from '@prisma/client';

/**
 * Removes artifacts left behind by an aborted run, so a previous failure
 * cannot contaminate the next one. Every fixture the suites create is named
 * with an `E2E`/`e2e-` prefix precisely so it can be identified and removed
 * without touching the seeded catalogue.
 */
export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const resources = await prisma.resource.findMany({
      where: { title: { startsWith: 'E2E' } },
      select: { id: true },
    });

    if (resources.length > 0) {
      const ids = resources.map((r) => r.id);
      // Clear the self-referencing current-version pointer before deleting.
      await prisma.resource.updateMany({
        where: { id: { in: ids } },
        data: { currentVersionId: null },
      });
      await prisma.resource.deleteMany({ where: { id: { in: ids } } });
    }

    await prisma.tutorial.deleteMany({ where: { title: { startsWith: 'E2E' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });

    // Counters shown in the UI must reflect the seeded catalogue only.
    await prisma.downloadEvent.deleteMany();
    await prisma.resourceView.deleteMany();
    await prisma.searchQuery.deleteMany();
    await prisma.resource.updateMany({
      data: { downloadCount: 0, viewCount: 0, saveCount: 0 },
    });

    const summary = [
      resources.length && `${resources.length} resources`,
      'download and view counters',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`e2e: cleaned ${summary}`);
  } finally {
    await prisma.$disconnect();
  }
}
