import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-scope-warnings.ts");
  } catch {
    return import("./model-scope-warnings.ts");
  }
}

const {
  stripThinkingLevelSuffix,
  findUnauthenticatedProvidersForPattern,
  modelScopeWarningKey,
} = await loadSubject();

const CATALOG = [
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { provider: "acme-gateway", id: "claude-opus-4-8", name: "Claude Opus 4.8 (Acme)" },
  { provider: "acme-gateway-openai", id: "gpt-5.6-sol", name: "GPT-5.6 (Acme)" },
];

const allAuth = () => true;
const onlyAnthropic = (providerId) => providerId === "anthropic";

test("strips only valid thinking-level suffixes", () => {
  assert.equal(stripThinkingLevelSuffix("anthropic/*:high"), "anthropic/*");
  assert.equal(stripThinkingLevelSuffix("acme-gateway/m:off"), "acme-gateway/m");
  // Unknown suffixes stay — models may have colons in their ids.
  assert.equal(stripThinkingLevelSuffix("openrouter/model:exacto"), "openrouter/model:exacto");
  assert.equal(stripThinkingLevelSuffix("anthropic/claude"), "anthropic/claude");
});

test("attributes provider-qualified patterns to unauthenticated providers", () => {
  assert.deepEqual(
    findUnauthenticatedProvidersForPattern("acme-gateway/claude-opus-4-8", CATALOG, onlyAnthropic),
    ["acme-gateway"],
  );
  // Provider-glob prefix matches all acme providers.
  assert.deepEqual(
    findUnauthenticatedProvidersForPattern("acme-*/*", CATALOG, onlyAnthropic).sort(),
    ["acme-gateway", "acme-gateway-openai"],
  );
});

test("returns undefined for genuine typos", () => {
  // Model id typo under an authenticated provider.
  assert.equal(
    findUnauthenticatedProvidersForPattern("anthropic/claude-haiku-9", CATALOG, onlyAnthropic),
    undefined,
  );
  // Provider does not exist in the catalog at all.
  assert.equal(
    findUnauthenticatedProvidersForPattern("ghost-gateway/*", CATALOG, onlyAnthropic),
    undefined,
  );
  // Everything authenticated: nothing to attribute.
  assert.equal(
    findUnauthenticatedProvidersForPattern("acme-gateway/*", CATALOG, allAuth),
    undefined,
  );
});

test("attributes bare patterns via fuzzy id, name, and full-reference glob matches", () => {
  // Fuzzy id match.
  assert.deepEqual(
    findUnauthenticatedProvidersForPattern("gpt-5.6", CATALOG, onlyAnthropic),
    ["acme-gateway-openai"],
  );
  // Name match.
  assert.deepEqual(
    findUnauthenticatedProvidersForPattern("claude opus", CATALOG, onlyAnthropic),
    ["acme-gateway"],
  );
  // Glob against the full provider/id reference.
  assert.deepEqual(
    findUnauthenticatedProvidersForPattern("acme-*", CATALOG, onlyAnthropic).sort(),
    ["acme-gateway", "acme-gateway-openai"],
  );
  // Bare pattern that also matches the authenticated provider's models is
  // attributed to the unauthenticated owners only.
  const mixed = findUnauthenticatedProvidersForPattern("*claude*", CATALOG, onlyAnthropic);
  assert.ok(mixed.includes("acme-gateway"));
  assert.ok(!mixed.includes("anthropic"));
});

test("keys differ per warning and collapse identical ones", () => {
  const a = { code: "no-match", pattern: "x", message: "m" };
  const b = { code: "no-match", pattern: "x", message: "different message" };
  const c = {
    code: "unauthenticated-provider",
    pattern: "x",
    unauthenticatedProviders: ["p1", "p2"],
    message: "m",
  };
  assert.equal(modelScopeWarningKey(a), modelScopeWarningKey(b));
  assert.notEqual(modelScopeWarningKey(a), modelScopeWarningKey(c));
  assert.notEqual(
    modelScopeWarningKey(c),
    modelScopeWarningKey({ ...c, unauthenticatedProviders: ["p1"] }),
  );
});
