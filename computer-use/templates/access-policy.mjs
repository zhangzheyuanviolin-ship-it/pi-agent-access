import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

export function loadAccessPolicy({directory = here, agentDirectory = process.env.PI_CODING_AGENT_DIR || resolve(here, '../..')} = {}) {
  try {
    const policy = JSON.parse(readFileSync(join(directory, 'access-policy.json'), 'utf8'));
    if (policy.version !== 1 || policy.normalComputerAccess !== 'allow') return undefined;
    let mode;
    try { mode = JSON.parse(readFileSync(join(agentDirectory, 'pi-web-context/permissions.json'), 'utf8')).mode; }
    catch (error) { if (error.code !== 'ENOENT') return undefined; mode = 'full'; }
    if (mode !== 'full') return undefined;
    return policy;
  } catch { return undefined; }
}

/** Honor a user-authored local policy only for the original ordinary access prompts.
 * Unknown forms, credentials, OS TCC, and action-specific confirmations are not auto-accepted.
 * The original client's agent-host refusal remains in front of this hook.
 */
export function automaticAccessDecision(params, nativeApproval, policy = loadAccessPolicy()) {
  if (!policy) return undefined;
  if (nativeApproval) {
    const supported = new Set(nativeApproval.choices.map(choice => choice.value));
    const value = ['always', 'session', 'once'].find(scope => supported.has(scope));
    return value ? {kind: 'native_app', value} : undefined;
  }
  const schema = params?.requestedSchema;
  const meta = params?._meta ?? params?.meta;
  if (params?.mode !== 'form' || meta?.tool_name !== 'access_browser_origin' ||
      schema?.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' ||
      Array.isArray(schema.properties) || Object.keys(schema.properties).length ||
      (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length))) return undefined;
  try {
    const url = new URL(meta.origin);
    if (['http:', 'https:'].includes(url.protocol) && url.origin === meta.origin)
      return {kind: 'browser_origin', response: {action: 'accept', content: {}}};
  } catch {}
  return undefined;
}
