export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

/** The managed local catalog is authoritative; old tabs must not resurrect removed backends. */
export function mergeModelOptions(
  configured: ModelOption[],
  discovered: ModelOption[],
  currentLocal: ModelOption[] | null,
): ModelOption[] {
  const combined = [...discovered, ...configured];
  const retained = currentLocal === null
    ? combined
    : [...combined.filter(m => m.provider !== "mac-local-unified"), ...currentLocal];
  return [...new Map(retained.map(m => [`${m.provider}/${m.modelId}`, m])).values()];
}
