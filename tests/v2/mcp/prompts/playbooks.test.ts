// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseFrontmatter,
  firstHeading,
  buildDisplayTitle,
  describePlaybook,
  loadPlaybooks,
} from "../../../../src/v2/mcp/prompts/playbooks.js";

describe("parseFrontmatter", () => {
  it("extracts a bare title and strips the frontmatter block from the body", () => {
    const { title, body } = parseFrontmatter("---\ntitle: Athena\n---\n# Heading\n");
    assert.equal(title, "Athena");
    assert.equal(body, "# Heading\n");
  });

  it("strips matched double and single quotes", () => {
    assert.equal(parseFrontmatter('---\ntitle: "Athena"\n---\nbody').title, "Athena");
    assert.equal(parseFrontmatter("---\ntitle: 'Athena'\n---\nbody").title, "Athena");
  });

  it("leaves mismatched quotes intact instead of silently stripping them", () => {
    // Regression guard: a backreference-free regex would corrupt this to `foo`.
    assert.equal(parseFrontmatter("---\ntitle: \"foo'\n---\nbody").title, "\"foo'");
  });

  it("handles CRLF line endings", () => {
    const { title, body } = parseFrontmatter("---\r\ntitle: Athena\r\n---\r\nbody");
    assert.equal(title, "Athena");
    assert.equal(body, "body");
  });

  it("returns the whole content as body when no frontmatter is present", () => {
    const content = "# Just a heading\n\nProse.";
    const { title, body } = parseFrontmatter(content);
    assert.equal(title, undefined);
    assert.equal(body, content);
  });

  it("returns undefined title when frontmatter has no title field", () => {
    const { title } = parseFrontmatter("---\nother: value\n---\nbody");
    assert.equal(title, undefined);
  });

  it("treats an empty title value as undefined", () => {
    const { title } = parseFrontmatter("---\ntitle:\n---\nbody");
    assert.equal(title, undefined);
  });
});

describe("firstHeading", () => {
  it("returns the first H1 text", () => {
    assert.equal(firstHeading("intro\n# The Title\nmore"), "The Title");
  });

  it("returns undefined when there is no H1", () => {
    assert.equal(firstHeading("## Subheading only\ntext"), undefined);
  });
});

describe("buildDisplayTitle", () => {
  it("wraps a plain topic as 'Run <topic> Playbook'", () => {
    assert.equal(buildDisplayTitle("AFS Analytics"), "Run AFS Analytics Playbook");
  });

  it("does not duplicate the word Playbook", () => {
    assert.equal(buildDisplayTitle("Onboarding Playbook"), "Run Onboarding Playbook");
    assert.equal(buildDisplayTitle("onboarding playbook"), "Run onboarding playbook");
  });
});

describe("describePlaybook", () => {
  it("prefers the frontmatter title over the H1", () => {
    const pb = describePlaybook(
      "afs",
      "---\ntitle: AFS Analytics\n---\n# Some Other Heading Playbook\n",
    );
    assert.equal(pb.topic, "AFS Analytics");
    assert.equal(pb.displayTitle, "Run AFS Analytics Playbook");
  });

  it("falls back to the H1 with a trailing ' Playbook' stripped", () => {
    const pb = describePlaybook("afs", "# AFS Analytics Playbook\n\nbody");
    assert.equal(pb.topic, "AFS Analytics");
    assert.equal(pb.displayTitle, "Run AFS Analytics Playbook");
  });

  it("falls back to the filename id when there is no title or H1", () => {
    const pb = describePlaybook("afs", "plain prose, no heading");
    assert.equal(pb.topic, "afs");
    assert.equal(pb.displayTitle, "Run afs Playbook");
  });

  it("falls back correctly when frontmatter is malformed (no closing fence)", () => {
    // No closing `---`, so the whole thing is body; H1 drives the topic.
    const pb = describePlaybook("afs", "---\ntitle: Ignored\n# Real Heading\nbody");
    assert.equal(pb.topic, "Real Heading");
    assert.equal(pb.body, "---\ntitle: Ignored\n# Real Heading\nbody");
  });
});

describe("loadPlaybooks", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "playbooks-test-"));
    await writeFile(join(dir, "afs.md"), "---\ntitle: AFS Analytics\n---\nbody A");
    await writeFile(join(dir, "ops.md"), "# Ops Playbook\n\nbody B");
    await writeFile(join(dir, "notes.txt"), "ignored: not markdown");
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads only .md files and keys them by filename id", async () => {
    const map = await loadPlaybooks(dir);
    assert.deepEqual([...map.keys()].sort(), ["afs", "ops"]);
    assert.equal(map.get("afs")?.displayTitle, "Run AFS Analytics Playbook");
    assert.equal(map.get("ops")?.topic, "Ops");
    assert.equal(map.get("afs")?.body, "body A");
  });

  it("returns an empty map for a missing directory instead of throwing", async () => {
    const map = await loadPlaybooks(join(dir, "does-not-exist"));
    assert.equal(map.size, 0);
  });
});
