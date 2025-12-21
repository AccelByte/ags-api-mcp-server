// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { Server } from "http";
import log from "./logger.js";

function create(): Express {
  const app = express();

  // TODO: Review and tighten CSP directives based on actual requirements
  // TODO: Consider adding more security headers (HSTS, X-Frame-Options, etc.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );

  // TODO: Add cors configuration
  app.use(cors({}));

  // TODO: Make rate limit configuration configurable via environment variables
  // TODO: Consider implementing different rate limits per endpoint (e.g., stricter limits for /mcp)
  // TODO: Add rate limit key generator based on IP or authenticated user ID
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requests per windowMs
      message: "Too many requests, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // TODO: Add cookie parser options
  app.use(cookieParser());

  // TODO: Make JSON body size limit configurable via environment variable
  // TODO: Add request logging middleware for debugging and monitoring
  // TODO: Consider adding request ID middleware for tracing requests
  app.use(express.json({ limit: "10mb" }));

  // TODO: Add URL encoded body limit configuration
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  return app;
}

function stop(server: Server): void {
  // TODO: Add graceful shutdown with timeout to allow in-flight requests to complete
  // TODO: Close database connections and other resources before shutting down
  server.close();
}

function start(app: Express, port: number): Server {
  // TODO: Validate port number is within valid range before starting
  const server = app
    .listen(port, (error) => {
      if (error) {
        log.error({ error }, "Failed to start server");
        process.exit(1);
      }
      log.info({ port }, "Server is running");
    })
    .on("error", (error) => {
      log.error({ error }, "Server error");
      process.exit(1);
    })
    .on("close", () => {
      log.info("Server is shutting down...");
      process.exit(0);
    });

  // Handle graceful shutdown signals
  process.on("SIGINT", async () => {
    log.info("Received SIGINT, shutting down gracefully...");
    stop(server);
  });

  process.on("SIGTERM", async () => {
    log.info("Received SIGTERM, shutting down gracefully...");
    stop(server);
  });

  return server;
}

export { create, start, stop };
