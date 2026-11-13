import type { HerdrPort } from '../ports/herdr.port';

/** The folder-trust screen Gemini (agy) shows the first time it opens a folder. */
const TRUST_PROMPT =
  /Do you trust the contents of this project\?[\s\S]*Yes, I trust this folder/;

/**
 * Confirms the folder-trust screen when an agent is stuck on it. The worktree is
 * the factory's own and the trust option is the highlighted default, so Enter
 * accepts it. Returns false, and does nothing, for any other screen.
 */
export const confirmTrustPrompt = async (
  herdr: Pick<HerdrPort, 'readScreen' | 'sendKeys'>,
  name: string,
): Promise<boolean> => {
  const screen = await herdr.readScreen(name);
  if (!TRUST_PROMPT.test(screen)) return false;
  await herdr.sendKeys(name, ['Enter']);
  return true;
};
