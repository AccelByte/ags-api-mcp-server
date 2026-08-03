import pino from "pino";

// Note: We can't import config here as it would create a circular dependency
// The logger is used by config.ts, so we'll use process.env directly
const isDevelopment = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

// Best-effort net for credential-shaped fields at common nesting depths.
// This is a backstop, not the primary defense — call sites that log request
// or response bodies (e.g. src/tools/openapi-tools.ts) must still redact
// deeply/arbitrarily-nested fields themselves before logging.
// Pino redact matches exact key names only (no substring/case-insensitive
// matching like sanitizeBody's regex), so snake_case and camelCase variants
// must both be listed explicitly.
const SENSITIVE_KEYS = [
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "sessionToken",
  "session_token",
  "bearerToken",
  "bearer_token",
  "authToken",
  "auth_token",
  "secret",
  "clientSecret",
  "client_secret",
  "password",
  "credential",
  "credentials",
  "apiKey",
  "api_key",
];
const REDACT_DEPTH = 4;
const redactPaths = SENSITIVE_KEYS.flatMap((key) => {
  const paths: string[] = [key];
  let prefix = "*";
  for (let depth = 1; depth < REDACT_DEPTH; depth++) {
    paths.push(`${prefix}.${key}`);
    prefix += ".*";
  }
  return paths;
});

// Create logger instance that always writes to stderr
// This is critical for stdio mode where stdout is used for MCP protocol communication
export const logger = pino(
  {
    level: logLevel,
    redact: {
      paths: redactPaths,
      censor: "***REDACTED***",
    },
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
