// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";
import { TableOutputSchema } from "../../shared/render-schemas.js";

type TablePayload = z.infer<typeof TableOutputSchema>;

function createShell(payload: TablePayload): HTMLElement {
  const shell = document.createElement("section");
  shell.className = "renderer-shell";

  const header = document.createElement("div");
  header.className = "renderer-header";

  const heading = document.createElement("h1");
  heading.className = "renderer-title";
  heading.textContent = payload.title ?? "Query result table";
  header.appendChild(heading);

  if (payload.description) {
    const description = document.createElement("p");
    description.className = "renderer-description";
    description.textContent = payload.description;
    header.appendChild(description);
  }

  shell.appendChild(header);
  return shell;
}

export function renderTable(root: HTMLElement, payload: TablePayload): void {
  root.replaceChildren();

  const shell = createShell(payload);

  const summary = document.createElement("p");
  summary.className = "renderer-summary";
  summary.textContent = `Showing ${Math.min(payload.data.rows.length, payload.options.page_size)} of ${payload.data.rows.length} rows.`;
  shell.appendChild(summary);

  const wrap = document.createElement("div");
  wrap.className = "renderer-table-wrap";

  const table = document.createElement("table");
  table.className = "renderer-table";

  const headerRow = document.createElement("tr");
  for (const column of payload.data.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column.name;
    headerRow.appendChild(cell);
  }

  const thead = document.createElement("thead");
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of payload.data.rows.slice(0, payload.options.page_size)) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  shell.appendChild(wrap);
  root.appendChild(shell);
}
