import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
import {
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailMessages,
  type EmailRenderContext,
  type EmailTemplate,
} from "@fluxkit/core";
import { z } from "zod";
import type { LoadedFeature } from "../features/feature-loader.js";
import { formatMessage } from "../email/templates/index.js";

/*
 * TEST ONLY. Mail templates written the way a feature writes one (a provider marked with `EMAIL_TEMPLATE_METADATA`), so
 * the specs prove the extension point and the escaping of variables without a feature package. Nothing loads them
 * outside a spec that asks.
 */

const greetingSchema = z
  .object({
    name: z.string().min(1).max(200),
    lines: z.array(z.object({ title: z.string().min(1).max(200), quantity: z.number().int() })),
  })
  .strict();

export type GreetingVariables = z.infer<typeof greetingSchema>;

const KEY = "fixture.greeting";

function catalogs(version: string, key = KEY): Readonly<Record<string, EmailMessages>> {
  return {
    uk: {
      [`${key}.subject`]: `Вітаємо, {name}${version}`,
      [`${key}.line`]: "{title} x {quantity}",
    },
    en: {
      [`${key}.subject`]: `Hello, {name}${version}`,
      [`${key}.line`]: "{title} x {quantity}",
    },
  };
}

function greeting(version: number, suffix: string, key = KEY): EmailTemplate<GreetingVariables> {
  return {
    key,
    version,
    category: "order",
    variablesSchema: greetingSchema,
    sampleVariables: { name: "Olena", lines: [{ title: "Mug", quantity: 2 }] },
    render(variables: GreetingVariables, context: EmailRenderContext) {
      const lines = variables.lines.map((line) =>
        formatMessage(context.messages, `${key}.line`, {
          title: line.title,
          quantity: String(line.quantity),
        }),
      );
      return {
        subject: formatMessage(context.messages, `${key}.subject`, { name: variables.name }),
        html: html`<p data-name="${variables.name}">${variables.name}</p>
          <ul>
            ${lines.map((line) => html`<li>${line}</li>`)}
          </ul>
          <a href="${context.links.action ?? context.links.storefront}">${variables.name}</a>`,
        text: [variables.name, ...lines].join("\n") + suffix,
      };
    },
  };
}

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class FixtureGreetingTemplate {
  readonly template = greeting(1, "");
  readonly catalogs = catalogs("");
}

/** Replaces `fixture.greeting` (version 2, another subject): the override path. */
@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY, { override: true }))
export class FixtureGreetingOverride {
  readonly template = greeting(2, "\n(v2)");
  readonly catalogs = catalogs(" (v2)");
}

/** A second registration of `fixture.greeting` WITHOUT `override`: the startup must fail. */
@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class FixtureGreetingDuplicate {
  readonly template = greeting(1, "");
  readonly catalogs = catalogs("");
}

/**
 * A template whose SAMPLE variables are hostile markup: the preview must print them escaped (ADR 0031 decision 14, plan
 * step 9). The fixture is wrong on purpose only in its sample; its render uses the `html` tag like every template.
 */
export const HOSTILE_SAMPLE_NAME = `<script>alert("x")</script><img src=x onerror=alert(1)>"'&`;

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata("fixture.hostile"))
export class FixtureHostileTemplate {
  readonly template: EmailTemplate<GreetingVariables> = {
    ...greeting(1, "", "fixture.hostile"),
    sampleVariables: {
      name: HOSTILE_SAMPLE_NAME,
      lines: [{ title: HOSTILE_SAMPLE_NAME, quantity: 1 }],
    },
  };
  readonly catalogs = catalogs("", "fixture.hostile");
}

@Module({ providers: [FixtureGreetingTemplate] })
class FixtureGreetingModule {}

@Module({ providers: [FixtureHostileTemplate] })
class FixtureHostileModule {}

@Module({ providers: [FixtureGreetingTemplate, FixtureGreetingOverride] })
class FixtureGreetingOverrideModule {}

@Module({ providers: [FixtureGreetingTemplate, FixtureGreetingDuplicate] })
class FixtureGreetingDuplicateModule {}

/** Loaded like an enabled feature: `startApp({ extraFeatures: [fixtureEmailTemplates("plain")] })`. */
export function fixtureEmailTemplates(
  kind: "plain" | "override" | "duplicate" | "hostile",
): LoadedFeature {
  const modules: Record<typeof kind, Type<unknown>> = {
    plain: FixtureGreetingModule,
    override: FixtureGreetingOverrideModule,
    duplicate: FixtureGreetingDuplicateModule,
    hostile: FixtureHostileModule,
  };
  return { name: `fixture-email-${kind}`, module: modules[kind] };
}
