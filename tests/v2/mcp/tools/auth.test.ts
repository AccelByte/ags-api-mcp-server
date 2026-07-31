import assert from "node:assert/strict";
import { describe, test } from "node:test";
import jwt from "jsonwebtoken";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import setupAuthTools from "../../../../src/v2/mcp/tools/auth.js";

interface CapturedAuthTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedAuthTool) {
  return {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: ToolCallback<Record<string, z.ZodTypeAny>>,
    ): RegisteredTool {
      captured.name = name;
      captured.config = config;
      captured.callback = callback;
      return {} as RegisteredTool;
    },
  };
}

function signFixture(payload: Record<string, unknown>) {
  return jwt.sign(payload, "test-secret", { algorithm: "HS256" });
}

function setup() {
  const captured = {} as CapturedAuthTool;
  setupAuthTools(createCapturingServer(captured) as never);
  return captured;
}

const USER_TOKEN_PAYLOAD = {
  iss: "https://development.accelbyte.io",
  sub: "7d9e128b97a0402c856b194e20e7cdef",
  client_id: "7d1a6384e7174b7d946e1c0572bbd756",
  country: "US",
  display_name: "",
  is_comply: true,
  jflgs: 1,
  namespace: "extendapptest",
  namespace_roles: [
    { namespace: "extendapptest", roleId: "31985c2aa61b4940b16c8e3421574e0d" },
  ],
  permissions: [{ Action: 2, Resource: "ADMIN:NAMESPACE:accelbyte:NAMESPACE" }],
  roles: [],
  bans: [],
  scope: "commerce account social publishing analytics",
  union_id: "97228a69d6214523b29bf0145b8a38f3",
  union_namespace: "accelbyte",
};

const CLIENT_CREDENTIALS_PAYLOAD = {
  iss: "https://development.accelbyte.io",
  client_id: "some-client-id",
  namespace: "accelbyte",
  permissions: [{ Action: 2, Resource: "ADMIN:NAMESPACE:accelbyte:NAMESPACE" }],
  scope: "account",
};

describe("get_token_info", () => {
  test("registers the tool as get_token_info", () => {
    const captured = setup();
    assert.equal(captured.name, "get_token_info");
  });

  test("throws when no token is present", async () => {
    const captured = setup();
    await assert.rejects(() => captured.callback({}, { authInfo: {} }));
  });

  test("classifies a token carrying subject claims as user_token and omits refresh/grant fields", async () => {
    const captured = setup();
    const token = signFixture(USER_TOKEN_PAYLOAD);

    const result = await captured.callback(
      {},
      { authInfo: { token } },
    );

    const claims = result.structuredContent.claims as Record<string, unknown>;
    const metadata = result.structuredContent.metadata as Record<
      string,
      unknown
    >;

    assert.equal(metadata.type, "user_token");

    // Fields that cannot be populated from a JWT must be absent.
    assert.equal(metadata.lengthRefresh, undefined);
    assert.equal(metadata.maskedRefresh, undefined);
    assert.equal(metadata.isRefreshExpired, undefined);
    assert.equal(claims.refreshExpiresIn, undefined);
    assert.equal(claims.expiresIn, undefined);
    assert.equal(claims.grantType, undefined);
    assert.equal(claims.userId, undefined);

    // Previously-discarded claims must now be surfaced.
    assert.deepEqual(claims.namespaceRoles, USER_TOKEN_PAYLOAD.namespace_roles);
    assert.deepEqual(claims.bans, USER_TOKEN_PAYLOAD.bans);
    assert.equal(claims.jflgs, USER_TOKEN_PAYLOAD.jflgs);
    assert.equal(claims.unionId, USER_TOKEN_PAYLOAD.union_id);
    assert.equal(claims.unionNamespace, USER_TOKEN_PAYLOAD.union_namespace);

    // An empty display_name claim should not surface as a displayName field.
    assert.equal(claims.displayName, undefined);
  });

  test("classifies a token carrying only client_id as client_credentials", async () => {
    const captured = setup();
    const token = signFixture(CLIENT_CREDENTIALS_PAYLOAD);

    const result = await captured.callback(
      {},
      { authInfo: { token } },
    );

    const metadata = result.structuredContent.metadata as Record<
      string,
      unknown
    >;
    assert.equal(metadata.type, "client_credentials");
  });

  test("passes output validation for a token with neither roles nor permissions", async () => {
    const captured = setup();
    const token = signFixture({
      iss: "https://development.accelbyte.io",
      client_id: "some-client-id",
    });

    const result = await captured.callback(
      {},
      { authInfo: { token } },
    );

    assert.equal(
      (result.structuredContent.claims as Record<string, unknown>)?.roles,
      undefined,
    );
    assert.equal(
      (result.structuredContent.claims as Record<string, unknown>)
        ?.permissions,
      undefined,
    );
  });
});
