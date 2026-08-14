// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Express, Request, Response, NextFunction } from "express";

import { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

import log from "../logger.js";
import { assertNotPrivateUrl } from "../ssrf-guard.js";
import { deriveBaseUrl } from "../utils.js";

/**
 * Simple in-memory cache for authorization server metadata.
 * Caches metadata per URL with a configurable TTL to avoid fetching on every request.
 */
interface MetadataCacheEntry {
  metadata: Record<string, unknown>;
  expiresAt: number;
}

/**
 * An RFC 8414 metadata document is a JSON object. A `200 application/json`
 * upstream response can still carry a string, array, or null — spreading one
 * of those into the proxied response yields an object of numeric character
 * keys rather than metadata, so the shape is checked before it is used.
 */
function isMetadataObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Exported so tests can exercise the cache-hit path directly. Proxying a real
// upstream is not testable here: the SSRF guard rejects loopback addresses by
// design, and relaxing it for tests would remove the check this server relies
// on. Seeding the cache reaches the same branch without a fetch.
export const metadataCache = new Map<string, MetadataCacheEntry>();
const METADATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const METADATA_FETCH_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Issuer identifiers resolved from a tenant's authorization-server document,
 * keyed by the discovery URL. A `null` entry records a lookup that failed or
 * was rejected, so an unreachable IAM costs one timeout per negative TTL.
 *
 * Exported for the same reason as `metadataCache`: the SSRF guard rejects
 * loopback, so a test seeds an entry instead of standing up an upstream.
 */
interface IssuerCacheEntry {
  issuer: string | null;
  expiresAt: number;
}

export const issuerCache = new Map<string, IssuerCacheEntry>();
const ISSUER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ISSUER_NEGATIVE_CACHE_TTL_MS = 60 * 1000; // 1 minute
// Shorter than METADATA_FETCH_TIMEOUT_MS: this lookup blocks discovery and has
// a usable fallback.
const ISSUER_FETCH_TIMEOUT_MS = 3_000; // 3 seconds

// Collapses concurrent cold lookups for the same document into one fetch.
const inFlightIssuerLookups = new Map<string, Promise<string | null>>();

/**
 * Issuer identifier for a tenant reached at `origin`, derived without asking
 * the authorization server.
 *
 * IAM identifies a namespace as `{environmentRoot}/{namespace}`, and a client
 * reaches the tenant-subdomain tier at `{namespace}.{environmentRoot}`, so the
 * environment root is recovered by dropping a leading label that is the
 * namespace. Any other host is already the root. At least two labels must
 * remain, so `ns.localhost` is left alone rather than reduced to `localhost`.
 */
export function deriveTenantIssuer(origin: string, namespace?: string): string {
  const stripped = origin.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(stripped);
  } catch {
    return namespace ? `${stripped}/${namespace}` : stripped;
  }

  let issuerHost = url.host;
  if (namespace) {
    const [label, ...rest] = url.host.split(".");
    if (label.toLowerCase() === namespace.toLowerCase() && rest.length >= 2) {
      issuerHost = rest.join(".");
    }
  }

  const base = `${url.protocol}//${issuerHost}`;
  return namespace ? `${base}/${namespace}` : base;
}

/**
 * Whether an issuer read from an upstream document may be republished as this
 * resource's authorization server.
 *
 * The document comes from a host derived from forwarded headers, so echoing
 * `issuer` verbatim would let whatever answered there name any authorization
 * server it liked. Accepted only for the host the client reached or a parent
 * domain of it — the host↔issuer relationship `validateUrlMatchesIssuer`
 * enforces on the token side — with the namespace as its only path segment.
 */
