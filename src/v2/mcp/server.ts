// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Config } from "../config.js";
import setupApiTools from "./tools/api.js";
import setupAuthTools from "./tools/auth.js";

function createServer(
  name: string,
  version: string,
  config: Config,
): McpServer {
  const server = new McpServer({ name, version });

  setupApiTools(server, config);
  setupAuthTools(server);

  return server;
}

export default createServer;
