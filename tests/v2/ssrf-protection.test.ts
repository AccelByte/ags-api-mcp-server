import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenApiTools } from "../../src/tools/openapi-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specsDir = path.join(__dirname, "fixtures-ssrf");

/**
 * The no-server-api.yaml fixture has an empty servers list, so
 * `defaultServerUrl` controls the base URL used by runApi().
 * assertNotPrivateUrl() runs before the actual HTTP call.
 */
function createToolsWithServer(serverUrl: string) {
  return new OpenApiTools({
    specsDir,
    defaultServerUrl: serverUrl,
  });
}

describe("SSRF private IP blocking", () => {
  // ----- IPv4 private ranges -----
  const blockedIPv4 = [
    ["127.0.0.1", "loopback"],
    ["127.100.200.1", "loopback range"],
    ["10.0.0.1", "RFC 1918 Class A"],
    ["10.255.255.255", "RFC 1918 Class A (high)"],
    ["172.16.0.1", "RFC 1918 Class B (low)"],
    ["172.31.255.255", "RFC 1918 Class B (high)"],
    ["192.168.0.1", "RFC 1918 Class C"],
    ["192.168.255.255", "RFC 1918 Class C (high)"],
    ["169.254.169.254", "link-local / AWS metadata"],
    ["169.254.0.1", "link-local"],
    ["100.64.0.1", "CGNAT"],
    ["100.127.255.255", "CGNAT (high)"],
    ["198.18.0.1", "benchmarking (low)"],
    ["198.19.255.255", "benchmarking (high)"],
    ["0.0.0.0", "unspecified"],
    ["255.255.255.255", "broadcast"],
  ] as const;

  for (const [ip, label] of blockedIPv4) {
    test(`blocks IPv4 ${ip} (${label})`, async () => {
      const tools = createToolsWithServer(`http://${ip}`);
      await assert.rejects(
        tools.runApi({
          spec: "no-server-api",
          method: "get",
          path: "/ping",
        }),
        /private\/internal address/i,
      );
    });
  }

  // ----- IPv6 private ranges -----
  // Note: URL normalises ::ffff:a.b.c.d to hex form (::ffff:XXYY:ZZWW).
  // extractIPv4FromMappedIPv6 converts these back to dotted-decimal for matching.
  const blockedIPv6 = [
    ["[::1]", "IPv6 loopback"],
    ["[::ffff:7f00:1]", "IPv4-mapped loopback (hex)"],
    ["[::ffff:a00:1]", "IPv4-mapped RFC 1918 A (hex)"],
    ["[::ffff:c0a8:101]", "IPv4-mapped RFC 1918 C (hex)"],
    ["[::ffff:ac10:1]", "IPv4-mapped RFC 1918 B (hex)"],
    ["[fe80::1]", "IPv6 link-local"],
    ["[fc00::1]", "IPv6 unique local (fc)"],
    ["[fd12::1]", "IPv6 unique local (fd)"],
  ] as const;

  for (const [ip, label] of blockedIPv6) {
    test(`blocks IPv6 ${ip} (${label})`, async () => {
      const tools = createToolsWithServer(`http://${ip}`);
      await assert.rejects(
        tools.runApi({
          spec: "no-server-api",
          method: "get",
          path: "/ping",
        }),
        /private\/internal address/i,
      );
    });
  }

  // ----- Hostnames -----
  const blockedHostnames = [
    ["localhost", "localhost"],
    ["sub.localhost", "*.localhost subdomain"],
    ["metadata.google.internal", "GCP metadata"],
  ] as const;

  for (const [host, label] of blockedHostnames) {
    test(`blocks hostname ${host} (${label})`, async () => {
      const tools = createToolsWithServer(`http://${host}`);
      await assert.rejects(
        tools.runApi({
          spec: "no-server-api",
          method: "get",
          path: "/ping",
        }),
        /private\/internal address/i,
      );
    });
  }

  // ----- Allowed public addresses -----
  const allowedAddresses = [
    "https://development.accelbyte.io",
    "https://api.example.com",
    "https://8.8.8.8",
    "https://172.32.0.1", // just outside RFC 1918 Class B
    "https://100.128.0.1", // just outside CGNAT
    "https://192.169.0.1", // just outside RFC 1918 Class C
  ];

  for (const addr of allowedAddresses) {
    test(`allows public address ${addr}`, async () => {
      const tools = createToolsWithServer(addr);
      // runApi will fail at the HTTP call (no real server), but it should NOT
      // fail with the SSRF error — any other error means the URL passed the check.
      try {
        await tools.runApi({
          spec: "no-server-api",
          method: "get",
          path: "/ping",
        });
      } catch (err: any) {
        assert.ok(
          !/private\/internal address/i.test(err.message),
          `public address ${addr} should not be blocked, got: ${err.message}`,
        );
      }
    });
  }
});
