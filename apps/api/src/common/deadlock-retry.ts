import { findPostgresError } from "./postgres-errors.js";
import { serviceUnavailable } from "./problem.js";

/** SQLSTATE `deadlock_detected`: Postgres rolled this transaction back to break a lock cycle. */
const DEADLOCK_DETECTED = "40P01";

/**
 * Runs a whole transaction (`work` opens its own) and, when Postgres reports a deadlock, runs it ONE more time: the
 * lock orders of the order code are designed so that this never happens (ADR 0015), so it is a safety net, not a policy.
 * A second deadlock answers `503 service_unavailable` with `Retry-After`. `log` receives a message with the SQLSTATE
 * only: a database error text embeds the query and its parameters, which can hold personal data. Every other failure
 * passes through untouched on the first attempt.
 */
export async function retryOnDeadlock<T>(
  work: () => Promise<T>,
  log: (message: string) => void,
): Promise<T> {
  try {
    return await work();
  } catch (first) {
    if (findPostgresError(first)?.code !== DEADLOCK_DETECTED) {
      throw first;
    }
    log(`Deadlock (SQLSTATE ${DEADLOCK_DETECTED}) in an order transaction, retrying once.`);
  }
  try {
    return await work();
  } catch (second) {
    if (findPostgresError(second)?.code !== DEADLOCK_DETECTED) {
      throw second;
    }
    log(`Deadlock (SQLSTATE ${DEADLOCK_DETECTED}) again after the retry, answering 503.`);
    throw serviceUnavailable();
  }
}
