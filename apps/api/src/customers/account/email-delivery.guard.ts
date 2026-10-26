import { Inject, Injectable, NotFoundException, type CanActivate } from "@nestjs/common";
import { EmailOutbox } from "../../email/outbox/index.js";

/**
 * The account routes that need mail (password reset, email verification) are OFF without a mail provider
 * (`EMAIL_PROVIDER=none`, ADR 0031 decision 11): they answer the same `404` as an unknown route, so no client can believe
 * a mail was sent, and `GET /store/config` says `emailDelivery: false`. Put it before the route's rate limit, so a 404
 * costs no attempt.
 */
@Injectable()
export class EmailDeliveryGuard implements CanActivate {
  constructor(@Inject(EmailOutbox) private readonly outbox: EmailOutbox) {}

  canActivate(): boolean {
    if (!this.outbox.enabled()) {
      throw new NotFoundException();
    }
    return true;
  }
}
