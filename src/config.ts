import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine project root directory
// In development (src/), __dirname is the src directory
// In production (dist/), __dirname is the dist directory
// We need to go up one level from dist or stay at src's parent
const isCompiledCode = __dirname.endsWith("dist");
const projectRoot = isCompiledCode
  ? path.resolve(__dirname, "..")
  : path.resolve(__dirname, "..");

// Load environment variables from project root
dotenv.config({ path: path.join(projectRoot, ".env") });

export interface Config {
  // Server Configuration
  port: number;
  nodeEnv: string;
  logLevel: string;
  transport: "http" | "stdio";
  baseUrl: string;

  // OpenAPI configuration
  openapi: {
    specsDir: string;
    defaultSearchLimit: number;
    defaultServerUrl?: string;
    includeWriteRequests: boolean;
  };

  // OAuth Configuration
  oauth: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authorizationUrl: string;
    tokenUrl: string;
    enableClientCredentialsFallback: boolean;
  };

  // OIDC Configuration
  oidc: {
    jwksUri: string;
    issuer: string;
    audience: string;
    algorithms: string[];
  };
}

// Environment variable validation
function validateEnvVar(
  name: string,
  value: string | undefined,
  required: boolean = true,
): string {
  if (required && (!value || value.trim() === "")) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value || "";
}

function validatePort(portStr: string | undefined): number {
  const port = parseInt(portStr || "3000", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port number: ${portStr}. Must be between 1 and 65535`,
    );
  }
  return port;
}

function validateLogLevel(level: string | undefined): string {
  const validLevels = ["fatal", "error", "warn", "info", "debug", "trace"];
  const logLevel = level || "info";
  if (!validLevels.includes(logLevel)) {
    throw new Error(
      `Invalid log level: ${logLevel}. Must be one of: ${validLevels.join(", ")}`,
    );
  }
  return logLevel;
}

function validateBoolean(
  value: string | undefined,
  defaultValue: boolean = false,
): boolean {
  if (!value) return defaultValue;
  const lowerValue = value.toLowerCase();
  return lowerValue === "true" || lowerValue === "1" || lowerValue === "yes";
}

function validateTransport(value: string | undefined): "http" | "stdio" {
  const transport = (value || "stdio").toLowerCase();
  if (transport !== "http" && transport !== "stdio") {
    throw new Error(
      `Invalid transport: ${transport}. Must be 'http' or 'stdio'`,
    );
  }
  return transport as "http" | "stdio";
}

function validatePositiveInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`);
  }
  return parsed;
}

/**
 * Normalize an OAuth issuer identifier.
 *
 * The issuer is advertised in `authorization_servers` (RFC 9728) and in the
 * `issuer` field of the RFC 8414 documents, and RFC 8414 §3.3 requires it to
 * be *byte-identical* to what the authorization server returns. AGS IAM emits
 * no trailing slash, so an `AB_BASE_URL` or `JWT_ISSUER` carrying one silently
 * fails that comparison on any client that checks — the same defect class as
 * the trailing-slash bug fixed in v2. Surrounding whitespace comes from
 * hand-edited env files and is never intentional.
 *
 * Exported for direct testing: the config module resolves once at import, so
 * this is the only way to cover the cases without env-mutation games.
 */
export function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * True when the value can serve as an OAuth issuer identifier: an absolute
 * http(s) URL carrying no query, fragment, or embedded credentials. Anything
 * else cannot have `.well-known` inserted into it per RFC 8414 §3.
 */
