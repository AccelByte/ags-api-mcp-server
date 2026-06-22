// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { AnyChrome } from "./types.js";
import { sourceNoteChrome, statsNoteChrome } from "./chromes/footer-notes.js";
import { pinChrome } from "./chromes/pin.js";
import { refreshAllChrome } from "./chromes/refresh-all.js";
import { quotaChrome } from "./chromes/quota.js";
import { refreshChrome } from "./chromes/refresh.js";
import { removeChrome } from "./chromes/remove.js";
import { syncChrome } from "./chromes/sync.js";

/**
 * THE single chrome catalog. Every surface resolves from this one list and lets
 * each chrome's `select` decide where (if anywhere) it appears — no surface keeps
 * its own hardcoded chrome list. Adding a chrome is one entry here; it then shows
 * up wherever its eligibility matches. Order sets default intra-region priority
 * ties only (regions + `priority` still govern placement).
 */
export const CHROMES: readonly AnyChrome[] = [
  // Presentational footer notes (data-gated; any container).
  sourceNoteChrome,
  statsNoteChrome,
  // Standalone single-result.
  pinChrome,
  // Dashboard container.
  syncChrome,
  refreshAllChrome,
  quotaChrome,
  // Dashboard card.
  refreshChrome,
  removeChrome,
];
