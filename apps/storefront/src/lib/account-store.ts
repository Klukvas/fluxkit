import type {
  AuthResult,
  CartNotice,
  ChangePasswordBody,
  Customer,
  LoginBody,
  RegisterBody,
  StoreClient,
  StoreFailure,
  StoreResult,
  UpdateAccountBody,
} from "@fluxkit/api-client";
import { failureFromResult, failureFromThrown, type Failure } from "./failure";

/**
 * The customer session as the browser knows it (plan, step 6). The session cookie is `HttpOnly` with `Path=/store`, so the
 * page can only ask the API (`GET /store/account/me`) who is signed in; this store holds that answer for the header link,
 * the account pages and the sign-in forms.
 *
 * Nothing secret is kept: a password lives in the request body only (never in a URL, the state, a log or browser storage),
 * and no error text of the API is shown. `cartNotices` of a sign-in are kept in memory until the shopper dismisses them, so
 * they are shown once (after a reload they are gone).
 */

export type SessionState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "signedIn"; customer: Customer }
  | { status: "error" };

export interface AccountState {
  session: SessionState;
  /** From the last sign-in or registration, shown once as a dismissible notice. */
  cartNotices: readonly CartNotice[];
}

export const initialAccountState: AccountState = {
  session: { status: "loading" },
  cartNotices: [],
};

export type AccountOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "failed"; failure: Failure }
  /** A protected call answered 401: the session is gone, the state is now `guest`. */
  | { status: "signedOut" };

type AccountClient = Pick<
  StoreClient,
  "getAccount" | "login" | "register" | "logout" | "updateAccount" | "changePassword"
>;

export interface AccountStoreOptions {
  client: AccountClient;
  /** Called after a sign-in, a registration or a sign-out succeeded: the cart changed (merged, or gone with the session). */
  onSessionChanged?: () => void;
}

export interface AccountStore {
  getState(): AccountState;
  subscribe(listener: () => void): () => void;
  /** Reads the session once (idempotent). */
  start(): void;
  refresh(): Promise<void>;
  login(body: LoginBody): Promise<AccountOutcome<AuthResult>>;
  register(body: RegisterBody): Promise<AccountOutcome<AuthResult>>;
  logout(): Promise<AccountOutcome<undefined>>;
  updateProfile(body: UpdateAccountBody): Promise<AccountOutcome<Customer>>;
  changePassword(body: ChangePasswordBody): Promise<AccountOutcome<undefined>>;
  dismissCartNotices(): void;
}

const NO_STORE = { fetchOptions: { cache: "no-store" } } as const;

/**
 * The one message for every failed sign-in. The API answers an identical 401 for an unknown email, a wrong password, a
 * locked and an inactive account, so the storefront must not invent a difference either: no field is marked.
 */
const LOGIN_FAILED_KEY = "account.login.invalid";
const EMAIL_TAKEN_KEY = "account.register.emailTaken";

/**
 * A taken email is the one conflict a registration reports (`409 conflict`, `field: "email"`); the API accepts the trade-off
 * that it says so (ADR 0016), and the form words it as "sign in instead".
 */
function withEmailTaken(failure: Failure): Failure {
  const taken = (error: Failure["fieldErrors"][number]) =>
    error.code === "conflict" && error.path === "email";
  if (!failure.fieldErrors.some(taken)) return failure;
  return {
    ...failure,
    fieldErrors: failure.fieldErrors.map((error) =>
      taken(error) ? { ...error, messageKey: EMAIL_TAKEN_KEY } : error,
    ),
  };
}

