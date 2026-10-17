import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  DOMAIN_EVENT_HANDLER_METADATA,
  domainEventHandlerMetadata,
  type DomainEventHandler,
} from "@fluxkit/core";

/** A discovered handler: the provider's class name (for logs) and the instance. */
export interface RegisteredHandler {
  readonly name: string;
  readonly handler: DomainEventHandler;
}

/** What the dispatcher needs from the registry (a test passes a plain object). */
export interface DomainEventHandlerSource {
  handlersFor(type: string): readonly RegisteredHandler[];
}

function isHandler(value: unknown): value is DomainEventHandler {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { handle?: unknown }).handle === "function"
  );
}

/**
 * Finds the domain event handlers once, at startup (ADR 0018): every provider whose class carries
 * `DOMAIN_EVENT_HANDLER_METADATA` (`SetMetadata(DOMAIN_EVENT_HANDLER_METADATA, domainEventHandlerMetadata([...]))`) with a
 * `handle(event)` method. Core and the API import no plugin: the plugin marks itself and this class discovers it.
 * A marked provider that is malformed (no `handle`, a bad event type, no instance) is a bug in the plugin and
 * fails the startup loudly instead of being skipped. Discovery order is the delivery order within one event.
 */
@Injectable()
export class DomainEventHandlerRegistry implements OnApplicationBootstrap, DomainEventHandlerSource {
  private byType = new Map<string, RegisteredHandler[]>();

  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    this.discover();
  }

  /** Reads the providers again; called once at bootstrap (public so a test can assert on a fresh scan). */
  discover(): void {
    const found = new Map<string, RegisteredHandler[]>();
    const providers = this.discovery.getProviders({ metadataKey: DOMAIN_EVENT_HANDLER_METADATA });
    for (const wrapper of providers) {
      const name = wrapper.name === undefined ? "(unnamed)" : String(wrapper.name);
      const target: unknown = wrapper.metatype ?? wrapper.instance?.constructor;
      const raw: unknown = Reflect.getMetadata(DOMAIN_EVENT_HANDLER_METADATA, target as object);
      const declared = (raw as { eventTypes?: readonly string[] } | undefined)?.eventTypes;
      let metadata;
      try {
        metadata = domainEventHandlerMetadata(declared ?? []);
      } catch (error) {
        throw new Error(
          `Domain event handler ${name} declares no valid event types: ${(error as Error).message}`,
          { cause: error },
        );
      }
      const instance: unknown = wrapper.instance;
      if (!isHandler(instance)) {
        throw new Error(
          `Domain event handler ${name} must be a static provider with a handle(event) method.`,
        );
      }
      for (const type of metadata.eventTypes) {
        const list = found.get(type) ?? [];
        list.push({ name, handler: instance });
        found.set(type, list);
      }
    }
    this.byType = found;
  }

  handlersFor(type: string): readonly RegisteredHandler[] {
    return this.byType.get(type) ?? [];
  }

  /** Every registered handler class name, for the startup log. */
  names(): string[] {
    return [...new Set([...this.byType.values()].flat().map((entry) => entry.name))];
  }
}
