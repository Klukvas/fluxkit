import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { summarizeError } from "../common/error-summary.js";
import { SessionService } from "./session.service.js";

/**
 * Deletes every expired admin session once, when the application starts (no timers). Together with the cleanup
 * at login this keeps `admin_session` from growing without bound. A failure never blocks startup; it is logged as
 * a warning with the error class, the cause and its code only (the message can embed SQL).
 */
@Injectable()
export class ExpiredSessionCleanup implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpiredSessionCleanup.name);

  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const deleted = await this.sessions.deleteExpired();
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} expired admin sessions`);
      }
    } catch (error) {
      this.logger.warn(`Could not delete expired admin sessions: ${summarizeError(error)}`);
    }
  }
}
