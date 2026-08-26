import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { disconnectPrisma, prisma } from './db/prisma.js';

async function main(): Promise<void> {
  // Fail fast and loudly if the database is unreachable at boot.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, storage: env.STORAGE_DRIVER },
      'server listening',
    );
  });

  startJobs();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
