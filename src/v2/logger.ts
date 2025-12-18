// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import pino from "pino";

const development = process.env.NODE_ENV === "development";
const level = process.env.LOG_LEVEL || (development ? "debug" : "info");

const logger = pino(
  {
    level,
    transport: development
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "SYS:standard",
          },
        }
      : undefined,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(process.stderr),
);

const log = {
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  fatal: logger.fatal.bind(logger),
  trace: logger.trace.bind(logger),
};

export default log;
export { logger as defaultLogger };