export function isUsableIssuer(value: string): boolean {
  // Checked on the raw string, not only the parsed URL: Node reports empty
  // `.search`/`.hash` for `https://iam.example?` and `https://iam.example#`,
  // yet RFC 8414 §2 forbids query and fragment components in an issuer
  // identifier, and the bare delimiter is one.
  if (value.includes("?") || value.includes("#")) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

// Load and validate configuration
function loadConfig(): Config {
  try {
    // Get AB_BASE_URL for building default URLs
    const abBaseUrl =
      validateEnvVar("AB_BASE_URL", process.env.AB_BASE_URL, false) ||
      "https://yourgame.accelbyte.io";

    // Construct baseUrl from ADVERTISED_* env variables
    const advertisedProtocol = process.env.ADVERTISED_PROTOCOL || "http";
    const advertisedHostname = process.env.ADVERTISED_HOSTNAME || "localhost";
    const advertisedPort =
      process.env.ADVERTISED_PORT || process.env.PORT || "3000";
    const baseUrl =
      advertisedPort !== "80" && advertisedPort !== "443"
        ? `${advertisedProtocol}://${advertisedHostname}:${advertisedPort}`
        : `${advertisedProtocol}://${advertisedHostname}`;

    // Determine transport mode first so we can use it for other config values
    const transport = validateTransport(process.env.TRANSPORT);

    const config: Config = {
      // Server Configuration
      port: validatePort(process.env.PORT),
      nodeEnv:
        validateEnvVar("NODE_ENV", process.env.NODE_ENV, false) ||
        "development",
      logLevel: validateLogLevel(process.env.LOG_LEVEL),
      transport,
      baseUrl,

      // OpenAPI configuration
      openapi: {
        specsDir: (() => {
          const specsDirEnv =
            validateEnvVar(
              "OPENAPI_SPECS_DIR",
              process.env.OPENAPI_SPECS_DIR,
              false,
            ) || "openapi-specs";
          // If it's already an absolute path, use it as is, otherwise resolve relative to project root
          return path.isAbsolute(specsDirEnv)
            ? specsDirEnv
            : path.resolve(projectRoot, specsDirEnv);
        })(),
        defaultSearchLimit: validatePositiveInteger(
          "OPENAPI_DEFAULT_SEARCH_LIMIT",
          process.env.OPENAPI_DEFAULT_SEARCH_LIMIT,
          5,
        ),
        defaultServerUrl: abBaseUrl,
        includeWriteRequests: validateBoolean(
          process.env.INCLUDE_WRITE_REQUESTS,
          true,
        ),
      },

      // OAuth Configuration
      oauth: {
        clientId: validateEnvVar(
          "OAUTH_CLIENT_ID",
          process.env.OAUTH_CLIENT_ID,
          false,
        ),
        clientSecret: validateEnvVar(
          "OAUTH_CLIENT_SECRET",
          process.env.OAUTH_CLIENT_SECRET,
          false,
        ),
        redirectUri:
          validateEnvVar(
            "OAUTH_REDIRECT_URI",
            process.env.OAUTH_REDIRECT_URI,
            false,
          ) || `${baseUrl}/oauth/callback`,
        authorizationUrl:
          validateEnvVar(
            "OAUTH_AUTHORIZATION_URL",
            process.env.OAUTH_AUTHORIZATION_URL,
            false,
          ) || `${abBaseUrl}/iam/v3/oauth/authorize`,
        tokenUrl:
          validateEnvVar(
            "OAUTH_TOKEN_URL",
            process.env.OAUTH_TOKEN_URL,
            false,
          ) || `${abBaseUrl}/iam/v3/oauth/token`,
        // Always enable client credentials fallback in stdio mode, respect flag in HTTP mode (default: true)
        enableClientCredentialsFallback:
          transport === "stdio"
            ? true
            : validateBoolean(
                process.env.ENABLE_CLIENT_CREDENTIALS_FALLBACK,
                true,
              ),
      },

      // OIDC Configuration
      oidc: {
        jwksUri:
          validateEnvVar("JWKS_URI", process.env.JWKS_URI, false) ||
          `${abBaseUrl}/iam/v3/oauth/jwks`,
        issuer: normalizeIssuer(
          validateEnvVar("JWT_ISSUER", process.env.JWT_ISSUER, false) ||
            abBaseUrl,
        ),
        audience:
          validateEnvVar("JWT_AUDIENCE", process.env.JWT_AUDIENCE, false) ||
          "NOT_SET",
        algorithms: process.env.JWT_ALGORITHMS
          ? process.env.JWT_ALGORITHMS.split(",")
          : ["RS256"],
      },
    };

    // Log configuration status
    logger.info(
      {
        projectRoot,
        port: config.port,
        nodeEnv: config.nodeEnv,
        logLevel: config.logLevel,
        transport: config.transport,
        openapiSpecsDir: config.openapi.specsDir,
        openapiDefaultServerUrl: config.openapi.defaultServerUrl,
        includeWriteRequests: config.openapi.includeWriteRequests,
        oauthConfigured: !!(
          config.oauth.clientId && config.oauth.authorizationUrl
        ),
        enableClientCredentialsFallback:
          config.oauth.enableClientCredentialsFallback,
        oidcConfigured: !!(config.oidc.jwksUri && config.oidc.issuer),
      },
      "Configuration loaded",
    );

    // Warn about missing OAuth configuration
    if (!config.oauth.clientId || !config.oauth.authorizationUrl) {
      logger.warn(
        "OAuth configuration is incomplete. Authentication will be disabled.",
      );
      logger.warn(
        "Set OAUTH_CLIENT_ID and OAUTH_AUTHORIZATION_URL to enable OAuth.",
      );
    }

    // Checked BEFORE the incompleteness warning below, which tests
    // `!config.oidc.issuer` and would otherwise swallow precisely this case:
    // an empty issuer is "missing configuration" by that test, so it would
    // warn and carry on.
    //
    // An empty issuer is not merely missing — it is unsafe. This value is
    // handed to the JWT verifier as its `issuer` option, and `jsonwebtoken`
    // skips issuer validation entirely when that option is falsy. So a
    // `JWT_ISSUER` of "   " normalizes to "" and turns the `iss` check *off*
    // rather than failing it, silently accepting tokens from any issuer. A log
    // line cannot make that safe, so it is fatal. The value cannot be empty by
    // accident: it falls back through `AB_BASE_URL` to a non-empty default, so
    // reaching here means someone configured whitespace.
    if (!config.oidc.issuer) {
      throw new Error(
        "JWT_ISSUER resolved to an empty value (check JWT_ISSUER and AB_BASE_URL for a blank or whitespace-only setting). " +
          "It is used to validate the token `iss` claim, and an empty issuer disables that check entirely instead of failing it.",
      );
    }

    // Warn about missing OIDC configuration
    if (!config.oidc.jwksUri) {
      logger.warn(
        "OIDC configuration is incomplete. Set JWKS_URI and JWT_ISSUER environment variables.",
      );
    } else if (!isUsableIssuer(config.oidc.issuer)) {
      // Non-empty but unusable — a query, fragment, embedded credentials, or
      // not a URL at all. Unlike the empty case this does not fail open:
      // jsonwebtoken exact-compares any truthy issuer, so tokens are still
      // checked against this exact string. What breaks is OAuth discovery,
      // which cannot build a `.well-known` URL from it. Warn rather than
      // throw, so a v1 deployment that never reaches the discovery endpoints
      // is not stopped from starting over a value it does not use.
      logger.warn(
        { issuer: config.oidc.issuer },
        "JWT_ISSUER is not a usable OAuth issuer identifier (needs an absolute http(s) URL with no query, fragment, or credentials). Token validation still exact-matches this string, but OAuth discovery will fail RFC 8414 §3.3 issuer matching.",
      );
    }

    return config;
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to load configuration",
    );
    process.exit(1);
  }
}

// Export the configuration
export const config = loadConfig();

// Export individual config sections for convenience
export const serverConfig = {
  port: config.port,
  nodeEnv: config.nodeEnv,
  logLevel: config.logLevel,
  baseUrl: config.baseUrl,
};

export const oauthConfig = config.oauth;
export const oidcConfig = config.oidc;
export const openApiConfig = config.openapi;
