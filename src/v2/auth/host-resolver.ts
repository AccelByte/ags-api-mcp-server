// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

import type { HostedConfig } from "../config.js";
import log from "../logger.js";

interface AgsContext {
  baseUrl: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ags?: AgsContext;
    }
  }
}

export function extractTokenIssuer(token: string): string | undefined {
  try {
    const decoded = jwt.decode(token) as { iss?: string } | null;
    return decoded?.iss;
  } catch {
    return undefined;
  }
}

export function validateUrlMatchesIssuer(
  derivedUrl: string,
  issuer: string,
): boolean {
  const normalizedDerived = derivedUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  const normalizedIssuer = issuer
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();

  return (
    normalizedIssuer === normalizedDerived ||
    normalizedIssuer.startsWith(`${normalizedDerived}/`)
  );
}

function getRequestHost(
  req: Parameters<RequestHandler>[0],
): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded;
  }
  return req.headers.host;
}

export function resolveAgsHost(config: HostedConfig): RequestHandler {
  return (req, res, next) => {
    if (!config.enabled) {
      return next();
    }

    const host = getRequestHost(req);

    if (!host) {
      log.warn({ path: req.path }, "Missing Host header in hosted mode");
      return res.status(400).json({
        error: "Bad Request",
        message: "Host header is required",
      });
    }

    const hostname = host.split(":")[0];
    const baseUrl = `https://${hostname}`;

    if (config.validateTokenIssuer) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const issuer = extractTokenIssuer(token);

        if (!issuer) {
          log.warn(
            {
              host,
              derivedUrl: baseUrl,
            },
            "Token missing issuer claim",
          );
          return res.status(403).json({
            error: "Forbidden",
            message: "Token is missing issuer claim",
          });
        }

        if (!validateUrlMatchesIssuer(baseUrl, issuer)) {
          log.warn(
            {
              host,
              derivedUrl: baseUrl,
              tokenIssuer: issuer,
            },
            "Token issuer does not match request host",
          );
          return res.status(403).json({
            error: "Forbidden",
            message: "Token was issued for a different environment",
          });
        }
      }
    }

    req.ags = { baseUrl };

    log.debug({ host, agsBaseUrl: baseUrl }, "Resolved AGS base URL from host");

    return next();
  };
}

export type { AgsContext };
