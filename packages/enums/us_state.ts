import { system } from "std/system";

/**
 * Registers a system enum named `us_state` with every US state plus DC
 * and the territories that ship in this list. Variant names are the
 * lowercased two-letter postal codes (`ca`, `ny`, `dc`, …); display
 * names are the full English names.
 *
 * Call once from `system.tsx`, then reference with `t.enum("state", "us_state")`
 * (or `t.enum("us_state")` if your field name matches the enum name).
 */
export function usStateEnum() {
  system.enum_({
    name: "us_state",
    values: [
      { name: "al", displayName: "Alabama" },
      { name: "ak", displayName: "Alaska" },
      { name: "az", displayName: "Arizona" },
      { name: "ar", displayName: "Arkansas" },
      { name: "ca", displayName: "California" },
      { name: "co", displayName: "Colorado" },
      { name: "ct", displayName: "Connecticut" },
      { name: "dc", displayName: "District of Columbia" },
      { name: "de", displayName: "Delaware" },
      { name: "fl", displayName: "Florida" },
      { name: "ga", displayName: "Georgia" },
      { name: "hi", displayName: "Hawaii" },
      { name: "id", displayName: "Idaho" },
      { name: "il", displayName: "Illinois" },
      { name: "in", displayName: "Indiana" },
      { name: "ia", displayName: "Iowa" },
      { name: "ks", displayName: "Kansas" },
      { name: "ky", displayName: "Kentucky" },
      { name: "la", displayName: "Louisiana" },
      { name: "me", displayName: "Maine" },
      { name: "md", displayName: "Maryland" },
      { name: "ma", displayName: "Massachusetts" },
      { name: "mi", displayName: "Michigan" },
      { name: "mn", displayName: "Minnesota" },
      { name: "ms", displayName: "Mississippi" },
      { name: "mo", displayName: "Missouri" },
      { name: "mt", displayName: "Montana" },
      { name: "ne", displayName: "Nebraska" },
      { name: "nv", displayName: "Nevada" },
      { name: "nh", displayName: "New Hampshire" },
      { name: "nj", displayName: "New Jersey" },
      { name: "nm", displayName: "New Mexico" },
      { name: "ny", displayName: "New York" },
      { name: "nc", displayName: "North Carolina" },
      { name: "nd", displayName: "North Dakota" },
      { name: "oh", displayName: "Ohio" },
      { name: "ok", displayName: "Oklahoma" },
      { name: "or", displayName: "Oregon" },
      { name: "pa", displayName: "Pennsylvania" },
      { name: "ri", displayName: "Rhode Island" },
      { name: "sc", displayName: "South Carolina" },
      { name: "sd", displayName: "South Dakota" },
      { name: "tn", displayName: "Tennessee" },
      { name: "tx", displayName: "Texas" },
      { name: "ut", displayName: "Utah" },
      { name: "vt", displayName: "Vermont" },
      { name: "va", displayName: "Virginia" },
      { name: "wa", displayName: "Washington" },
      { name: "wv", displayName: "West Virginia" },
      { name: "wi", displayName: "Wisconsin" },
      { name: "wy", displayName: "Wyoming" },
    ],
  });
}
