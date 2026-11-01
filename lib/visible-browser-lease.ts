// Advisory browser-only election for HTTP origins without Web Locks. Stores
// only random ownership markers, never prompts, files or credentials. Loss of
// a page expires within 8 seconds; hidden pages release ownership immediately.
export function visibleBrowserLease() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return undefined;
  try { const key = "pi-stream-probe"; localStorage.setItem(key, "1"); localStorage.removeItem(key); }
  catch { return undefined; }
  return {
    request(name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown> {
      return new Promise((resolve) => {
        const key = "pi-stream-lease:" + name;
        const owner = Math.random().toString(36).slice(2) + Date.now().toString(36);
        let stopped = false, holding = false, claiming = false;
        let settle: ReturnType<typeof setTimeout> | undefined;
        const read = (): { owner: string; until: number } | null => {
          try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
        };
        const release = () => {
          if (read()?.owner === owner) localStorage.removeItem(key);
        };
        const cleanup = () => {
          if (stopped) return;
          stopped = true; clearInterval(timer); clearTimeout(settle); release();
          options.signal?.removeEventListener("abort", cleanup);
          document.removeEventListener("visibilitychange", tick);
          window.removeEventListener("pagehide", cleanup);
          resolve(undefined);
        };
        const tick = () => {
          if (stopped) return;
          if (holding) {
            // The consumer releases and recreates the stream on visibility.
            if (read()?.owner === owner) localStorage.setItem(key, JSON.stringify({ owner, until: Date.now() + 8000 }));
            return;
          }
          if (document.visibilityState === "hidden" || claiming) return;
          const previous = read();
          if (previous && previous.until > Date.now()) return;
          claiming = true;
          localStorage.setItem(key, JSON.stringify({ owner, until: Date.now() + 8000 }));
          settle = setTimeout(() => {
            claiming = false;
            if (stopped || read()?.owner !== owner || document.visibilityState === "hidden") return;
            holding = true;
            Promise.resolve().then(callback).finally(cleanup);
          }, 80);
        };
        const timer = setInterval(tick, 2000);
        options.signal?.addEventListener("abort", cleanup, { once: true });
        document.addEventListener("visibilitychange", tick);
        window.addEventListener("pagehide", cleanup);
        if (options.signal?.aborted) cleanup(); else tick();
      });
    },
  };
}
