// HTTP server status tracking (for stdio mode)
// This is in a separate module to avoid circular dependencies
export let httpServerStatus: {
  available: boolean;
  error: string | null;
  port: number | null;
} = {
  available: false,
  error: null,
  port: null,
};

