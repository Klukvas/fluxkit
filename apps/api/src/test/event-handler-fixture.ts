import { Injectable, Module, SetMetadata } from "@nestjs/common";
import {
  DOMAIN_EVENT_HANDLER_METADATA,
  domainEventHandlerMetadata,
  type DomainEventEnvelope,
  type DomainEventHandler,
} from "@fluxkit/core";

/**
 * TEST ONLY. Fixture handlers, written the way a plugin writes one (a provider marked with `SetMetadata`), so the specs
 * prove the discovery without a feature package. They are NOT a feature: nothing loads them outside a spec that asks.
 */
abstract class RecordingHandler implements DomainEventHandler {
  /** Every delivery, in order (a retry shows up again). */
  readonly calls: DomainEventEnvelope[] = [];
  /** What `handle` does after recording; set it in a test (default: succeed). */
  behaviour: (event: DomainEventEnvelope) => Promise<void> = async () => undefined;

  async handle(event: DomainEventEnvelope): Promise<void> {
    this.calls.push(event);
    await this.behaviour(event);
  }

  reset(): void {
    this.calls.length = 0;
    this.behaviour = async () => undefined;
  }
}

@Injectable()
@SetMetadata(
  DOMAIN_EVENT_HANDLER_METADATA,
  domainEventHandlerMetadata(["order.expired", "order.paid"]),
)
export class FixtureHandlerA extends RecordingHandler {}

@Injectable()
@SetMetadata(DOMAIN_EVENT_HANDLER_METADATA, domainEventHandlerMetadata(["order.expired"]))
export class FixtureHandlerB extends RecordingHandler {}

/** Has the metadata of a handler but no `handle` method: discovery must refuse it loudly. */
@Injectable()
@SetMetadata(DOMAIN_EVENT_HANDLER_METADATA, domainEventHandlerMetadata(["order.placed"]))
export class BrokenFixtureHandler {}

@Module({
  providers: [FixtureHandlerA, FixtureHandlerB],
  exports: [FixtureHandlerA, FixtureHandlerB],
})
export class EventHandlerFixtureModule {}

@Module({ providers: [BrokenFixtureHandler] })
export class BrokenHandlerFixtureModule {}