export function isIssuerAcceptableForHost(
  issuer: string,
  requestOrigin: string,
  namespace?: string,
): boolean {
  let issuerUrl: URL;
  let requestUrl: URL;
  try {
    issuerUrl = new URL(issuer);
    requestUrl = new URL(requestOrigin);
  } catch {
    return false;
  }

  // An issuer identifier is an origin plus an optional path, with no query,
  // fragment, or credentials (RFC 8414 §2). Requiring the request's scheme
  // also blocks a downgrade to http.
  if (issuerUrl.protocol !== requestUrl.protocol) return false;
  if (issuerUrl.search || issuerUrl.hash) return false;
  if (issuerUrl.username || issuerUrl.password) return false;

  const segments = issuerUrl.pathname.split("/").filter(Boolean);
  if (namespace) {
    if (segments.length !== 1 || segments[0] !== namespace) return false;
  } else if (segments.length > 0) {
    return false;
  }

  if (issuerUrl.port && issuerUrl.port !== requestUrl.port) return false;

  const issuerHost = issuerUrl.hostname.toLowerCase();
  const requestHost = requestUrl.hostname.toLowerCase();
  return issuerHost === requestHost || requestHost.endsWith(`.${issuerHost}`);
}

/**
 * Reads the issuer identifier from the authorization-server document on the
 * host the client reached, returning it when `isIssuerAcceptableForHost`
 * allows it.
 *
 * RFC 8414 §3.3 has the client rebuild this URL from the advertised identifier
 * and reject the document unless `issuer` comes back identical, so reading it
 * from that same document is the only derivation that always matches.
 */
