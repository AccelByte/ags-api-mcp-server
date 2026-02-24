// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

import type { HostedConfig } from "../config.js";
import log from "../logger.js";
import securityLog from "../security-logger.js";

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
    normalizedIssuer.startsWith(`${normalizedDerived}/`) ||
    normalizedDerived.endsWith(`.${normalizedIssuer}`)
  );
}

/** Validate that a hostname contains only legal characters (RFC 952 / 1123). */
const VALID_HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function getRequestHost(
  req: Parameters<RequestHandler>[0],
): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  let raw: string | undefined;
  if (forwarded) {
    raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  } else {
    raw = req.headers.host;
  }
  if (!raw) return undefined;

  // Strip port if present and validate hostname format
  const hostname = raw.split(":")[0];
  if (!VALID_HOSTNAME_RE.test(hostname)) {
    return undefined;
  }

  return raw;
}

export function resolveAgsHost(config: HostedConfig): RequestHandler {
  return (req, res, next) => {
    if (!config.enabled) {
      return next();
    }

    const host = getRequestHost(req);

    if (!host) {
      log.warn(
        { path: req.path },
        "Missing or invalid Host header in hosted mode",
      );
      return res.status(400).json({
        error: "Bad Request",
        message: "Valid Host header is required",
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
          securityLog.suspiciousRequest({
            ip: req.ip,
            reason: "missing_issuer_claim",
            host,
            derivedUrl: baseUrl,
          });
          return res.status(403).json({
            error: "Forbidden",
            message: "Token is missing issuer claim",
          });
        }

        if (!validateUrlMatchesIssuer(baseUrl, issuer)) {
          securityLog.suspiciousRequest({
            ip: req.ip,
            reason: "issuer_host_mismatch",
            host,
            tokenIssuer: issuer,
            derivedUrl: baseUrl,
          });
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
