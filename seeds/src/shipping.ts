import type { SeedShippingMethod } from "./types.js";

/*
 * Demo delivery methods (shipping plan documentation list; review m-9). Every method is INACTIVE: a fresh seed keeps the
 * checkout exactly as it is without methods, and an admin activates what the demo should show (admin UI, Shipping).
 * Placeholder texts and prices only, never a real carrier tariff. "Pickup point (demo)" uses the TEST-ONLY `fake`
 * provider and is created only when `fake` is loaded (`SHIPPING_PROVIDERS_ENABLED=fake`, never in production); even
 * activated, a pickup point method whose provider is not loaded is not offered, so it cannot lock the checkout out.
 */
export const demoShippingMethods: readonly SeedShippingMethod[] = [
  {
    code: "demo_courier",
    title: { uk: "Кур'єр (демо)", en: "Courier (demo)" },
    description: {
      uk: "Доставка за адресою. Демонстраційний тариф.",
      en: "Delivery to an address. Demo rate.",
    },
    kind: "address",
    providerCode: null,
    pricing: { type: "free_over", amount: 9_000, freeFrom: 200_000 },
    countryCodes: ["UA"],
    position: 10,
  },
  {
    code: "demo_pickup_point",
    title: { uk: "Пункт видачі (демо)", en: "Pickup point (demo)" },
    description: {
      uk: "Відділення або поштомат тестового перевізника.",
      en: "A branch or parcel locker of the test carrier.",
    },
    kind: "pickup_point",
    providerCode: "fake",
    pricing: { type: "flat", amount: 6_000 },
    countryCodes: ["UA"],
    position: 20,
  },
  {
    code: "demo_store_pickup",
    title: { uk: "Самовивіз (демо)", en: "Store pickup (demo)" },
    description: {
      uk: "Заберіть замовлення в демонстраційному магазині. Ми повідомимо, коли воно буде готове.",
      en: "Collect the order at the demo store. We will tell you when it is ready.",
    },
    kind: "store_pickup",
    providerCode: null,
    pricing: { type: "flat", amount: 0 },
    countryCodes: ["UA"],
    position: 30,
  },
];
