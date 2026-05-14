// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

declare module "@observablehq/inputs" {
  export interface SearchControl<T> extends HTMLFormElement {
    readonly value: T[];
    query: string;
  }

  export interface TableOptions<T> {
    columns?: string[];
    format?: Record<string, (value: unknown, index: number, data: T[]) => unknown>;
    header?: Record<string, string | Node>;
    layout?: "auto" | "fixed";
    multiple?: boolean;
    required?: boolean;
    rows?: number;
    select?: boolean;
    sort?: string;
    reverse?: boolean;
    width?: Record<string, number | string> | number | string;
  }

  export function search<T extends Record<string, unknown>>(
    data: T[],
    options?: {
      columns?: string[];
      placeholder?: string;
      query?: string;
      required?: boolean;
      width?: number | string;
    },
  ): SearchControl<T>;

  export function table<T extends Record<string, unknown>>(
    data: T[],
    options?: TableOptions<T>,
  ): HTMLFormElement;
}
