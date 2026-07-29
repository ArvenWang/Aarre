const ONBOARDING_KEY = "aarre:onboarding:v1";

export interface OnboardingState {
  completed: boolean;
  skipped: boolean;
  completedAt?: string;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const stored = (await chrome.storage.local.get(ONBOARDING_KEY))[
    ONBOARDING_KEY
  ] as Partial<OnboardingState> | undefined;
  return {
    completed: stored?.completed === true,
    skipped: stored?.skipped === true,
    ...(typeof stored?.completedAt === "string"
      ? { completedAt: stored.completedAt }
      : {})
  };
}

export async function completeOnboarding(
  skipped: boolean
): Promise<OnboardingState> {
  const state: OnboardingState = {
    completed: true,
    skipped,
    completedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [ONBOARDING_KEY]: state });
  return state;
}

export async function restartOnboarding(): Promise<void> {
  await chrome.storage.local.remove(ONBOARDING_KEY);
}
