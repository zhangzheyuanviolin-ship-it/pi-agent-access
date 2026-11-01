/** Remote plain HTTP cannot multiplex SSE and has no secure-context Web Locks. */
export function isRemoteHTTP(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "http:"
    && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}
