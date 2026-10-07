const FORCE_EXIT_MS = 10_000;

/**
 * Runs cleanup steps in order on SIGTERM/SIGINT, then exits. A second signal or
 * the force-exit timer kills the process if cleanup hangs.
 */
export function registerShutdown(logger, steps) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      logger.warn({ signal }, 'second shutdown signal, forcing exit');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceExit.unref();

    let exitCode = 0;
    for (const [name, step] of steps) {
      try {
        await step();
        logger.debug({ step: name }, 'shutdown step complete');
      } catch (err) {
        exitCode = 1;
        logger.error({ err, step: name }, 'shutdown step failed');
      }
    }

    logger.info('shutdown complete');
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return shutdown;
}
