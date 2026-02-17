// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { defaultLogger } from "./logger.js";

const securityLogger = defaultLogger.child({ component: "security" });

interface AuthFailureDetails {
  ip: string | undefined;
  reason: string;
  agsBaseUrl?: string;
  path?: string;
}

interface AuthSuccessDetails {
  ip: string | undefined;
  clientId: string;
  scopeCount: number;
}

interface SuspiciousRequestDetails {
  ip: string | undefined;
  reason: string;
  host?: string;
  tokenIssuer?: string;
  derivedUrl?: string;
  path?: string;
}

interface RateLimitDetails {
  ip: string | undefined;
}

const securityLog = {
  authFailure(details: AuthFailureDetails): void {
    securityLogger.warn(
      { event: "auth_failure", ...details },
      "Authentication failure: %s",
      details.reason,
    );
  },

  authSuccess(details: AuthSuccessDetails): void {
    securityLogger.info(
      { event: "auth_success", ...details },
      "Authentication success for client %s",
      details.clientId,
    );
  },

  suspiciousRequest(details: SuspiciousRequestDetails): void {
    securityLogger.warn(
      { event: "suspicious_request", ...details },
      "Suspicious request: %s",
      details.reason,
    );
  },

  rateLimitExceeded(details: RateLimitDetails): void {
    securityLogger.warn(
      { event: "rate_limit_exceeded", ...details },
      "Rate limit exceeded",
    );
  },
};

export default securityLog;