export function createAccountStore(options: AccountStoreOptions): AccountStore {
  const { client } = options;
  let state: AccountState = initialAccountState;
  let started = false;
  let seq = 0;
  let appliedSeq = 0;
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, Promise<unknown>>();

  function set(next: AccountState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  /** Sets the session when this request is newer than the last one that did. */
  function apply(mine: number, session: SessionState, cartNotices?: readonly CartNotice[]): void {
    if (mine <= appliedSeq) return;
    appliedSeq = mine;
    set({ session, cartNotices: cartNotices ?? state.cartNotices });
  }

  /** A double submit joins the request in flight instead of sending a second one. */
  function once<T>(name: string, run: () => Promise<T>): Promise<T> {
    const running = inFlight.get(name);
    if (running !== undefined) return running as Promise<T>;
    const promise = run().finally(() => {
      inFlight.delete(name);
    });
    inFlight.set(name, promise);
    return promise;
  }

  async function send<T>(
    request: () => Promise<StoreResult<T>>,
  ): Promise<StoreResult<T> | Failure> {
    try {
      return await request();
    } catch (error) {
      return failureFromThrown(error);
    }
  }

  function isFailure(value: StoreResult<unknown> | Failure): value is Failure {
    return "messageKey" in value;
  }

  const store: AccountStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      void store.refresh();
    },
    async refresh() {
      const mine = (seq += 1);
      const answer = await send(() => client.getAccount(NO_STORE));
      if (isFailure(answer)) {
        console.error("The account link could not read the account.");
        apply(mine, { status: "error" });
      } else if (answer.ok) {
        apply(mine, { status: "signedIn", customer: answer.data.customer });
      } else if (answer.status === 401) {
        // The normal answer for a guest.
        apply(mine, { status: "guest" });
      } else {
        console.error(
          `The account link could not read the account: ${answer.status} ${answer.problem.code}.`,
        );
        apply(mine, { status: "error" });
      }
    },
    login: (body) => signIn("login", () => client.login(body, NO_STORE)),
    register: (body) => signIn("register", () => client.register(body, NO_STORE)),
    logout: () =>
      once("logout", async () => {
        const mine = (seq += 1);
        const answer = await send(() => client.logout(NO_STORE));
        if (isFailure(answer)) return { status: "failed", failure: answer } as const;
        // 401 means the session had already ended: the shopper wanted to be signed out, and is.
        if (!answer.ok && answer.status !== 401) {
          return { status: "failed", failure: failureFromResult(answer) } as const;
        }
        apply(mine, { status: "guest" }, []);
        options.onSessionChanged?.();
        return { status: "ok", value: undefined } as const;
      }),
    updateProfile: (body) =>
      once("updateProfile", async () => {
        const mine = (seq += 1);
        const answer = await send(() => client.updateAccount(body, NO_STORE));
        if (isFailure(answer)) return { status: "failed", failure: answer } as const;
        if (answer.ok) {
          apply(mine, { status: "signedIn", customer: answer.data.customer });
          return { status: "ok", value: answer.data.customer } as const;
        }
        return protectedFailure(mine, answer);
      }),
    changePassword: (body) =>
      once("changePassword", async () => {
        const mine = (seq += 1);
        const answer = await send(() => client.changePassword(body, NO_STORE));
        if (isFailure(answer)) return { status: "failed", failure: answer } as const;
        if (answer.ok) return { status: "ok", value: undefined } as const;
        return protectedFailure(mine, answer);
      }),
    dismissCartNotices() {
      if (state.cartNotices.length > 0) set({ ...state, cartNotices: [] });
    },
  };

  function protectedFailure(
    mine: number,
    answer: StoreFailure,
  ): { status: "signedOut" } | { status: "failed"; failure: Failure } {
    if (answer.status === 401) {
      apply(mine, { status: "guest" }, []);
      return { status: "signedOut" };
    }
    return { status: "failed", failure: failureFromResult(answer) };
  }

  function signIn(
    name: "login" | "register",
    request: () => Promise<StoreResult<AuthResult>>,
  ): Promise<AccountOutcome<AuthResult>> {
    return once(name, async () => {
      const mine = (seq += 1);
      const answer = await send(request);
      if (isFailure(answer)) return { status: "failed", failure: answer } as const;
      if (!answer.ok) {
        const failure = failureFromResult(answer);
        if (name === "login" && answer.status === 401) {
          return {
            status: "failed",
            failure: { ...failure, messageKey: LOGIN_FAILED_KEY, fieldErrors: [] },
          } as const;
        }
        if (name === "register")
          return { status: "failed", failure: withEmailTaken(failure) } as const;
        return { status: "failed", failure } as const;
      }
      apply(mine, { status: "signedIn", customer: answer.data.customer }, answer.data.cartNotices);
      options.onSessionChanged?.();
      return { status: "ok", value: answer.data } as const;
    });
  }

  return store;
}
