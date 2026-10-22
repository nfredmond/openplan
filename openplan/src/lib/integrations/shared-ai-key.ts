/**
 * The deployment's own Anthropic key, when this deployment lets workspaces
 * without a key of their own spend it.
 *
 * A single-agency installation sets ANTHROPIC_API_KEY and expects every
 * workspace to use it. A public installation with open signup must not: every
 * stranger's workspace, and its public engagement portal, would bill the
 * operator without notice. Production builds therefore use the deployment key
 * only when OPENPLAN_SHARED_AI_KEY=allow sits beside it. Development and test
 * runs keep the earlier behavior so local work needs no extra setting.
 */

type SharedKeyEnv = Readonly<Record<string, string | undefined>>;

export function sharedAnthropicApiKey(env: SharedKeyEnv = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (env.NODE_ENV === "production" && env.OPENPLAN_SHARED_AI_KEY?.trim() !== "allow") return null;
  return key;
}

/** True when a deployment key is set but this deployment does not share it. */
export function sharedAnthropicKeyWithheld(env: SharedKeyEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim()) && sharedAnthropicApiKey(env) === null;
}