async function fetchIssuerIdentifier(
  discoveryUrl: string,
  requestOrigin: string,
  namespace?: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ISSUER_FETCH_TIMEOUT_MS,
  );
  try {
    await assertNotPrivateUrl(new URL(discoveryUrl));

    const response = await fetch(discoveryUrl, { signal: controller.signal });
    if (!response.ok) return null;

    const document: unknown = await response.json();
    if (!isMetadataObject(document)) return null;

    const { issuer } = document;
    if (typeof issuer !== "string" || !issuer) return null;
    if (!isIssuerAcceptableForHost(issuer, requestOrigin, namespace)) {
      log.warn(
        { discoveryUrl, issuer },
        "Authorization server advertised an issuer this host may not republish",
      );
      return null;
    }

    return issuer;
  } catch (error) {
    log.warn(
      { discoveryUrl, error: error instanceof Error ? error.message : error },
      "Could not resolve issuer identifier from the authorization server",
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Cached, single-flight wrapper around `fetchIssuerIdentifier`. */
async function resolveIssuerIdentifier(
  requestOrigin: string,
  namespace?: string,
): Promise<string | null> {
  const discoveryUrl = namespace
    ? `${requestOrigin}/.well-known/oauth-authorization-server/${namespace}`
    : `${requestOrigin}/.well-known/oauth-authorization-server`;

  // Re-checked on the way out: a cached value reaches a response without
  // passing the fetch path.
  const accept = (issuer: string | null): string | null =>
    issuer && isIssuerAcceptableForHost(issuer, requestOrigin, namespace)
      ? issuer
      : null;

  const cached = issuerCache.get(discoveryUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return accept(cached.issuer);
  }

  const inFlight = inFlightIssuerLookups.get(discoveryUrl);
  if (inFlight) return inFlight.then(accept);

  const lookup = fetchIssuerIdentifier(discoveryUrl, requestOrigin, namespace)
    .then((issuer) => {
      issuerCache.set(discoveryUrl, {
        issuer,
        expiresAt:
          Date.now() +
          (issuer ? ISSUER_CACHE_TTL_MS : ISSUER_NEGATIVE_CACHE_TTL_MS),
      });
      return issuer;
    })
    .finally(() => {
      inFlightIssuerLookups.delete(discoveryUrl);
    });

  inFlightIssuerLookups.set(discoveryUrl, lookup);
  return lookup.then(accept);
}

/**
 * Authorization server discovery mode for OAuth.
 * - `none`: Use standard discovery (no workaround)
 * - `redirect`: Advertise this server as the authorization server and redirect
 *   clients to the actual authorization server
 * - `proxy`: Advertise this server as the authorization server and proxy
 *   the discovery document from the actual authorization server
 * - `proxyRegister`: Like `proxy`, but also proxies the registration endpoint
 *
 * TEMPORARY WORKAROUND: All modes except `none` exist because VS Code and some
 * MCP clients cannot discover the auth server when it's on a different host.
 * TODO: Remove once MCP clients properly support cross-origin OAuth discovery.
 *
 * These modes cannot satisfy a strict RFC 9207 client, and that is inherent
 * rather than a bug to fix here. They advertise this server as the
 * authorization server while the document a client then fetches is IAM's,
 * carrying IAM's `issuer` — so the RFC 8414 §3.3 comparison fails. Rewriting
 * that `issuer` to this origin would only move the failure to token
 * validation, since IAM mints `iss` and this server does not. They remain
 * usable only by clients that skip issuer validation, which is the same set of
 * clients that needed the workaround in the first place. `config.ts` rejects
 * them alongside hosted mode, so no multi-tenant deployment can reach this.
 */
enum AuthorizationServerDiscoveryMode {
  None = "none",
  Redirect = "redirect",
  Proxy = "proxy",
  ProxyRegister = "proxyRegister",
}

interface RegisterOAuthRoutesOptions {
  /**
   * Workaround for MCP clients that cannot discover the actual authorization
   * server using the standard discovery rules. When set to `redirect`, `proxy`,
   * or `proxyRegister`, this MCP server advertises itself as the authorization
   * server so that clients talk to it, and it can then redirect or proxy them
   * to the actual authorization server.
   *
   * @default AuthorizationServerDiscoveryMode.None
   */
  authorizationServerDiscoveryMode?: AuthorizationServerDiscoveryMode;

  /**
   * Whether hosted mode is enabled.
   *
   * When true, one deployment fronts many AGS environments, so the advertised
   * authorization server is resolved per request from the tenant host the
   * client reached rather than from the configured AGS base URL.
   */
  hostedMode?: boolean;

  /**
   * MCP endpoint path (e.g., "/mcp").
   * Used to construct the protected resource URL.
   */
  mcpPath?: string;

  /**
   * Mirror of `HostedConfig.allowParentDomainIssuer`. The OAuth metadata
   * routes themselves do not validate JWTs, so this flag is currently unused
   * here — the issuer-mismatch check that honors it lives in the MCP routes /
   * `setAuthFromToken` middleware. Accepted on this interface for symmetry
   * with `registerMcpRoutes` and so that future OAuth-layer JWT validation
   * (e.g. on the proxied registration endpoint) can opt into the same
   * relaxed-issuer policy without reshaping the config plumbing.
   */
  allowParentDomainIssuer?: boolean;
}

function registerOAuthRoutes(
  app: Express,
  resourceServerUrl: string,
  authorizationServerUrl: string,
  options: RegisterOAuthRoutesOptions = {},
): void {
  const {
    authorizationServerDiscoveryMode = AuthorizationServerDiscoveryMode.None,
    hostedMode = false,
    mcpPath = "/mcp",
  } = options;

  const isDiscoveryWorkaroundEnabled =
    authorizationServerDiscoveryMode !== AuthorizationServerDiscoveryMode.None;
  // Trailing slashes are stripped once here and reused everywhere the value is
  // concatenated. Without it a configured `https://host/` produces
  // `https://host//myns` as an issuer identifier, which no client resolves.
  const normalizedAuthorizationServerUrl = authorizationServerUrl.replace(
    /\/+$/,
    "",
  );
  const normalizedResourceServerUrl = resourceServerUrl.replace(/\/+$/, "");

  // This server's own public origin as the client sees it. Used only by the
  // discovery workarounds, which advertise this server as the authorization
  // server and must therefore publish URLs that point back here — both the
  // issuer identifier and, in `proxyRegister`, the registration endpoint. Both
  // must agree, or a client registers against an origin the metadata never
  // named.
  //
  // Reduced to a true origin rather than merely stripped of trailing slashes.
  // `MCP_SERVER_URL` is validated only as a URL, so a configured value like
  // `https://mcp.example/?region=us` passes and would otherwise produce the
  // issuer `https://mcp.example/?region=us/myns` and a registration endpoint
  // whose `/oauth/...` path lands inside the query string — a request that
  // reaches `/`, not the registration proxy. The registration routes are
  // registered at the app root, so the origin is also the correct base for
  // them. Falls back to the stripped string if the value will not parse,
  // which keeps behaviour identical for the normal origin-only case.
  const toOrigin = (value: string): string => {
    try {
      return new URL(value).origin;
    } catch {
      return value.replace(/\/+$/, "");
    }
  };
  const deriveThisServerOrigin = (req: Request): string =>
    toOrigin(
      deriveBaseUrl(req, normalizedResourceServerUrl, {
        allowHostedContext: !hostedMode,
      }),
    );
  // A root MCP path contributes no path segment to advertised resource URLs,
  // mirroring registerMcpRoutes — otherwise a namespaced resource would be
  // advertised as e.g. "https://host//myns". Trailing slashes are stripped for
  // the same reason: "/mcp/" would advertise and register the well-known
  // documents under "/mcp//", which no client resolves to.
  const normalizedMcpPath = mcpPath.replace(/\/+$/, "");
  const hasPathAwareMcpRoute = normalizedMcpPath !== "";
  const mcpBasePath = hasPathAwareMcpRoute ? normalizedMcpPath : "";
  const pathAwareProtectedResourceRoute = hasPathAwareMcpRoute
    ? `/.well-known/oauth-protected-resource${mcpBasePath}`
    : null;
  const pathAwareAuthorizationServerRoute = hasPathAwareMcpRoute
    ? `/.well-known/oauth-authorization-server${mcpBasePath}`
    : null;

  // Protected-resource metadata must describe the same public resource URL
  // the client requested. Trusted reverse-proxy headers take precedence over
  // the configured fallback; raw hosted request context does not.
  //
  // Advertised here (rather than left for the client to guess) so that MCP
  // clients performing OAuth discovery know to request `offline_access` and
  // get a refresh token back — without this, IAM issues access-token-only
  // grants that expire with no way to silently renew.
  //
  // `openid` and `email` are deliberately absent. AGS IAM rejects an
  // authorization request carrying them, so a client that requests the
  // advertised set verbatim gets an invalid_scope error and has to retry.
  const PROTECTED_RESOURCE_SCOPES_SUPPORTED = [
    "offline_access",
    "account",
    "commerce",
    "social",
    "publishing",
    "analytics",
  ];

  // Shared by all four route registrations below. The only thing that varies
  // per route is whether `:namespace` is present in the URL — everything else
  // (deriving the resource/auth-server base URLs, the metadata shape) is
  // identical, so one handler serves the root, path-aware, and namespace-aware
  // variants alike.
  const withNamespace = (base: string, ns?: string): string =>
    ns ? `${base}/${ns}` : base;

  const protectedResourceHandler = async (req: Request, res: Response) => {
    const { namespace } = req.params;

    // Validate namespace to prevent path traversal / URL injection
    if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
      res.status(400).json({
        error: "Bad Request",
        message: "Invalid namespace",
      });
      return;
    }

    // `authorization_servers` entries are OAuth *issuer identifiers*, not
    // addresses of this server. A client inserts `.well-known` into the
    // identifier per RFC 8414 §3, fetches, and §3.3 requires the returned
    // `issuer` to be identical to what the URL was built from. Three sources,
    // in order of precedence:
    //
    //  1. The discovery workarounds advertise *this* server as the
    //     authorization server, then redirect or proxy — so the client must be
    //     pointed back here. Falling back to the AGS base URL would send it
    //     past the workaround to the origin it cannot reach.
    //
    //  2. Hosted mode serves many environments from one deployment, so the
    //     configured AGS base URL identifies no particular tenant and applies
    //     only to requests carrying no trusted host. The tenant is the request
    //     host, and its issuer is read from the authorization-server document
    //     there, falling back to `deriveTenantIssuer`.
    //
    //  3. Standalone deployments point at one environment. IAM derives its
    //     issuer from its own base URI, so the configured value is the issuer
    //     and the request host must not override it.
    let effectiveAuthorizationServer: string;
    if (isDiscoveryWorkaroundEnabled) {
      effectiveAuthorizationServer = withNamespace(
        deriveThisServerOrigin(req),
        namespace,
      );
    } else if (hostedMode) {
      const tenantOrigin = toOrigin(
        deriveBaseUrl(req, normalizedAuthorizationServerUrl, {
          allowHostedContext: false,
        }),
      );
      effectiveAuthorizationServer =
        (await resolveIssuerIdentifier(tenantOrigin, namespace)) ??
        deriveTenantIssuer(tenantOrigin, namespace);
    } else {
      effectiveAuthorizationServer = withNamespace(
        normalizedAuthorizationServerUrl,
        namespace,
      );
    }
    // `resource` stays host-aware by contrast: RFC 9728 requires it to match
    // the public URL the client actually connected to. There is no same-origin
    // requirement between the two fields.
    //
    // Normalized on the same grounds as the issuer, and only on the configured
    // fallback — the forwarded-host branch already yields a bare origin. A
    // configured `https://mcp.example/` otherwise advertised
    // `https://mcp.example//mcp`, and RFC 9728 §3.3 has the client discard
    // metadata whose `resource` is not identical to the URL it requested. Not
    // reduced to an origin the way the issuer is: a deployment mounted under a
    // sub-path legitimately carries that path here.
    //
    // Stripped only when something is appended. At a root mount
    // (`MCP_PATH="/"`) with no namespace nothing is, and the configured value
    // is then the whole answer — normalizing `https://mcp.example/` down to
    // `https://mcp.example` there would advertise a resource that is not
    // identical to the URL the client requested, which is the very failure
    // this normalization exists to prevent.
    const appendsToResourceBase = Boolean(mcpBasePath) || Boolean(namespace);
    const resourceBaseUrl = deriveBaseUrl(
      req,
      appendsToResourceBase ? normalizedResourceServerUrl : resourceServerUrl,
      { allowHostedContext: !hostedMode },
    );

    const protectedResourceUrl = namespace
      ? `${resourceBaseUrl}${mcpBasePath}/${namespace}`
      : `${resourceBaseUrl}${mcpBasePath}`;

    const metadata: OAuthProtectedResourceMetadata = {
      resource: protectedResourceUrl,
      authorization_servers: [effectiveAuthorizationServer],
      bearer_methods_supported: ["header"],
      scopes_supported: PROTECTED_RESOURCE_SCOPES_SUPPORTED,
    };
    res.status(200).json(metadata);
  };

  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);

  // RFC 9728 path-aware discovery probes
  // /.well-known/oauth-protected-resource<resource-path> before falling back to
  // the root document. Without this exact route, a resource path like "/mcp"
  // collides with the namespace-aware route below and gets misinterpreted as
  // namespace="mcp", producing resource="/mcp/mcp".
  if (pathAwareProtectedResourceRoute) {
    app.get(pathAwareProtectedResourceRoute, protectedResourceHandler);
  }

  // Namespace-aware protected resource metadata. When a namespace is present,
  // authorization_servers includes the namespace as a path component so that
  // MCP clients discover the namespace-specific authorization server. This is
  // a custom convention (not defined by RFC 9728) to support multi-tenant
  // namespace routing.
  //
  // Keep the short route as the target for reverse proxies that strip the MCP
  // path, and also serve the full RFC 9728 path for direct deployments.
  app.get(
    "/.well-known/oauth-protected-resource/:namespace",
    protectedResourceHandler,
  );
  if (pathAwareProtectedResourceRoute) {
    app.get(
      `${pathAwareProtectedResourceRoute}/:namespace`,
      protectedResourceHandler,
    );
  }

  if (isDiscoveryWorkaroundEnabled) {
    const oauthAuthServerHandler = async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const { namespace } = req.params;

        // Validate namespace if present to prevent path traversal / URL injection
        if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
          res.status(400).json({
            error: "Bad Request",
            message: "Invalid namespace",
          });
          return;
        }

        const baseUrl = normalizedAuthorizationServerUrl;
        const metadataUrl = namespace
          ? `${baseUrl}/.well-known/oauth-authorization-server/${namespace}`
          : `${baseUrl}/.well-known/oauth-authorization-server`;

        // In `proxyRegister` the advertised registration endpoint must point at
        // this server's registration proxy, on the same origin the metadata
        // named as the authorization server. Applied per response rather than
        // per fetch: the cache holds the upstream document verbatim, keyed by
        // upstream URL, so rewriting before caching would both leak one
        // request's origin into every later response and skip the rewrite
        // entirely on a cache hit — leaving clients pointed at the upstream
        // cross-origin endpoint for the rest of the TTL, which is exactly the
        // registration the mode exists to intercept.
        const withProxiedRegistration = (
          metadata: Record<string, unknown>,
        ): Record<string, unknown> => {
          if (
            authorizationServerDiscoveryMode !==
            AuthorizationServerDiscoveryMode.ProxyRegister
          ) {
            return metadata;
          }
          const registrationPath = namespace
            ? `/oauth/namespaces/${namespace}/register`
            : `/oauth/register`;
          return {
            ...metadata,
            registration_endpoint: `${deriveThisServerOrigin(req)}${registrationPath}`,
          };
        };

        if (
          authorizationServerDiscoveryMode ===
          AuthorizationServerDiscoveryMode.Redirect
        ) {
          // Use 307 (Temporary Redirect) to preserve HTTP method
          // This is appropriate for OAuth discovery redirects
          res.redirect(307, metadataUrl);
        } else if (
          authorizationServerDiscoveryMode ===
            AuthorizationServerDiscoveryMode.Proxy ||
          authorizationServerDiscoveryMode ===
            AuthorizationServerDiscoveryMode.ProxyRegister
        ) {
          // Check cache first
          const cached = metadataCache.get(metadataUrl);
          if (cached && cached.expiresAt > Date.now()) {
            log.debug({ metadataUrl }, "Returning cached metadata");
            res.status(200).json(withProxiedRegistration(cached.metadata));
            return;
          }

          // SSRF guard: prevent proxy fetches to private/internal addresses
          await assertNotPrivateUrl(new URL(metadataUrl));

          // Fetch with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(
            () => controller.abort(),
            METADATA_FETCH_TIMEOUT_MS,
          );

          try {
            const response = await fetch(metadataUrl, {
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              log.error(
                { metadataUrl, status: response.status },
                "Authorization server returned error",
              );
              res.status(502).json({
                error: "Bad Gateway",
                message: "Authorization server returned an error",
              });
              return;
            }

            // Validate content type
            const contentType = response.headers.get("content-type");
            if (!contentType?.includes("application/json")) {
              log.error(
                { metadataUrl, contentType },
                "Authorization server returned non-JSON response",
              );
              res.status(502).json({
                error: "Bad Gateway",
                message: "Authorization server returned invalid content type",
              });
              return;
            }

            const metadata: unknown = await response.json();

            if (!isMetadataObject(metadata)) {
              log.error(
                { metadataUrl, type: typeof metadata },
                "Authorization server returned a non-object metadata document",
              );
              res.status(502).json({
                error: "Bad Gateway",
                message: "Authorization server returned invalid metadata",
              });
              return;
            }

            // Cache the result
            metadataCache.set(metadataUrl, {
              metadata,
              expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
            });

            log.debug({ metadataUrl }, "Fetched and cached metadata");

            res.status(200).json(withProxiedRegistration(metadata));
          } catch (fetchError) {
            clearTimeout(timeoutId);

            if (
              fetchError instanceof Error &&
              fetchError.name === "AbortError"
            ) {
              log.error({ metadataUrl }, "Metadata fetch timed out");
              res.status(504).json({
                error: "Gateway Timeout",
                message: "Authorization server did not respond in time",
              });
              return;
            }

            throw fetchError;
          }
        }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : error },
          "Error in OAuth authorization server proxy",
        );
        next(error);
      }
    };

    app.get("/.well-known/oauth-authorization-server", oauthAuthServerHandler);

    if (pathAwareAuthorizationServerRoute) {
      app.get(pathAwareAuthorizationServerRoute, oauthAuthServerHandler);
    }

    app.get(
      "/.well-known/oauth-authorization-server/:namespace",
      oauthAuthServerHandler,
    );

    // TEMPORARY WORKAROUND: Proxy registration endpoint for ProxyRegister mode.
    // Proxies OAuth dynamic client registration to the actual auth server.
    // TODO: Remove once MCP clients properly support cross-origin OAuth discovery.
    if (
      authorizationServerDiscoveryMode ===
      AuthorizationServerDiscoveryMode.ProxyRegister
    ) {
      const baseUrl = normalizedAuthorizationServerUrl;

      const oauthRegisterHandler = async (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => {
        try {
          const { namespace } = req.params;

          // Validate namespace if present to prevent path traversal / URL injection
          if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
            res.status(400).json({
              error: "Bad Request",
              message: "Invalid namespace",
            });
            return;
          }

          log.debug(
            {
              namespace,
              headers: {
                "content-type": req.get("Content-Type"),
                "user-agent": req.get("User-Agent"),
              },
            },
            "Incoming OAuth registration request (proxied)",
          );

          // Resolve actual registration endpoint from metadata
          const metadataUrl = namespace
            ? `${baseUrl}/.well-known/oauth-authorization-server/${namespace}`
            : `${baseUrl}/.well-known/oauth-authorization-server`;
          let registrationEndpoint = namespace
            ? `${baseUrl}/iam/v3/namespace/${namespace}/oauth/register`
            : `${baseUrl}/iam/v3/oauth/register`; // fallback

          // SSRF guard: prevent registration proxy fetches to private/internal addresses
          await assertNotPrivateUrl(new URL(metadataUrl));

          const metaController = new AbortController();
          const metaTimeoutId = setTimeout(
            () => metaController.abort(),
            METADATA_FETCH_TIMEOUT_MS,
          );
          try {
            const metadataResponse = await fetch(metadataUrl, {
              signal: metaController.signal,
            });
            clearTimeout(metaTimeoutId);
            if (metadataResponse.ok) {
              const metadata = await metadataResponse.json();
              if (metadata.registration_endpoint) {
                registrationEndpoint = metadata.registration_endpoint;
              }
            }
          } catch (metadataError) {
            clearTimeout(metaTimeoutId);
            log.warn(
              { error: metadataError },
              "Failed to fetch metadata for registration endpoint, using default",
            );
          }

          // SSRF guard: validate the registration endpoint (may come from upstream metadata)
          await assertNotPrivateUrl(new URL(registrationEndpoint));

          log.debug(
            { registrationEndpoint, namespace },
            "Forwarding registration request to auth server",
          );

          const regController = new AbortController();
          const regTimeoutId = setTimeout(
            () => regController.abort(),
            METADATA_FETCH_TIMEOUT_MS,
          );

          let response: globalThis.Response;
          try {
            response = await fetch(registrationEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(req.body),
              signal: regController.signal,
            });
          } catch (fetchErr) {
            clearTimeout(regTimeoutId);
            if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
              log.error(
                { registrationEndpoint },
                "Registration proxy fetch timed out",
              );
              res.status(504).json({
                error: "Gateway Timeout",
                message: "Authorization server did not respond in time",
              });
              return;
            }
            throw fetchErr;
          }
          clearTimeout(regTimeoutId);

          const data = await response.json();

          log.debug(
            {
              status: response.status,
              hasClientId: !!data.client_id,
            },
            "OAuth registration response received",
          );

          res.status(response.status).json(data);
        } catch (error) {
          log.error({ error }, "OAuth registration proxy error");
          next(error);
        }
      };

      app.post("/oauth/register", oauthRegisterHandler);
      app.post("/oauth/namespaces/:namespace/register", oauthRegisterHandler);
    }
  }
}

export { AuthorizationServerDiscoveryMode, type RegisterOAuthRoutesOptions };
export default registerOAuthRoutes;
