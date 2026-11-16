import { ArgumentsHost, Catch, HttpException, Logger } from "@nestjs/common";
import type { ErrorRequestHandler } from "express";
import { ProblemDetailsFilter } from "../../common/problem.filter.js";
import { tooManyRequests } from "../../common/problem.js";

export const EMAIL_WEBHOOK_RETRY_AFTER_SECONDS = 5;
const logger = new Logger("EmailWebhook");

/** Brevo discards 5xx: all local failures must remain retryable, including guard failures. */
function retryableEmailWebhookError(exception: unknown): HttpException {
  if (exception instanceof HttpException && exception.getStatus() < 500) return exception;
  // Neither exception messages nor request paths are safe to log here.
  logger.error("email_webhook_unavailable");
  return tooManyRequests(
    "The notification could not be recorded. Retry later.",
    EMAIL_WEBHOOK_RETRY_AFTER_SECONDS,
  );
}

@Catch()
export class EmailWebhookExceptionFilter extends ProblemDetailsFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(retryableEmailWebhookError(exception), host);
  }
}

/** Express errors precede controller filters. Mount only on the email path, after the raw/JSON readers. */
export const emailWebhookBodyErrorHandler: ErrorRequestHandler = (
  exception: unknown,
  _request,
  _response,
  next,
) => {
  if (exception instanceof HttpException) {
    next(retryableEmailWebhookError(exception));
    return;
  }
  // Body parsers use plain errors carrying a status; preserve intentional request-format errors.
  if (
    exception instanceof Error &&
    "status" in exception &&
    typeof exception.status === "number" &&
    Number.isInteger(exception.status) &&
    exception.status >= 400 &&
    exception.status < 500
  ) {
    next(new HttpException("The notification could not be read.", exception.status));
    return;
  }
  next(retryableEmailWebhookError(exception));
};
