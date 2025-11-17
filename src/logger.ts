import pino from "pino";

// Note: We can't import config here as it would create a circular dependency
// The logger is used by config.ts, so we'll use process.env directly
const isDevelopment = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

// Create logger instance that always writes to stderr
// This is critical for stdio mode where stdout is used for MCP protocol communication
export const logger = pino(
  {
    level: logLevel,
    transport: isDevelopment
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
            destination: 2, // stderr
          },
        }
      : undefined,
    formatters: {
      level: (label: string) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ dest: 2, sync: false }),
); // Write to stderr (fd 2)

// Export logger methods for convenience
export const log = {
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  fatal: logger.fatal.bind(logger),
};
