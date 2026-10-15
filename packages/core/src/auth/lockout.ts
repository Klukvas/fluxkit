export const LOCKOUT_DEFAULTS = Object.freeze({ maxFailedAttempts: 5, lockMinutes: 15 });

export interface LockoutConfig {
  readonly maxFailedAttempts: number;
  readonly lockMinutes: number;
}

export interface LockoutState {
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
}

function assertConfig(config: LockoutConfig): void {
  if (!(Number.isInteger(config.maxFailedAttempts) && config.maxFailedAttempts >= 1)) {
    throw new RangeError("maxFailedAttempts must be an integer of at least 1");
  }
  if (!(Number.isFinite(config.lockMinutes) && config.lockMinutes > 0)) {
    throw new RangeError("lockMinutes must be a positive number");
  }
}

/** Locked strictly before `lockedUntil`. An unreadable date fails closed (locked). */
export function isLocked(state: { readonly lockedUntil: Date | null }, now: Date): boolean {
  if (state.lockedUntil === null) {
    return false;
  }
  const until = state.lockedUntil.getTime();
  return Number.isNaN(until) || now.getTime() < until;
}

export function registerFailedLogin(
  state: LockoutState,
  now: Date,
  config: LockoutConfig = LOCKOUT_DEFAULTS,
): LockoutState {
  assertConfig(config);
  if (state.lockedUntil !== null && isLocked(state, now)) {
    // Failures during a lock neither count nor extend it (otherwise an attacker could keep an admin locked out).
    return {
      failedLoginCount: state.failedLoginCount,
      lockedUntil: new Date(state.lockedUntil.getTime()),
    };
  }
  // An expired lock starts a fresh count.
  const previous = state.lockedUntil === null ? state.failedLoginCount : 0;
  const failedLoginCount = previous + 1;
  if (failedLoginCount >= config.maxFailedAttempts) {
    return { failedLoginCount, lockedUntil: new Date(now.getTime() + config.lockMinutes * 60_000) };
  }
  return { failedLoginCount, lockedUntil: null };
}

export function registerSuccessfulLogin(): LockoutState {
  return { failedLoginCount: 0, lockedUntil: null };
}
