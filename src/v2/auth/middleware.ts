// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Request, RequestHandler } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

interface TokenPayload extends JwtPayload {
  client_id?: string;
  exp?: number;
  scope?: string | string[];
}

function setAuthFromToken(): RequestHandler {
  return async (req, _, next) => {
    const authHeader = (req as Request).headers?.authorization;
    const [scheme, token] =
      typeof authHeader === "string" ? authHeader.split(" ") : [];

    // Only proceed if Authorization header is in the form "Bearer <JWT>"
    const isBearer =
      typeof scheme === "string" && scheme.toLowerCase() === "bearer";
    const looksLikeJwt =
      typeof token === "string" && token.split(".").length === 3;

    if (isBearer && looksLikeJwt) {
      try {
        const decoded = jwt.decode(token) as TokenPayload | null;

        if (decoded) {
          const clientId =
            typeof decoded.client_id === "string" ? decoded.client_id : "";

          const expiresAt =
            typeof decoded.exp === "number" ? decoded.exp : undefined;

          let scopes: string[] = [];
          if (Array.isArray(decoded.scope) && decoded.scope.length > 0) {
            scopes = decoded.scope;
          } else if (typeof decoded.scope === "string") {
            scopes = decoded.scope.split(" ");
          }

          (req as Request & { auth?: AuthInfo }).auth = {
            token,
            clientId,
            scopes,
            expiresAt,
          } satisfies AuthInfo;
        }
      } catch {
        // If decoding fails, leave req.auth undefined and continue
      }
    }

    next();
  };
}

export default setAuthFromToken;
