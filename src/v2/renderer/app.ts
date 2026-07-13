// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import "./global.css";
import { bootstrapRenderer } from "./app-shell.js";

export * from "./app-shell.js";

declare global {
  interface Window {
    __AGS_RENDERER_DISABLE_AUTOBOOT__?: boolean;
  }
}

if (
  typeof window !== "undefined" &&
  window.__AGS_RENDERER_DISABLE_AUTOBOOT__ !== true
) {
  void bootstrapRenderer();
}
