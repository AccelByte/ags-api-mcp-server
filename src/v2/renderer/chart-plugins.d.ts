// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

// chartjs-plugin-trendline ships JS only.
declare module "chartjs-plugin-trendline" {
  import type { Plugin } from "chart.js";
  const plugin: Plugin;
  export default plugin;
}
