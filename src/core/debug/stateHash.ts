/** Stable, dependency-free hash for compact simulation debug output. */
export function stateHash(value: unknown): string {
  const json = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item).sort().reduce<Record<string, unknown>>((out, key) => { out[key] = (item as Record<string, unknown>)[key]; return out; }, {})
      : item
  );
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
