import { countryEnum } from "enums/country";
import type { TableBuilder } from "std/system";

export interface AddressFields {
  name?: string;
  street1: string;
  street2?: string;
  city?: string;
  region?: string;
  country?: string;
  zip?: string;
}

export class AddressFieldGroup {
  constructor(
    public name: string,
    public fields: AddressFields,
  ) {}
}

export interface AddressFieldGroupOpts {
  /**
       Name of the field group. Defaults to `address`.
       */
  name?: string;
  /**
       Add a prefix to all the fields in the group.
       Useful if you want to add multiple address field groups to a table.
       For example: billing_, shipping_, etc.
       */
  prefix?: string;
  /**
       Make the country field a string field instead of an enum,
       needed if you are importing data from a legacy database and can't clean the data fully.
       */
  legacyCountry?: boolean;
  /**
       Control which fields are created
       */
  createFields?: {
    /**
           Address name field, not the street, but the name of the company or person at the address.
           @default false
           */
    name?: boolean | string;
    /**
           Street address line 1 (often all that is neede), name is street by default
           @default true
           */
    street?: boolean | string;
    /**
         Street address line 2, name is street_two by default
         @default false
         */
    streetTwo?: boolean | string;
    /**
         City, name is city by default
         @default true
         */
    city?: boolean | string;
    /**
         State, name is state by default
         @default true
         */
    state?: boolean | string;
    /**
         Country, name is country by default
         @default true
         */
    country?: boolean | string;
    /**
         Zip code/Postal code, name is zip by default
         @default true
         */
    zip?: boolean | string;
  };
  fieldOverrides?: {
    name?: (table: TableBuilder) => void;
    street?: (table: TableBuilder) => void;
    streetTwo?: (table: TableBuilder) => void;
    city?: (table: TableBuilder) => void;
    state?: (table: TableBuilder) => void;
    country?: (table: TableBuilder) => void;
    zip?: (table: TableBuilder) => void;
  };
}

/**
 Adds fields which represents an address.

 Integrates with addressCard and addressesCards.

 @category Field Group
 */
export function addressFieldGroup(
  table: TableBuilder,
  opts: AddressFieldGroupOpts = {},
) {
  function createFieldName(
    option: boolean | string | undefined,
    defaultName: string,
    createByDefault: boolean,
  ) {
    if (typeof option === "string") {
      return option;
    }
    if (option || createByDefault) {
      return opts.prefix ? opts.prefix + defaultName : defaultName;
    }
  }
  const groupName = opts.name ?? "address";
  const nameField = createFieldName(opts.createFields?.name, "name", false);
  const street1Field = createFieldName(
    opts.createFields?.street,
    "street",
    true,
  );
  const street2Field = createFieldName(
    opts.createFields?.streetTwo,
    "street_two",
    false,
  );
  const cityField = createFieldName(opts.createFields?.city, "city", true);
  const stateField = createFieldName(opts.createFields?.state, "state", true);
  const countryField = createFieldName(
    opts.createFields?.country,
    "country",
    true,
  );
  const zipField = createFieldName(opts.createFields?.zip, "zip", true);
  table.fieldGroup(
    groupName,
    new AddressFieldGroup(groupName, {
      name: nameField,
      city: cityField,
      street1: street1Field!,
      street2: street2Field,
      country: countryField,
      region: stateField,
      zip: zipField,
    }),
  );
  if (opts.fieldOverrides?.name) {
    opts.fieldOverrides.name(table);
  } else if (nameField) {
    table.string(nameField, 100).group(groupName);
  }
  if (opts.fieldOverrides?.street) {
    opts.fieldOverrides.street(table);
  } else if (street1Field) {
    table.string(street1Field, 80).group(groupName);
  }
  if (opts.fieldOverrides?.streetTwo) {
    opts.fieldOverrides.streetTwo(table);
  } else if (street2Field) {
    table.string(street2Field, 80).group(groupName);
  }
  if (opts.fieldOverrides?.city) {
    opts.fieldOverrides.city(table);
  } else if (cityField) {
    table.string(cityField, 85).group(groupName);
  }
  if (opts.fieldOverrides?.state) {
    opts.fieldOverrides.state(table);
  } else if (stateField) {
    table.string(stateField, 50).group(groupName);
  }
  if (opts.fieldOverrides?.country) {
    opts.fieldOverrides.country(table);
  } else if (countryField) {
    if (opts.legacyCountry) {
      table.string(countryField, 60).group(groupName);
    } else {
      countryEnum();
      table.enum(countryField, "country").group(groupName);
    }
  }
  if (opts.fieldOverrides?.zip) {
    opts.fieldOverrides.zip(table);
  } else if (zipField) {
    table.string(zipField, 20).group(groupName);
  }
}
