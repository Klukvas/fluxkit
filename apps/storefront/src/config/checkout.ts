/**
 * Shop-specific checkout settings (plan, "Theming and layout composition"; API gap 14: the API has no such settings). Read
 * by the checkout form in step 7, never hardcoded in a component. Internal to the storefront in v1.
 */

/** `Address` members of `POST /store/checkout` the form can show (`recipient*` fields are filled from the contact data). */
export type AddressFieldName = "region" | "city" | "postalCode" | "line1" | "line2";

export interface AddressFieldConfig {
  name: AddressFieldName;
  required: boolean;
}

export interface CheckoutConfig {
  /** ISO 3166-1 alpha-2 codes a shopper can ship to; the country select lists these. */
  allowedShippingCountries: readonly string[];
  /** Preselected country; must be one of `allowedShippingCountries`. */
  defaultCountry: string;
  /** Address fields shown under the country, in order. */
  addressFields: readonly AddressFieldConfig[];
}

export const checkoutConfig: CheckoutConfig = {
  allowedShippingCountries: ["UA"],
  defaultCountry: "UA",
  addressFields: [
    { name: "region", required: false },
    { name: "city", required: true },
    { name: "postalCode", required: false },
    { name: "line1", required: true },
    { name: "line2", required: false },
  ],
};
