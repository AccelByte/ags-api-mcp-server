// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

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
  allowParentDomainIssuer: boolean = false,
): boolean {
  const normalizedDerived = derivedUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  const normalizedIssuer = issuer
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();

  // Match when:
  // 1. Exact host match (e.g. derived="example.com", issuer="example.com")
  // 2. Issuer has a sub-path under derived host (e.g. issuer="example.com/iam")
  // 3. Issuer is the namespaced issuer for this tenant host (see below)
  //
  // Subdomain matching (derived is subdomain of issuer) is intentionally NOT
  // supported by default: a token issued for "accelbyte.io" must not be
  // accepted at "evil.accelbyte.io". Issuers should use path-based
  // differentiation instead.
  if (
    normalizedIssuer === normalizedDerived ||
    normalizedIssuer.startsWith(`${normalizedDerived}/`)
  ) {
    return true;
  }

  // Namespaced issuer for a tenant-subdomain host.
  //
  // IAM's namespaced OAuth discovery document — the only entry point MCP
  // clients use — identifies each namespace as its own authorization server
  // with `issuer = {baseUri}/{namespace}`, where {baseUri} is the
  // environment's public host root. Since the MCP 2026-07-28 RC authorization
  // hardening, tokens from those grant chains carry that value in `iss`. A
  // client that reaches this server at "{namespace}.{baseHost}" therefore
  // presents a token whose issuer names the *parent* host and carries the
  // namespace as a path — matching neither rule above, nor the
  // parent-domain rule below (which excludes issuers with a path).
  //
  // Accept that pairing only when the issuer's single path segment is exactly
  // the derived host's leading label, so a token minted for one namespace can
  // never be presented on another tenant's host. Not gated on
  // `allowParentDomainIssuer`: unlike the bare parent-domain case this match
  // is self-verifying — the namespace must equal the subdomain label.
  //
  // This is a structural host↔issuer check, not proof of authenticity. The
  // signature is verified separately in `setAuthFromToken`, against the JWKS
  // advertised by the *derived host's* root discovery document — which in this
  // topology points back at the parent host, so that stage additionally needs
  // ALLOW_CROSS_DOMAIN_JWKS. Accepting here does not by itself authenticate.
  //
  // Case handling is deliberately asymmetric: the host halves are compared
  // case-insensitively (DNS is), but the path segment must already be
  // lowercase. JWT `iss` is not case-normalized (RFC 7519 §2), so folding case
  // there would let "host/TENANT-A" match "tenant-a.host" and cross namespaces
  // if IAM ever treats those as distinct. IAM's own `validateSubDomain` folds
  // case; if an uppercase namespace with a tenant subdomain ever ships, this
  // check fails closed with an issuer_host_mismatch and relaxing it here is
  // the deliberate fix.
  //
  // A base-path issuer can collide with this rule only when the path segment
  // and the subdomain label are the same string (issuer "example.com/iam"
  // presented at host "iam.example.com"). That host exists only if a namespace
  // of that name was provisioned, both names belong to the same environment,
  // and the signature check is unchanged — so the collision is benign.
  const strippedIssuer = issuer.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const [rawIssuerHost, ...issuerPathSegments] = strippedIssuer.split("/");
  if (
    issuerPathSegments.length === 1 &&
    // IAM namespaces are alphanumeric with hyphens; "_" is not part of that
    // contract, so it is excluded rather than inherited from route validation.
    /^[a-z0-9-]+$/.test(issuerPathSegments[0]) &&
    normalizedDerived ===
      `${issuerPathSegments[0]}.${rawIssuerHost.toLowerCase()}`
  ) {
    return true;
  }

  // Opt-in: parent-domain issuer match.
  //
  // Some AGS deployments share a single OAuth authorization server across
  // subdomain environments — e.g. issuer "internal.gamingservices.accelbyte.io"
  // signs JWTs for "<env>.internal.gamingservices.accelbyte.io". The signature
  // check still verifies against the issuer's JWKS; this only loosens the
  // host-equality check so the derived host can be a strict subdomain of the
  // issuer host. Off by default. Enable via the typed config flag
  // (config.hosted.allowParentDomainIssuer, set with ALLOW_PARENT_DOMAIN_ISSUER=true).
  //
  // Required guards (all enforced below):
  //  - Issuer must be host-only (no path), otherwise path-vs-subdomain
  //    semantics conflict.
  //  - Derived host must be a *strict* subdomain — endsWith(`.${issuerHost}`),
  //    not bare suffix — preventing "evil-internal.foo" matching "internal.foo".
  if (allowParentDomainIssuer) {
    const issuerHasPath = normalizedIssuer.includes("/");
    if (!issuerHasPath && normalizedDerived.endsWith(`.${normalizedIssuer}`)) {
      return true;
    }
  }

  return false;
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

        if (
          !validateUrlMatchesIssuer(
            baseUrl,
            issuer,
            config.allowParentDomainIssuer,
          )
        ) {
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
