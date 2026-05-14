// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";
import { MetricOutputSchema } from "../../shared/render-schemas.js";

type MetricPayload = z.infer<typeof MetricOutputSchema>;

function firstRowValue(payload: MetricPayload, columnName: string): string | undefined {
  const columnIndex = payload.data.columns.findIndex(
    (column) => column.name === columnName,
  );
  if (columnIndex === -1) {
    return undefined;
  }

  return payload.data.rows[0]?.[columnIndex];
}

export function renderMetric(root: HTMLElement, payload: MetricPayload): void {
  root.replaceChildren();

  const card = document.createElement("section");
  card.className = "metric-card";

  const label = document.createElement("h1");
  label.className = "metric-label";
  label.textContent = payload.options.label ?? payload.title ?? payload.options.value;
  card.appendChild(label);

  const value = document.createElement("p");
  value.className = "metric-value";
  value.textContent = firstRowValue(payload, payload.options.value) ?? "—";

  if (payload.options.unit) {
    const unit = document.createElement("span");
    unit.className = "metric-unit";
    unit.textContent = payload.options.unit;
    value.appendChild(unit);
  }

  card.appendChild(value);

  const compareColumn = payload.options.compare;
  if (compareColumn) {
    const compare = document.createElement("p");
    compare.className = "metric-compare";
    compare.textContent = firstRowValue(payload, compareColumn) ?? "";
    card.appendChild(compare);
  }

  root.appendChild(card);
}
