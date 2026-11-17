/**
 * The "how to get the key" guide of each provider the template ships. The texts are messages; the addresses are this
 * typed constant and nothing else: never the API's answer and never a message file, so a translation or a server answer
 * cannot point an owner who is about to paste a key at another site. A provider without an entry has no guide.
 */

export interface GuideLink {
  labelKey: string;
  href: `https://${string}`;
}

export interface ProviderGuide {
  /** The numbered steps, in order. */
  stepKeys: readonly string[];
  links: readonly GuideLink[];
  /** Where the value of one secret field comes from, by field. */
  fieldHintKeys: Readonly<Record<string, string>>;
}

const GUIDES = {
  resend: {
    stepKeys: ["intg.guide.resend.step1", "intg.guide.resend.step2", "intg.guide.resend.step3"],
    links: [{ labelKey: "intg.guide.resend.link.signup", href: "https://resend.com/signup" }],
    fieldHintKeys: { webhook_secret: "intg.guide.resend.webhookSecret" },
  },
  brevo: {
    stepKeys: ["intg.guide.brevo.step1", "intg.guide.brevo.step2", "intg.guide.brevo.step3"],
    links: [{ labelKey: "intg.guide.brevo.link.signup", href: "https://onboarding.brevo.com/" }],
    fieldHintKeys: { webhook_secret: "intg.guide.brevo.webhookSecret" },
  },
  monobank: {
    stepKeys: [
      "intg.guide.monobank.step1",
      "intg.guide.monobank.step2",
      "intg.guide.monobank.step3",
    ],
    links: [
      { labelKey: "intg.guide.monobank.link.test", href: "https://api.monobank.ua/" },
      { labelKey: "intg.guide.monobank.link.cabinet", href: "https://web.monobank.ua/" },
    ],
    fieldHintKeys: {},
  },
  nova_post: {
    stepKeys: [
      "intg.guide.nova_post.step1",
      "intg.guide.nova_post.step2",
      "intg.guide.nova_post.step3",
    ],
    links: [{ labelKey: "intg.guide.nova_post.link.cabinet", href: "https://new.novaposhta.ua/" }],
    fieldHintKeys: {},
  },
} as const satisfies Record<string, ProviderGuide>;

export const GUIDED_PROVIDER_CODES = Object.keys(GUIDES);

export function providerGuide(code: string): ProviderGuide | null {
  return Object.hasOwn(GUIDES, code)
    ? ((GUIDES as Record<string, ProviderGuide>)[code] ?? null)
    : null;
}
