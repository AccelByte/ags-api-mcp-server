// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

// chartjs-plugin-trendline ships JS only.
declare module "chartjs-plugin-trendline" {
  import type { Plugin } from "chart.js";
  const plugin: Plugin;
  export default plugin;
}
