// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Express } from "express";
import rateLimit, { type Options } from "express-rate-limit";
import helmet from "helmet";
import { Server } from "http";
import log from "./logger.js";

function create(): Express {
  const app = express();

  // Security headers via helmet (includes HSTS, X-Frame-Options, etc.)
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

  // CORS: Allow all origins by default. Configure via cors() options for production.
  app.use(cors({}));

  // Rate limit configuration (configurable via environment variables)
  const rateLimitWindowMs =
    parseInt(process.env.RATE_LIMIT_WINDOW_MINS || "15", 10) * 60 * 1000; // Default: 15 minutes
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || "1000", 10); // Default: 1000 requests per window (increased for development/testing)
  const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== "false"; // Default: enabled

  if (rateLimitEnabled) {
    const rateLimitOptions: Partial<Options> = {
      windowMs: rateLimitWindowMs,
      max: rateLimitMax,
      message: "Too many requests, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
      // Use default keyGenerator which properly handles IPv6 normalization
    };
    app.use(rateLimit(rateLimitOptions));
  }

  app.use(cookieParser());

  // Request logging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();

    // Log request
    log.debug(
      {
        method: req.method,
        url: req.url,
        headers: {
          "user-agent": req.get("User-Agent"),
          "content-type": req.get("Content-Type"),
          authorization: req.get("Authorization")
            ? "***REDACTED***"
            : undefined,
        },
        ip: req.ip,
      },
      "Incoming request",
    );

    // Log response when finished
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      log.info(
        {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          ip: req.ip,
        },
        "Request completed",
      );
    });

    next();
  });

  // Body parsing with 10mb limit
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Error handling middleware (must be last)
  // Note: Routes should be registered after calling create() but before starting the server
  // This middleware will catch any errors thrown in route handlers
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      log.error({ error: err, stack: err.stack }, "Unhandled error occurred");

      // Avoid sending response if headers already sent
      if (res.headersSent) {
        return;
      }

      res.status(500).json({
        error: "Internal server error",
        message:
          process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    },
  );

  return app;
}

function stop(server: Server): void {
  // Graceful shutdown: allow in-flight requests to complete
  server.close((error) => {
    if (error) {
      log.error({ error }, "Error during server shutdown");
      process.exit(1);
    }
    log.info("Server closed successfully");
    process.exit(0);
  });

  // Force shutdown after timeout if graceful shutdown takes too long
  const shutdownTimeout = setTimeout(() => {
    log.warn("Graceful shutdown timeout exceeded, forcing shutdown");
    process.exit(1);
  }, 10000); // 10 second timeout

  // Clear timeout if shutdown completes normally
  shutdownTimeout.unref();
}

function start(app: Express, port: number): Server {
  // Note: Port validation is handled by Zod schema in config.ts
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
