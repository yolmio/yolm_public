import { sql } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import { DomStatements } from "std/statements";
import type { IStatementsBase } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar, getVariantStyle } from "std/style_utils";
import { system } from "std/system";
import { Data } from "std/data";
import { Each, Match, Show, Switch, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { memoize } from "std/utils/memoize";
import { Input } from "./input";
import { List, ListDivider, ListItemButton, ListSubheader } from "./list";
import { SelectIcon, selectPopoverStyles } from "./select";
import { SvgIcon } from "./svg_icon";
import { SwitchControl } from "./switch";
import type { Color, ComponentOpts, Size, Variant } from "./types";
import { Typography } from "./typography";
import { createGatherSafeSlot } from "./utils";
import type { SlottedComponentBaseProps } from "./utils";
import type { ChangeEventHandlerFn } from "std/event_utils";

export interface SelectTimezonePropsNew
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      select: "select";
      startDecorator: "span";
      endDecorator: "span";
      icon: "span";
    }> {
  /** ID of the focusable trigger, used by form labels. */
  id?: string | Sql;
  fullWidth?: boolean;
  error?: BooleanExpr;
  startDecorator?: Node;
  endDecorator?: Node;
  placeholder?: string;
  nullableLabel?: string;
  compact?: boolean;
  onUnfilteredTimezoneChange?: <T extends IStatementsBase>(
    s: T,
    value: Sql,
  ) => void;
  onInput?: ChangeEventHandlerFn;
  onChange?: ChangeEventHandlerFn;
  value?: Sql | NumericExpr;
  show24HourToggle?: boolean;
  region?: TimezoneRegion;
  label?: Sql;
  /** Whether the popover opens above ("top") or below ("bottom") the trigger. Defaults to "top". */
  popoverPlacement?: "top" | "bottom";
}

export type TimezoneRegion =
  | "US/Canada"
  | "America"
  | "Africa"
  | "Asia"
  | "Atlantic"
  | "Australia"
  | "UTC"
  | "Europe"
  | "Pacific"
  | "Other";

/**
 * Returns a SQL expression that resolves the long name for a timezone value.
 * Covers all ~596 IANA timezone identifiers, grouped by long name into
 * compact IN-list CASE clauses (~169 groups) for efficiency.
 * Falls back to the raw timezone name for any unrecognized value.
 *
 * No prior setup needed — this is self-contained.
 */
export function timezoneLongNameExpr(timezoneExpr: Sql): AnyExpr {
  const groups: Record<string, string[]> = {};
  for (const [tz, longName] of Object.entries(timezoneLongNames)) {
    if (!groups[longName]) groups[longName] = [];
    groups[longName].push(tz);
  }
  const castExpr = sql`cast(${timezoneExpr} as string)`;
  const castExprStr = castExpr.toSQL();
  const cases: string[] = [];
  for (const [longName, timezones] of Object.entries(groups)) {
    if (timezones.length === 1) {
      cases.push(
        `when ${castExprStr} = ${sql.lit(timezones[0]).toSQL()} then ${
          sql.lit(longName).toSQL()
        }`,
      );
    } else {
      const inList = timezones.map((tz) => sql.lit(tz).toSQL()).join(", ");
      cases.push(
        `when ${castExprStr} in (${inList}) then ${sql.lit(longName).toSQL()}`,
      );
    }
  }
  return sql`case ${sql(cases.join(" "))} else ${castExpr} end`;
}

/**
 * Adds a procedure-local lookup table `tz_long_names` with (tz_name, long_name) rows.
 * Use this when `timezoneLongNameExpr` exceeds expression nesting limits.
 *
 * After calling this in a Data procedure, use:
 *   sql`coalesce((select long_name from tz_long_names where tz_name = cast(expr as string)), cast(expr as string))`
 */
export function addTimezoneLongNameLookup<T extends IStatementsBase>(s: T) {
  s.defTable("tz_long_names", {
    fields: [
      { name: "tz_name", type: { type: "String", maxLength: 100 } },
      { name: "long_name", type: { type: "String", maxLength: 200 } },
    ],
  });
  for (const [tz, longName] of Object.entries(timezoneLongNames)) {
    s.modify(
      sql`insert into tz_long_names (tz_name, long_name) values (${
        sql.lit(tz)
      }, ${sql.lit(longName)})`,
    );
  }
}

const timezoneLongNames: Record<string, string> = {
  "Africa/Abidjan": "Greenwich Mean Time",
  "Africa/Accra": "Greenwich Mean Time",
  "Africa/Addis_Ababa": "East Africa Time",
  "Africa/Algiers": "Central European Standard Time",
  "Africa/Asmara": "East Africa Time",
  "Africa/Asmera": "East Africa Time",
  "Africa/Bamako": "Greenwich Mean Time",
  "Africa/Bangui": "West Africa Standard Time",
  "Africa/Banjul": "Greenwich Mean Time",
  "Africa/Bissau": "Greenwich Mean Time",
  "Africa/Blantyre": "Central Africa Time",
  "Africa/Brazzaville": "West Africa Standard Time",
  "Africa/Bujumbura": "Central Africa Time",
  "Africa/Cairo": "Eastern European Standard Time",
  "Africa/Casablanca": "GMT+01:00",
  "Africa/Ceuta": "Central European Standard Time",
  "Africa/Conakry": "Greenwich Mean Time",
  "Africa/Dakar": "Greenwich Mean Time",
  "Africa/Dar_es_Salaam": "East Africa Time",
  "Africa/Djibouti": "East Africa Time",
  "Africa/Douala": "West Africa Standard Time",
  "Africa/El_Aaiun": "GMT+01:00",
  "Africa/Freetown": "Greenwich Mean Time",
  "Africa/Gaborone": "Central Africa Time",
  "Africa/Harare": "Central Africa Time",
  "Africa/Johannesburg": "South Africa Standard Time",
  "Africa/Juba": "Central Africa Time",
  "Africa/Kampala": "East Africa Time",
  "Africa/Khartoum": "Central Africa Time",
  "Africa/Kigali": "Central Africa Time",
  "Africa/Kinshasa": "West Africa Standard Time",
  "Africa/Lagos": "West Africa Standard Time",
  "Africa/Libreville": "West Africa Standard Time",
  "Africa/Lome": "Greenwich Mean Time",
  "Africa/Luanda": "West Africa Standard Time",
  "Africa/Lubumbashi": "Central Africa Time",
  "Africa/Lusaka": "Central Africa Time",
  "Africa/Malabo": "West Africa Standard Time",
  "Africa/Maputo": "Central Africa Time",
  "Africa/Maseru": "South Africa Standard Time",
  "Africa/Mbabane": "South Africa Standard Time",
  "Africa/Mogadishu": "East Africa Time",
  "Africa/Monrovia": "Greenwich Mean Time",
  "Africa/Nairobi": "East Africa Time",
  "Africa/Ndjamena": "West Africa Standard Time",
  "Africa/Niamey": "West Africa Standard Time",
  "Africa/Nouakchott": "Greenwich Mean Time",
  "Africa/Ouagadougou": "Greenwich Mean Time",
  "Africa/Porto-Novo": "West Africa Standard Time",
  "Africa/Sao_Tome": "Greenwich Mean Time",
  "Africa/Timbuktu": "Greenwich Mean Time",
  "Africa/Tripoli": "Eastern European Standard Time",
  "Africa/Tunis": "Central European Standard Time",
  "Africa/Windhoek": "Central Africa Time",
  "America/Adak": "Hawaii-Aleutian Standard Time",
  "America/Anchorage": "Alaska Standard Time",
  "America/Anguilla": "Atlantic Standard Time",
  "America/Antigua": "Atlantic Standard Time",
  "America/Araguaina": "Brasilia Standard Time",
  "America/Argentina/Buenos_Aires": "Argentina Standard Time",
  "America/Argentina/Catamarca": "Argentina Standard Time",
  "America/Argentina/ComodRivadavia": "Argentina Standard Time",
  "America/Argentina/Cordoba": "Argentina Standard Time",
  "America/Argentina/Jujuy": "Argentina Standard Time",
  "America/Argentina/La_Rioja": "Argentina Standard Time",
  "America/Argentina/Mendoza": "Argentina Standard Time",
  "America/Argentina/Rio_Gallegos": "Argentina Standard Time",
  "America/Argentina/Salta": "Argentina Standard Time",
  "America/Argentina/San_Juan": "Argentina Standard Time",
  "America/Argentina/San_Luis": "Argentina Standard Time",
  "America/Argentina/Tucuman": "Argentina Standard Time",
  "America/Argentina/Ushuaia": "Argentina Standard Time",
  "America/Aruba": "Atlantic Standard Time",
  "America/Asuncion": "Paraguay Summer Time",
  "America/Atikokan": "Eastern Standard Time",
  "America/Atka": "Hawaii-Aleutian Standard Time",
  "America/Bahia": "Brasilia Standard Time",
  "America/Bahia_Banderas": "Central Standard Time",
  "America/Barbados": "Atlantic Standard Time",
  "America/Belem": "Brasilia Standard Time",
  "America/Belize": "Central Standard Time",
  "America/Blanc-Sablon": "Atlantic Standard Time",
  "America/Boa_Vista": "Amazon Standard Time",
  "America/Bogota": "Colombia Standard Time",
  "America/Boise": "Mountain Standard Time",
  "America/Buenos_Aires": "Argentina Standard Time",
  "America/Cambridge_Bay": "Mountain Standard Time",
  "America/Campo_Grande": "Amazon Standard Time",
  "America/Cancun": "Eastern Standard Time",
  "America/Caracas": "Venezuela Time",
  "America/Catamarca": "Argentina Standard Time",
  "America/Cayenne": "French Guiana Time",
  "America/Cayman": "Eastern Standard Time",
  "America/Chicago": "Central Standard Time",
  "America/Chihuahua": "Central Standard Time",
  "America/Ciudad_Juarez": "Mountain Standard Time",
  "America/Coral_Harbour": "Eastern Standard Time",
  "America/Cordoba": "Argentina Standard Time",
  "America/Costa_Rica": "Central Standard Time",
  "America/Creston": "Mountain Standard Time",
  "America/Cuiaba": "Amazon Standard Time",
  "America/Curacao": "Atlantic Standard Time",
  "America/Danmarkshavn": "Greenwich Mean Time",
  "America/Dawson": "Yukon Time",
  "America/Dawson_Creek": "Mountain Standard Time",
  "America/Denver": "Mountain Standard Time",
  "America/Detroit": "Eastern Standard Time",
  "America/Dominica": "Atlantic Standard Time",
  "America/Edmonton": "Mountain Standard Time",
  "America/Eirunepe": "Acre Standard Time",
  "America/El_Salvador": "Central Standard Time",
  "America/Ensenada": "Pacific Standard Time",
  "America/Fort_Nelson": "Mountain Standard Time",
  "America/Fort_Wayne": "Eastern Standard Time",
  "America/Fortaleza": "Brasilia Standard Time",
  "America/Glace_Bay": "Atlantic Standard Time",
  "America/Godthab": "GMT-02:00",
  "America/Goose_Bay": "Atlantic Standard Time",
  "America/Grand_Turk": "Eastern Standard Time",
  "America/Grenada": "Atlantic Standard Time",
  "America/Guadeloupe": "Atlantic Standard Time",
  "America/Guatemala": "Central Standard Time",
  "America/Guayaquil": "Ecuador Time",
  "America/Guyana": "Guyana Time",
  "America/Halifax": "Atlantic Standard Time",
  "America/Havana": "Cuba Standard Time",
  "America/Hermosillo": "Mexican Pacific Standard Time",
  "America/Indiana/Indianapolis": "Eastern Standard Time",
  "America/Indiana/Knox": "Central Standard Time",
  "America/Indiana/Marengo": "Eastern Standard Time",
  "America/Indiana/Petersburg": "Eastern Standard Time",
  "America/Indiana/Tell_City": "Central Standard Time",
  "America/Indiana/Vevay": "Eastern Standard Time",
  "America/Indiana/Vincennes": "Eastern Standard Time",
  "America/Indiana/Winamac": "Eastern Standard Time",
  "America/Indianapolis": "Eastern Standard Time",
  "America/Inuvik": "Mountain Standard Time",
  "America/Iqaluit": "Eastern Standard Time",
  "America/Jamaica": "Eastern Standard Time",
  "America/Jujuy": "Argentina Standard Time",
  "America/Juneau": "Alaska Standard Time",
  "America/Kentucky/Louisville": "Eastern Standard Time",
  "America/Kentucky/Monticello": "Eastern Standard Time",
  "America/Knox_IN": "Central Standard Time",
  "America/Kralendijk": "Atlantic Standard Time",
  "America/La_Paz": "Bolivia Time",
  "America/Lima": "Peru Standard Time",
  "America/Los_Angeles": "Pacific Standard Time",
  "America/Louisville": "Eastern Standard Time",
  "America/Lower_Princes": "Atlantic Standard Time",
  "America/Maceio": "Brasilia Standard Time",
  "America/Managua": "Central Standard Time",
  "America/Manaus": "Amazon Standard Time",
  "America/Marigot": "Atlantic Standard Time",
  "America/Martinique": "Atlantic Standard Time",
  "America/Matamoros": "Central Standard Time",
  "America/Mazatlan": "Mexican Pacific Standard Time",
  "America/Mendoza": "Argentina Standard Time",
  "America/Menominee": "Central Standard Time",
  "America/Merida": "Central Standard Time",
  "America/Metlakatla": "Alaska Standard Time",
  "America/Mexico_City": "Central Standard Time",
  "America/Miquelon": "St. Pierre & Miquelon Standard Time",
  "America/Moncton": "Atlantic Standard Time",
  "America/Monterrey": "Central Standard Time",
  "America/Montevideo": "Uruguay Standard Time",
  "America/Montreal": "Eastern Standard Time",
  "America/Montserrat": "Atlantic Standard Time",
  "America/Nassau": "Eastern Standard Time",
  "America/New_York": "Eastern Standard Time",
  "America/Nipigon": "Eastern Standard Time",
  "America/Nome": "Alaska Standard Time",
  "America/Noronha": "Fernando de Noronha Standard Time",
  "America/North_Dakota/Beulah": "Central Standard Time",
  "America/North_Dakota/Center": "Central Standard Time",
  "America/North_Dakota/New_Salem": "Central Standard Time",
  "America/Nuuk": "GMT-02:00",
  "America/Ojinaga": "Central Standard Time",
  "America/Panama": "Eastern Standard Time",
  "America/Pangnirtung": "Eastern Standard Time",
  "America/Paramaribo": "Suriname Time",
  "America/Phoenix": "Mountain Standard Time",
  "America/Port-au-Prince": "Eastern Standard Time",
  "America/Port_of_Spain": "Atlantic Standard Time",
  "America/Porto_Acre": "Acre Standard Time",
  "America/Porto_Velho": "Amazon Standard Time",
  "America/Puerto_Rico": "Atlantic Standard Time",
  "America/Punta_Arenas": "GMT-03:00",
  "America/Rainy_River": "Central Standard Time",
  "America/Rankin_Inlet": "Central Standard Time",
  "America/Recife": "Brasilia Standard Time",
  "America/Regina": "Central Standard Time",
  "America/Resolute": "Central Standard Time",
  "America/Rio_Branco": "Acre Standard Time",
  "America/Rosario": "Argentina Standard Time",
  "America/Santa_Isabel": "Pacific Standard Time",
  "America/Santarem": "Brasilia Standard Time",
  "America/Santiago": "Chile Summer Time",
  "America/Santo_Domingo": "Atlantic Standard Time",
  "America/Sao_Paulo": "Brasilia Standard Time",
  "America/Scoresbysund": "GMT-02:00",
  "America/Shiprock": "Mountain Standard Time",
  "America/Sitka": "Alaska Standard Time",
  "America/St_Barthelemy": "Atlantic Standard Time",
  "America/St_Johns": "Newfoundland Standard Time",
  "America/St_Kitts": "Atlantic Standard Time",
  "America/St_Lucia": "Atlantic Standard Time",
  "America/St_Thomas": "Atlantic Standard Time",
  "America/St_Vincent": "Atlantic Standard Time",
  "America/Swift_Current": "Central Standard Time",
  "America/Tegucigalpa": "Central Standard Time",
  "America/Thule": "Atlantic Standard Time",
  "America/Thunder_Bay": "Eastern Standard Time",
  "America/Tijuana": "Pacific Standard Time",
  "America/Toronto": "Eastern Standard Time",
  "America/Tortola": "Atlantic Standard Time",
  "America/Vancouver": "Pacific Standard Time",
  "America/Virgin": "Atlantic Standard Time",
  "America/Whitehorse": "Yukon Time",
  "America/Winnipeg": "Central Standard Time",
  "America/Yakutat": "Alaska Standard Time",
  "America/Yellowknife": "Mountain Standard Time",
  "Antarctica/Casey": "Australian Western Standard Time",
  "Antarctica/Davis": "Davis Time",
  "Antarctica/DumontDUrville": "Dumont-d\u2019Urville Time",
  "Antarctica/Macquarie": "Australian Eastern Daylight Time",
  "Antarctica/Mawson": "Mawson Time",
  "Antarctica/McMurdo": "New Zealand Daylight Time",
  "Antarctica/Palmer": "GMT-03:00",
  "Antarctica/Rothera": "Rothera Time",
  "Antarctica/South_Pole": "New Zealand Daylight Time",
  "Antarctica/Syowa": "Syowa Time",
  "Antarctica/Troll": "Greenwich Mean Time",
  "Antarctica/Vostok": "Vostok Time",
  "Arctic/Longyearbyen": "Central European Standard Time",
  "Asia/Aden": "Arabian Standard Time",
  "Asia/Almaty": "GMT+05:00",
  "Asia/Amman": "GMT+03:00",
  "Asia/Anadyr": "Anadyr Standard Time",
  "Asia/Aqtau": "GMT+05:00",
  "Asia/Aqtobe": "GMT+05:00",
  "Asia/Ashgabat": "Turkmenistan Standard Time",
  "Asia/Ashkhabad": "Turkmenistan Standard Time",
  "Asia/Atyrau": "GMT+05:00",
  "Asia/Baghdad": "Arabian Standard Time",
  "Asia/Bahrain": "Arabian Standard Time",
  "Asia/Baku": "Azerbaijan Standard Time",
  "Asia/Bangkok": "Indochina Time",
  "Asia/Barnaul": "GMT+07:00",
  "Asia/Beirut": "Eastern European Standard Time",
  "Asia/Bishkek": "Kyrgyzstan Time",
  "Asia/Brunei": "Brunei Darussalam Time",
  "Asia/Calcutta": "India Standard Time",
  "Asia/Chita": "Yakutsk Standard Time",
  "Asia/Choibalsan": "Ulaanbaatar Standard Time",
  "Asia/Chongqing": "China Standard Time",
  "Asia/Chungking": "China Standard Time",
  "Asia/Colombo": "India Standard Time",
  "Asia/Dacca": "Bangladesh Standard Time",
  "Asia/Damascus": "GMT+03:00",
  "Asia/Dhaka": "Bangladesh Standard Time",
  "Asia/Dili": "East Timor Time",
  "Asia/Dubai": "Gulf Standard Time",
  "Asia/Dushanbe": "Tajikistan Time",
  "Asia/Famagusta": "GMT+02:00",
  "Asia/Gaza": "Eastern European Standard Time",
  "Asia/Harbin": "China Standard Time",
  "Asia/Hebron": "Eastern European Standard Time",
  "Asia/Ho_Chi_Minh": "Indochina Time",
  "Asia/Hong_Kong": "Hong Kong Standard Time",
  "Asia/Hovd": "Hovd Standard Time",
  "Asia/Irkutsk": "Irkutsk Standard Time",
  "Asia/Istanbul": "GMT+03:00",
  "Asia/Jakarta": "Western Indonesia Time",
  "Asia/Jayapura": "Eastern Indonesia Time",
  "Asia/Jerusalem": "Israel Standard Time",
  "Asia/Kabul": "Afghanistan Time",
  "Asia/Kamchatka": "Petropavlovsk-Kamchatski Standard Time",
  "Asia/Karachi": "Pakistan Standard Time",
  "Asia/Kashgar": "GMT+06:00",
  "Asia/Kathmandu": "Nepal Time",
  "Asia/Katmandu": "Nepal Time",
  "Asia/Khandyga": "Yakutsk Standard Time",
  "Asia/Kolkata": "India Standard Time",
  "Asia/Krasnoyarsk": "Krasnoyarsk Standard Time",
  "Asia/Kuala_Lumpur": "Malaysia Time",
  "Asia/Kuching": "Malaysia Time",
  "Asia/Kuwait": "Arabian Standard Time",
  "Asia/Macao": "China Standard Time",
  "Asia/Macau": "China Standard Time",
  "Asia/Magadan": "Magadan Standard Time",
  "Asia/Makassar": "Central Indonesia Time",
  "Asia/Manila": "Philippine Standard Time",
  "Asia/Muscat": "Gulf Standard Time",
  "Asia/Nicosia": "Eastern European Standard Time",
  "Asia/Novokuznetsk": "Krasnoyarsk Standard Time",
  "Asia/Novosibirsk": "Novosibirsk Standard Time",
  "Asia/Omsk": "Omsk Standard Time",
  "Asia/Oral": "GMT+05:00",
  "Asia/Phnom_Penh": "Indochina Time",
  "Asia/Pontianak": "Western Indonesia Time",
  "Asia/Pyongyang": "Korean Standard Time",
  "Asia/Qatar": "Arabian Standard Time",
  "Asia/Qostanay": "GMT+05:00",
  "Asia/Qyzylorda": "GMT+05:00",
  "Asia/Rangoon": "Myanmar Time",
  "Asia/Riyadh": "Arabian Standard Time",
  "Asia/Saigon": "Indochina Time",
  "Asia/Sakhalin": "Sakhalin Standard Time",
  "Asia/Samarkand": "Uzbekistan Standard Time",
  "Asia/Seoul": "Korean Standard Time",
  "Asia/Shanghai": "China Standard Time",
  "Asia/Singapore": "Singapore Standard Time",
  "Asia/Srednekolymsk": "GMT+11:00",
  "Asia/Taipei": "Taipei Standard Time",
  "Asia/Tashkent": "Uzbekistan Standard Time",
  "Asia/Tbilisi": "Georgia Standard Time",
  "Asia/Tehran": "Iran Standard Time",
  "Asia/Tel_Aviv": "Israel Standard Time",
  "Asia/Thimbu": "Bhutan Time",
  "Asia/Thimphu": "Bhutan Time",
  "Asia/Tokyo": "Japan Standard Time",
  "Asia/Tomsk": "GMT+07:00",
  "Asia/Ujung_Pandang": "Central Indonesia Time",
  "Asia/Ulaanbaatar": "Ulaanbaatar Standard Time",
  "Asia/Ulan_Bator": "Ulaanbaatar Standard Time",
  "Asia/Urumqi": "GMT+06:00",
  "Asia/Ust-Nera": "Vladivostok Standard Time",
  "Asia/Vientiane": "Indochina Time",
  "Asia/Vladivostok": "Vladivostok Standard Time",
  "Asia/Yakutsk": "Yakutsk Standard Time",
  "Asia/Yangon": "Myanmar Time",
  "Asia/Yekaterinburg": "Yekaterinburg Standard Time",
  "Asia/Yerevan": "Armenia Standard Time",
  "Atlantic/Azores": "Azores Standard Time",
  "Atlantic/Bermuda": "Atlantic Standard Time",
  "Atlantic/Canary": "Western European Standard Time",
  "Atlantic/Cape_Verde": "Cape Verde Standard Time",
  "Atlantic/Faeroe": "Western European Standard Time",
  "Atlantic/Faroe": "Western European Standard Time",
  "Atlantic/Jan_Mayen": "Central European Standard Time",
  "Atlantic/Madeira": "Western European Standard Time",
  "Atlantic/Reykjavik": "Greenwich Mean Time",
  "Atlantic/South_Georgia": "South Georgia Time",
  "Atlantic/St_Helena": "Greenwich Mean Time",
  "Atlantic/Stanley": "Falkland Islands Standard Time",
  "Australia/ACT": "Australian Eastern Daylight Time",
  "Australia/Adelaide": "Australian Central Daylight Time",
  "Australia/Brisbane": "Australian Eastern Standard Time",
  "Australia/Broken_Hill": "Australian Central Daylight Time",
  "Australia/Canberra": "Australian Eastern Daylight Time",
  "Australia/Currie": "Australian Eastern Daylight Time",
  "Australia/Darwin": "Australian Central Standard Time",
  "Australia/Eucla": "Australian Central Western Standard Time",
  "Australia/Hobart": "Australian Eastern Daylight Time",
  "Australia/LHI": "Lord Howe Daylight Time",
  "Australia/Lindeman": "Australian Eastern Standard Time",
  "Australia/Lord_Howe": "Lord Howe Daylight Time",
  "Australia/Melbourne": "Australian Eastern Daylight Time",
  "Australia/NSW": "Australian Eastern Daylight Time",
  "Australia/North": "Australian Central Standard Time",
  "Australia/Perth": "Australian Western Standard Time",
  "Australia/Queensland": "Australian Eastern Standard Time",
  "Australia/South": "Australian Central Daylight Time",
  "Australia/Sydney": "Australian Eastern Daylight Time",
  "Australia/Tasmania": "Australian Eastern Daylight Time",
  "Australia/Victoria": "Australian Eastern Daylight Time",
  "Australia/West": "Australian Western Standard Time",
  "Australia/Yancowinna": "Australian Central Daylight Time",
  "Brazil/Acre": "Acre Standard Time",
  "Brazil/DeNoronha": "Fernando de Noronha Standard Time",
  "Brazil/East": "Brasilia Standard Time",
  "Brazil/West": "Amazon Standard Time",
  "CET": "Central European Standard Time",
  "CST6CDT": "Central Standard Time",
  "Canada/Atlantic": "Atlantic Standard Time",
  "Canada/Central": "Central Standard Time",
  "Canada/Eastern": "Eastern Standard Time",
  "Canada/Mountain": "Mountain Standard Time",
  "Canada/Newfoundland": "Newfoundland Standard Time",
  "Canada/Pacific": "Pacific Standard Time",
  "Canada/Saskatchewan": "Central Standard Time",
  "Canada/Yukon": "Yukon Time",
  "Chile/Continental": "Chile Summer Time",
  "Chile/EasterIsland": "Easter Island Summer Time",
  "Cuba": "Cuba Standard Time",
  "EET": "Eastern European Standard Time",
  "EST": "Eastern Standard Time",
  "EST5EDT": "Eastern Standard Time",
  "Egypt": "Eastern European Standard Time",
  "Eire": "Greenwich Mean Time",
  "Etc/GMT": "Coordinated Universal Time",
  "Etc/GMT+0": "Greenwich Mean Time",
  "Etc/GMT+1": "GMT-01:00",
  "Etc/GMT+10": "GMT-10:00",
  "Etc/GMT+11": "GMT-11:00",
  "Etc/GMT+12": "GMT-12:00",
  "Etc/GMT+2": "GMT-02:00",
  "Etc/GMT+3": "GMT-03:00",
  "Etc/GMT+4": "GMT-04:00",
  "Etc/GMT+5": "GMT-05:00",
  "Etc/GMT+6": "GMT-06:00",
  "Etc/GMT+7": "GMT-07:00",
  "Etc/GMT+8": "GMT-08:00",
  "Etc/GMT+9": "GMT-09:00",
  "Etc/GMT-0": "Greenwich Mean Time",
  "Etc/GMT-1": "GMT+01:00",
  "Etc/GMT-10": "GMT+10:00",
  "Etc/GMT-11": "GMT+11:00",
  "Etc/GMT-12": "GMT+12:00",
  "Etc/GMT-13": "GMT+13:00",
  "Etc/GMT-14": "GMT+14:00",
  "Etc/GMT-2": "GMT+02:00",
  "Etc/GMT-3": "GMT+03:00",
  "Etc/GMT-4": "GMT+04:00",
  "Etc/GMT-5": "GMT+05:00",
  "Etc/GMT-6": "GMT+06:00",
  "Etc/GMT-7": "GMT+07:00",
  "Etc/GMT-8": "GMT+08:00",
  "Etc/GMT-9": "GMT+09:00",
  "Etc/GMT0": "Greenwich Mean Time",
  "Etc/Greenwich": "Greenwich Mean Time",
  "Etc/UCT": "Coordinated Universal Time",
  "Etc/UTC": "Coordinated Universal Time",
  "Etc/Universal": "Coordinated Universal Time",
  "Etc/Zulu": "Coordinated Universal Time",
  "Europe/Amsterdam": "Central European Standard Time",
  "Europe/Andorra": "Central European Standard Time",
  "Europe/Astrakhan": "GMT+04:00",
  "Europe/Athens": "Eastern European Standard Time",
  "Europe/Belfast": "Greenwich Mean Time",
  "Europe/Belgrade": "Central European Standard Time",
  "Europe/Berlin": "Central European Standard Time",
  "Europe/Bratislava": "Central European Standard Time",
  "Europe/Brussels": "Central European Standard Time",
  "Europe/Bucharest": "Eastern European Standard Time",
  "Europe/Budapest": "Central European Standard Time",
  "Europe/Busingen": "Central European Standard Time",
  "Europe/Chisinau": "Eastern European Standard Time",
  "Europe/Copenhagen": "Central European Standard Time",
  "Europe/Dublin": "Greenwich Mean Time",
  "Europe/Gibraltar": "Central European Standard Time",
  "Europe/Guernsey": "Greenwich Mean Time",
  "Europe/Helsinki": "Eastern European Standard Time",
  "Europe/Isle_of_Man": "Greenwich Mean Time",
  "Europe/Istanbul": "GMT+03:00",
  "Europe/Jersey": "Greenwich Mean Time",
  "Europe/Kaliningrad": "Eastern European Standard Time",
  "Europe/Kiev": "Eastern European Standard Time",
  "Europe/Kirov": "GMT+03:00",
  "Europe/Kyiv": "Eastern European Standard Time",
  "Europe/Lisbon": "Western European Standard Time",
  "Europe/Ljubljana": "Central European Standard Time",
  "Europe/London": "Greenwich Mean Time",
  "Europe/Luxembourg": "Central European Standard Time",
  "Europe/Madrid": "Central European Standard Time",
  "Europe/Malta": "Central European Standard Time",
  "Europe/Mariehamn": "Eastern European Standard Time",
  "Europe/Minsk": "Moscow Standard Time",
  "Europe/Monaco": "Central European Standard Time",
  "Europe/Moscow": "Moscow Standard Time",
  "Europe/Nicosia": "Eastern European Standard Time",
  "Europe/Oslo": "Central European Standard Time",
  "Europe/Paris": "Central European Standard Time",
  "Europe/Podgorica": "Central European Standard Time",
  "Europe/Prague": "Central European Standard Time",
  "Europe/Riga": "Eastern European Standard Time",
  "Europe/Rome": "Central European Standard Time",
  "Europe/Samara": "Samara Standard Time",
  "Europe/San_Marino": "Central European Standard Time",
  "Europe/Sarajevo": "Central European Standard Time",
  "Europe/Saratov": "GMT+04:00",
  "Europe/Simferopol": "Moscow Standard Time",
  "Europe/Skopje": "Central European Standard Time",
  "Europe/Sofia": "Eastern European Standard Time",
  "Europe/Stockholm": "Central European Standard Time",
  "Europe/Tallinn": "Eastern European Standard Time",
  "Europe/Tirane": "Central European Standard Time",
  "Europe/Tiraspol": "Eastern European Standard Time",
  "Europe/Ulyanovsk": "GMT+04:00",
  "Europe/Uzhgorod": "Eastern European Standard Time",
  "Europe/Vaduz": "Central European Standard Time",
  "Europe/Vatican": "Central European Standard Time",
  "Europe/Vienna": "Central European Standard Time",
  "Europe/Vilnius": "Eastern European Standard Time",
  "Europe/Volgograd": "Volgograd Standard Time",
  "Europe/Warsaw": "Central European Standard Time",
  "Europe/Zagreb": "Central European Standard Time",
  "Europe/Zaporozhye": "Eastern European Standard Time",
  "Europe/Zurich": "Central European Standard Time",
  "GB": "Greenwich Mean Time",
  "GB-Eire": "Greenwich Mean Time",
  "GMT": "Coordinated Universal Time",
  "GMT+0": "Coordinated Universal Time",
  "GMT-0": "Coordinated Universal Time",
  "GMT0": "Coordinated Universal Time",
  "Greenwich": "Greenwich Mean Time",
  "HST": "Hawaii-Aleutian Standard Time",
  "Hongkong": "Hong Kong Standard Time",
  "Iceland": "Greenwich Mean Time",
  "Indian/Antananarivo": "East Africa Time",
  "Indian/Chagos": "Indian Ocean Time",
  "Indian/Christmas": "Christmas Island Time",
  "Indian/Cocos": "Cocos Islands Time",
  "Indian/Comoro": "East Africa Time",
  "Indian/Kerguelen": "French Southern & Antarctic Time",
  "Indian/Mahe": "Seychelles Time",
  "Indian/Maldives": "Maldives Time",
  "Indian/Mauritius": "Mauritius Standard Time",
  "Indian/Mayotte": "East Africa Time",
  "Indian/Reunion": "R\u00e9union Time",
  "Iran": "Iran Standard Time",
  "Israel": "Israel Standard Time",
  "Jamaica": "Eastern Standard Time",
  "Japan": "Japan Standard Time",
  "Kwajalein": "Marshall Islands Time",
  "Libya": "Eastern European Standard Time",
  "MET": "Central European Standard Time",
  "MST": "Mountain Standard Time",
  "MST7MDT": "Mountain Standard Time",
  "Mexico/BajaNorte": "Pacific Standard Time",
  "Mexico/BajaSur": "Mexican Pacific Standard Time",
  "Mexico/General": "Central Standard Time",
  "NZ": "New Zealand Daylight Time",
  "NZ-CHAT": "Chatham Daylight Time",
  "Navajo": "Mountain Standard Time",
  "PRC": "China Standard Time",
  "PST8PDT": "Pacific Standard Time",
  "Pacific/Apia": "Apia Standard Time",
  "Pacific/Auckland": "New Zealand Daylight Time",
  "Pacific/Bougainville": "GMT+11:00",
  "Pacific/Chatham": "Chatham Daylight Time",
  "Pacific/Chuuk": "Chuuk Time",
  "Pacific/Easter": "Easter Island Summer Time",
  "Pacific/Efate": "Vanuatu Standard Time",
  "Pacific/Enderbury": "Phoenix Islands Time",
  "Pacific/Fakaofo": "Tokelau Time",
  "Pacific/Fiji": "Fiji Standard Time",
  "Pacific/Funafuti": "Tuvalu Time",
  "Pacific/Galapagos": "Galapagos Time",
  "Pacific/Gambier": "Gambier Time",
  "Pacific/Guadalcanal": "Solomon Islands Time",
  "Pacific/Guam": "Chamorro Standard Time",
  "Pacific/Honolulu": "Hawaii-Aleutian Standard Time",
  "Pacific/Johnston": "Hawaii-Aleutian Standard Time",
  "Pacific/Kanton": "Phoenix Islands Time",
  "Pacific/Kiritimati": "Line Islands Time",
  "Pacific/Kosrae": "Kosrae Time",
  "Pacific/Kwajalein": "Marshall Islands Time",
  "Pacific/Majuro": "Marshall Islands Time",
  "Pacific/Marquesas": "Marquesas Time",
  "Pacific/Midway": "Samoa Standard Time",
  "Pacific/Nauru": "Nauru Time",
  "Pacific/Niue": "Niue Time",
  "Pacific/Norfolk": "Norfolk Island Daylight Time",
  "Pacific/Noumea": "New Caledonia Standard Time",
  "Pacific/Pago_Pago": "Samoa Standard Time",
  "Pacific/Palau": "Palau Time",
  "Pacific/Pitcairn": "Pitcairn Time",
  "Pacific/Pohnpei": "Ponape Time",
  "Pacific/Ponape": "Ponape Time",
  "Pacific/Port_Moresby": "Papua New Guinea Time",
  "Pacific/Rarotonga": "Cook Islands Standard Time",
  "Pacific/Saipan": "Chamorro Standard Time",
  "Pacific/Samoa": "Samoa Standard Time",
  "Pacific/Tahiti": "Tahiti Time",
  "Pacific/Tarawa": "Gilbert Islands Time",
  "Pacific/Tongatapu": "Tonga Standard Time",
  "Pacific/Truk": "Chuuk Time",
  "Pacific/Wake": "Wake Island Time",
  "Pacific/Wallis": "Wallis & Futuna Time",
  "Pacific/Yap": "Chuuk Time",
  "Poland": "Central European Standard Time",
  "Portugal": "Western European Standard Time",
  "ROC": "Taipei Standard Time",
  "ROK": "Korean Standard Time",
  "Singapore": "Singapore Standard Time",
  "Turkey": "GMT+03:00",
  "UCT": "Coordinated Universal Time",
  "US/Alaska": "Alaska Standard Time",
  "US/Aleutian": "Hawaii-Aleutian Standard Time",
  "US/Arizona": "Mountain Standard Time",
  "US/Central": "Central Standard Time",
  "US/East-Indiana": "Eastern Standard Time",
  "US/Eastern": "Eastern Standard Time",
  "US/Hawaii": "Hawaii-Aleutian Standard Time",
  "US/Indiana-Starke": "Central Standard Time",
  "US/Michigan": "Eastern Standard Time",
  "US/Mountain": "Mountain Standard Time",
  "US/Pacific": "Pacific Standard Time",
  "US/Samoa": "Samoa Standard Time",
  "UTC": "Coordinated Universal Time",
  "Universal": "Coordinated Universal Time",
  "W-SU": "Moscow Standard Time",
  "WET": "Western European Standard Time",
  "Zulu": "Coordinated Universal Time",
};

interface TimezoneRegionInfo {
  name: string;
  defaultTimezoneValue: string;
  timezoneValues: {
    value: string;
    label: string;
    time: string;
  }[];
}

const timezoneRegions: Record<TimezoneRegion, TimezoneRegionInfo> = {
  "US/Canada": {
    name: "US/Canada",
    defaultTimezoneValue: "America/New_York",
    timezoneValues: [
      {
        value: "Pacific/Honolulu",
        label: "Hawaii Time",
        time: "(GMT-10:00)",
      },
      {
        value: "America/Anchorage",
        label: "Alaska Time",
        time: "(GMT-09:00)",
      },
      {
        value: "America/Los_Angeles",
        label: "Pacific Time - US & Canada",
        time: "(GMT-08:00)",
      },
      {
        value: "America/Phoenix",
        label: "Arizona, Yukon Time",
        time: "(GMT-07:00)",
      },
      {
        value: "America/Denver",
        label: "Mountain Time - US & Canada",
        time: "(GMT-07:00)",
      },
      {
        value: "America/Chicago",
        label: "Central Time - US & Canada",
        time: "(GMT-06:00)",
      },
      {
        value: "America/New_York",
        label: "Eastern Time - US & Canada",
        time: "(GMT-05:00)",
      },
      {
        value: "America/St_Johns",
        label: "Newfoundland Time",
        time: "(GMT-03:30)",
      },
    ],
  },
  America: {
    name: "America",
    defaultTimezoneValue: "America/Sao_Paulo",
    timezoneValues: [
      {
        value: "America/Adak",
        label: "America/Adak",
        time: "(GMT-10:00)",
      },
      {
        value: "America/Buenos_Aires",
        label: "Buenos Aires Time",
        time: "(GMT-03:00)",
      },
      {
        value: "America/Asuncion",
        label: "Asuncion Time",
        time: "(GMT-04:00)",
      },
      {
        value: "America/Bogota",
        label: "Bogota, Jamaica, Lima Time",
        time: "(GMT-05:00)",
      },
      {
        value: "America/Campo_Grande",
        label: "America/Campo Grande",
        time: "(GMT-04:00)",
      },
      {
        value: "America/Caracas",
        label: "Caracas Time",
        time: "(GMT-04:00)",
      },
      {
        value: "America/Godthab",
        label: "America/Godthab",
        time: "(GMT-03:00)",
      },
      {
        value: "America/Halifax",
        label: "Atlantic Time",
        time: "(GMT-04:00)",
      },
      {
        value: "America/Regina",
        label: "Saskatchewan, Guatemala, Costa Rica Time",
        time: "(GMT-06:00)",
      },
      {
        value: "America/Havana",
        label: "America/Havana",
        time: "(GMT-05:00)",
      },
      {
        value: "America/Mexico_City",
        label: "Mexico City Time",
        time: "(GMT-06:00)",
      },
      {
        value: "America/Montevideo",
        label: "Montevideo Time",
        time: "(GMT-03:00)",
      },
      {
        value: "America/Miquelon",
        label: "America/Miquelon",
        time: "(GMT-03:00)",
      },
      {
        value: "America/Noronha",
        label: "America/Noronha",
        time: "(GMT-02:00)",
      },
      {
        value: "America/Santiago",
        label: "Santiago Time",
        time: "(GMT-04:00)",
      },
      {
        value: "America/Santo_Domingo",
        label: "Atlantic Standard Time",
        time: "(GMT-04:00)",
      },
      {
        value: "America/Sao_Paulo",
        label: "Brasilia Time",
        time: "(GMT-03:00)",
      },
    ],
  },
  Africa: {
    name: "Africa",
    defaultTimezoneValue: "Africa/Cairo",
    timezoneValues: [
      {
        value: "Africa/Cairo",
        label: "Africa/Cairo",
        time: "(GMT+02:00)",
      },
      {
        value: "Africa/Harare",
        label: "Central Africa Time",
        time: "(GMT+02:00)",
      },
      {
        value: "Africa/Lagos",
        label: "West Africa Time",
        time: "(GMT+01:00)",
      },
      {
        value: "Africa/Windhoek",
        label: "Africa/Windhoek",
        time: "(GMT+02:00)",
      },
    ],
  },
  Asia: {
    name: "Asia",
    defaultTimezoneValue: "Asia/Tokyo",
    timezoneValues: [
      {
        value: "Asia/Amman",
        label: "Jordan Time",
        time: "(GMT+03:00)",
      },
      {
        value: "Asia/Baghdad",
        label: "Baghdad, East Africa Time",
        time: "(GMT+03:00)",
      },
      {
        value: "Asia/Baku",
        label: "Asia/Baku",
        time: "(GMT+04:00)",
      },
      {
        value: "Asia/Beirut",
        label: "Lebanon Time",
        time: "(GMT+02:00)",
      },
      {
        value: "Asia/Damascus",
        label: "Syria Time",
        time: "(GMT+03:00)",
      },
      {
        value: "Asia/Dhaka",
        label: "Asia/Dhaka",
        time: "(GMT+06:00)",
      },
      {
        value: "Asia/Dubai",
        label: "Dubai Time",
        time: "(GMT+04:00)",
      },
      {
        value: "Asia/Gaza",
        label: "Asia/Gaza",
        time: "(GMT+02:00)",
      },
      {
        value: "Asia/Irkutsk",
        label: "Asia/Irkutsk",
        time: "(GMT+08:00)",
      },
      {
        value: "Asia/Bangkok",
        label: "Indochina Time",
        time: "(GMT+07:00)",
      },
      {
        value: "Asia/Jerusalem",
        label: "Israel Time",
        time: "(GMT+02:00)",
      },
      {
        value: "Asia/Kabul",
        label: "Kabul Time",
        time: "(GMT+04:30)",
      },
      {
        value: "Asia/Karachi",
        label: "Pakistan, Maldives Time",
        time: "(GMT+05:00)",
      },
      {
        value: "Asia/Kathmandu",
        label: "Kathmandu Time",
        time: "(GMT+05:45)",
      },
      {
        value: "Asia/Kolkata",
        label: "India, Sri Lanka Time",
        time: "(GMT+05:30)",
      },
      {
        value: "Asia/Krasnoyarsk",
        label: "Krasnoyarsk Time",
        time: "(GMT+07:00)",
      },
      {
        value: "Asia/Omsk",
        label: "Asia/Omsk",
        time: "(GMT+06:00)",
      },
      {
        value: "Asia/Rangoon",
        label: "Asia/Rangoon",
        time: "(GMT+06:30)",
      },
      {
        value: "Asia/Shanghai",
        label: "China, Singapore, Perth",
        time: "(GMT+08:00)",
      },
      {
        value: "Asia/Tehran",
        label: "Tehran Time",
        time: "(GMT+03:30)",
      },
      {
        value: "Asia/Tokyo",
        label: "Japan, Korea Time",
        time: "(GMT+09:00)",
      },
      {
        value: "Asia/Vladivostok",
        label: "Asia/Vladivostok",
        time: "(GMT+10:00)",
      },
      {
        value: "Asia/Yakutsk",
        label: "Asia/Yakutsk",
        time: "(GMT+09:00)",
      },
      {
        value: "Asia/Yekaterinburg",
        label: "Yekaterinburg Time",
        time: "(GMT+05:00)",
      },
      {
        value: "Asia/Yerevan",
        label: "Asia/Yerevan",
        time: "(GMT+04:00)",
      },
    ],
  },
  Atlantic: {
    name: "Atlantic",
    defaultTimezoneValue: "Atlantic/Azores",
    timezoneValues: [
      {
        value: "Atlantic/Azores",
        label: "Azores Time",
        time: "(GMT-01:00)",
      },
      {
        value: "Atlantic/Cape_Verde",
        label: "Cape Verde Time",
        time: "(GMT-01:00)",
      },
    ],
  },
  Australia: {
    name: "Australia",
    defaultTimezoneValue: "Australia/Sydney",
    timezoneValues: [
      {
        value: "Australia/Adelaide",
        label: "Adelaide Time",
        time: "(GMT+09:30)",
      },
      {
        value: "Australia/Brisbane",
        label: "Brisbane Time",
        time: "(GMT+10:00)",
      },
      {
        value: "Australia/Darwin",
        label: "Australia/Darwin",
        time: "(GMT+09:30)",
      },
      {
        value: "Australia/Eucla",
        label: "Australia/Eucla",
        time: "(GMT+08:45)",
      },
      {
        value: "Australia/Lord_Howe",
        label: "Australia/Lord Howe",
        time: "(GMT+10:30)",
      },
      {
        value: "Australia/Perth",
        label: "Australia/Perth",
        time: "(GMT+08:00)",
      },
      {
        value: "Australia/Sydney",
        label: "Sydney, Melbourne Time",
        time: "(GMT+10:00)",
      },
    ],
  },
  UTC: {
    name: "UTC",
    defaultTimezoneValue: "UTC",
    timezoneValues: [
      {
        value: "UTC",
        label: "UTC Time",
        time: "(GMT+00:00)",
      },
    ],
  },
  Europe: {
    name: "Europe",
    defaultTimezoneValue: "Europe/Berlin",
    timezoneValues: [
      {
        value: "Europe/Berlin",
        label: "Central European Time",
        time: "(GMT+01:00)",
      },
      {
        value: "Europe/Kiev",
        label: "Eastern European Time",
        time: "(GMT+02:00)",
      },
      {
        value: "Europe/London",
        label: "UK, Ireland, Lisbon Time",
        time: "(GMT+00:00)",
      },
      {
        value: "Europe/Minsk",
        label: "Minsk Time",
        time: "(GMT+03:00)",
      },
      {
        value: "Europe/Moscow",
        label: "Moscow Time",
        time: "(GMT+03:00)",
      },
      {
        value: "Europe/Istanbul",
        label: "Turkey Time",
        time: "(GMT+03:00)",
      },
    ],
  },
  Pacific: {
    name: "Pacific",
    defaultTimezoneValue: "Pacific/Apia",
    timezoneValues: [
      {
        value: "Pacific/Apia",
        label: "Pacific/Apia",
        time: "(GMT+13:00)",
      },
      {
        value: "Pacific/Auckland",
        label: "Auckland Time",
        time: "(GMT+12:00)",
      },
      {
        value: "Pacific/Chatham",
        label: "Pacific/Chatham",
        time: "(GMT+12:45)",
      },
      {
        value: "Pacific/Easter",
        label: "Pacific/Easter",
        time: "(GMT-06:00)",
      },
      {
        value: "Pacific/Fiji",
        label: "Pacific/Fiji",
        time: "(GMT+12:00)",
      },
      {
        value: "Pacific/Gambier",
        label: "Pacific/Gambier",
        time: "(GMT-09:00)",
      },
      {
        value: "Pacific/Kiritimati",
        label: "Pacific/Kiritimati",
        time: "(GMT+14:00)",
      },
      {
        value: "Pacific/Majuro",
        label: "Pacific/Majuro",
        time: "(GMT+12:00)",
      },
      {
        value: "Pacific/Marquesas",
        label: "Pacific/Marquesas",
        time: "(GMT-09:30)",
      },
      {
        value: "Pacific/Norfolk",
        label: "Pacific/Norfolk",
        time: "(GMT+11:00)",
      },
      {
        value: "Pacific/Noumea",
        label: "Pacific/Noumea",
        time: "(GMT+11:00)",
      },
      {
        value: "Pacific/Pago_Pago",
        label: "Pacific/Pago Pago",
        time: "(GMT-11:00)",
      },
      {
        value: "Pacific/Pitcairn",
        label: "Pacific/Pitcairn",
        time: "(GMT-08:00)",
      },
      {
        value: "Pacific/Tarawa",
        label: "Pacific/Tarawa",
        time: "(GMT+12:00)",
      },
      {
        value: "Pacific/Tongatapu",
        label: "Pacific/Tongatapu",
        time: "(GMT+13:00)",
      },
    ],
  },
  Other: {
    name: "Other",
    defaultTimezoneValue: "UTC",
    timezoneValues: [],
  },
};

export function clampToRegion(
  timezone: Sql,
  region: TimezoneRegion,
): Sql {
  const regionInfo = timezoneRegions[region];
  return sql`case
    when ${
    sql.inList(
      timezone,
      regionInfo.timezoneValues.map((t) => sql`${sql.lit(t.value)}`),
    )
  }
    then ${timezone}
    else ${sql.lit(regionInfo.defaultTimezoneValue)}::enums.sys_timezone
  end`;
}

interface OwnerState {
  variant: Variant;
  color: Color;
  size: Size;
  fullWidth: boolean;
  placeholder?: string;
}
const selectSizeStyles = memoize((size: Size) => {
  const sizeStyleBySize: Record<Size, StyleObject> = {
    xs: {
      "--select-min-height": "1.75rem",
      "--select-padding-x": "0.5rem",
      "--select-decorator-child-height":
        "min(1.25rem, var(--select-min-height))",
      "--icon-font-size": "1rem",
      "--select-padding-y": "1px",
      fontSize: cssVar("text-xs"),
    },
    sm: {
      "--select-min-height": "2rem",
      "--select-padding-x": "0.5rem",
      "--select-decorator-child-height":
        "min(1.5rem, var(--select-min-height))",
      "--icon-font-size": "1.25rem",
      "--select-padding-y": "2px",
      fontSize: cssVar("text-sm"),
    },
    md: {
      "--select-min-height": "2.5rem",
      "--select-padding-x": "0.75rem",
      "--select-decorator-child-height": "min(2rem, var(--select-min-height))",
      "--icon-font-size": "1.5rem",
      "--select-padding-y": "3px",
    },
    lg: {
      "--select-min-height": "3rem",
      "--select-padding-x": "1rem",
      "--select-decorator-child-height":
        "min(2.375rem, var(--select-min-height))",
      "--icon-font-size": "1.75rem",
      "--select-padding-y": "4px",
    },
  };
  return sizeStyleBySize[size];
});

const selectIndicatorIconSizeBySize: Record<Size, string> = {
  xs: "1rem",
  sm: "1.125rem",
  md: "1.25rem",
  lg: "1.5rem",
};

const root = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { variant, color, size, fullWidth, placeholder } = ownerState;
    const styles: any = {
      "--select-radius": cssVar("radius-sm"),
      "--select-gap": "0.5rem",
      "--select-placeholder-opacity": "0.5",
      "--select-focused-thickness": cssVar("focus-thickness"),
      "--select-decorator-child-offset":
        "min(calc(var(--select-padding-x) - (var(--select-min-height) - 2 * var(--variant-border-width) - var(--select-decorator-child-height)) / 2), var(--select-padding-x))",
      // "--select-padding-y":
      //   "max((var(--select-min-height) - 2 * var(--variant-border-width) - var(--select-decorator-child-height)) / 2, 0px)",
      "--select-decorator-child-radius":
        "max(var(--select-radius) - var(--select-padding-y), min(var(--select-padding-y) / 2, var(--select-radius) / 2))",
      "--button-min-height": "var(--select-decorator-child-height)",
      "--icon-button-size": "var(--select-decorator-child-height)",
      "--button-radius": "var(--select-decorator-child-radius)",
      "--icon-button-radius": "var(--select-decorator-child-radius)",
      boxSizing: "border-box",
      minWidth: 0,
      minHeight: "var(--select-min-height)",
      position: "relative",
      display: "flex",
      alignItems: "center",
      borderRadius: "var(--select-radius)",
      fontFamily: cssVar("font-family-body"),
      fontSize: cssVar("text-base"),
      width: "inherit",
      "&::placeholder": {
        color: "var(--select-placeholder-color)",
        opacity: "var(--select-placeholder-opacity)",
      },
      ...selectSizeStyles(size),
      ...getVariantStyle(variant, color),
    };

    if (fullWidth) {
      styles.width = "100%";
    }

    if (color === "harmonize") {
      styles["--select-focused-highlight"] = cssVar("palette-focus-visible");
    } else {
      const paletteColor = color === "neutral" ? "primary" : color;
      styles["--select-focused-highlight"] = cssVar(
        `palette-${paletteColor}-500`,
      );
    }

    styles["&:focus-within"] = {
      "--select-indicator-color": "var(--select-focused-highlight)",
    };

    if (variant !== "solid") {
      styles["&:focus-within:before"] = {
        boxShadow:
          "inset 0 0 0 var(--select-focused-thickness) var(--select-focused-highlight)",
      };
    }

    if (placeholder) {
      styles["--select-placeholder-color"] = cssVar("palette-text-tertiary");
      styles["--select-placeholder-opacity"] = "1";
    }
    styles["&:hover"] = getVariantStyle(variant, color, "hover");
    styles["&.error"] = {
      ...getVariantStyle(variant, "danger"),
      "--select-focused-highlight": cssVar("palette-danger-500"),
      "&:hover": getVariantStyle(variant, "danger", "hover"),
    };

    return styles;
  },
);

function compactTimezoneLabel(label: string) {
  return label
    .replace(" Time - US & Canada", "")
    .replace(", Yukon Time", "")
    .replace(" Time", "");
}

export function compactTimeZoneDisplaySql(
  timeZone: AnyExpr,
  unknownLabel = "Unknown",
) {
  const timeZoneExpr = sql.normalizeExpr(timeZone);
  const seenTimeZones = new Set<string>();
  const labelCases: Sql[] = [];
  for (const region of Object.values(timezoneRegions)) {
    for (const timeZone of region.timezoneValues) {
      if (seenTimeZones.has(timeZone.value)) {
        continue;
      }
      seenTimeZones.add(timeZone.value);
      labelCases.push(
        sql`when ${sql.lit(timeZone.value)} then ${
          sql.lit(compactTimezoneLabel(timeZone.label))
        }`,
      );
    }
  }
  return sql`
    case
      when ${timeZoneExpr} is null then ${sql.lit(unknownLabel)}
      else (
        case cast(${timeZoneExpr} as string)
          ${sql(labelCases.map((c) => c.toSQL()).join("\n"))}
          else cast(${timeZoneExpr} as string)
        end
      ) || ', ' ||
        format.date(now() at time zone ${timeZoneExpr}, '%-I:%M%P')
    end
  `;
}

const icon = createGatherSafeSlot(
  "icon",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    "--icon-font-size": selectIndicatorIconSizeBySize[ownerState.size],
    color: "var(--select-indicator-color)",
    position: "absolute",
    userSelect: "none",
    pointerEvents: "none",
    right: "calc(var(--select-padding-x) - var(--select-padding-x)/2)",
    display: "flex",
    alignItems: "center",
    height: "100%",
  }),
);

const endDecoratorSlot = createGatherSafeSlot(
  "endDecorator",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => ({
    "--button-margin-right": "calc(var(--select-decorator-child-offset) * -1)",
    "--icon-button-margin-right":
      "calc(var(--select-decorator-child-offset) * -1)",
    "--icon-margin-right": "calc(var(--select-padding-x) / -4)",
    display: "inherit",
    alignItems: "center",
    marginLeft: "var(--select-gap)",
    marginRight: "var(--select-gap)",
    color: ownerState.color === "harmonize"
      ? `var(--harmonize-${ownerState.variant}-color)`
      : cssVar(`palette-${ownerState.color}-${ownerState.variant}-color`),
    cursor: "initial",
  }),
);

/**
 A component for selecting a timezone from a predefined list.

 This component renders a form control with a label and a select dropdown
 containing a list of timezones. Users can choose a timezone from the options provided.

 @category UI Component

 @param props.label The label text for the timezone select field

 @examples
 [Example](../blocks/availability/availability_page.tsx)
*/
export function SelectTimeZone(props: SelectTimezonePropsNew) {
  // eventually a combobox with search would be good, have a look at this user study:
  // https://www.nngroup.com/articles/time-zone-selectors/
  const {
    color = "neutral",
    variant = "outlined",
    size = "md",
    fullWidth = false,
    error,
    placeholder = "Select timezone",
    onInput,
    onChange,
    value,
    endDecorator: endDecoratorProp,
    onUnfilteredTimezoneChange,
    nullableLabel,
    compact = false,
    label,
    region, // Extract the single region prop
    popoverPlacement = "top",
  } = props;
  const listSize = size;
  const anchorId = props.id ?? useUniqueId();
  const popoverId = sql.concat("timezone-popover-", anchorId);
  const ownerState: OwnerState = {
    variant,
    color,
    size,
    fullWidth,
    placeholder,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    internalProps: {
      dynamicClasses: error
        ? [{ classes: "error", condition: error }]
        : undefined,
      tabIndex: 0,
      id: anchorId,
      role: "button",
      "aria-expanded": sql`popover_open`,
      "aria-haspopup": "listbox",
      "aria-label": label ?? placeholder,
      style: { position: "relative" },
      onClick: (s: DomStatements) => {
        s.toggle("popover_open");
        s.statements(updatePopoverWidth);
      },
      onKeyDown: (s: DomStatements) => {
        s.if(sql`event.key in (' ', 'Enter')`, (s) => {
          s.event.preventDefault();
          s.toggle("popover_open");
          s.statements(updatePopoverWidth);
        }).elseIf(sql`event.key = 'Escape'`, (s) => {
          s.setScalar("popover_open", false);
        });
      },
      onClickAway: (s: DomStatements) => {
        s.setScalar("popover_open", false);
      },
    },
    slotProps: { ownerState },
  });
  const updatePopoverWidth = new DomStatements();
  updatePopoverWidth.element(sql.lit`${anchorId}`).getBoundingClientRect(
    "rect",
  );
  updatePopoverWidth.setScalar("popover_width", sql`rect.width`);
  const [IconSlot, iconProps] = icon({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  const [EndDecoratorSlot, endDecoratorProps] = endDecoratorSlot({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("popover_open", false);
        s.defScalar("popover_width", { type: "BigInt" });
      }}
    >
      <Data
        local
        noRefetch
        watch={value ? [value] : undefined}
        procedure={(s) => {
          s.defTable("filtered_timezones", {
            fields: [
              { name: "region", type: { type: "String", maxLength: 100 } },
              { name: "value", type: { type: "Enum", enum: "sys_timezone" } },
              { name: "label", type: { type: "String", maxLength: 200 } },
              {
                name: "compact_label",
                type: { type: "String", maxLength: 200 },
              },
            ],
          });
          {
            const allTimezones: {
              region: string;
              value: string;
              label: string;
              compactLabel: string;
            }[] = [];
            if (region && timezoneRegions[region]) {
              for (const timezone of timezoneRegions[region].timezoneValues) {
                allTimezones.push({
                  region,
                  value: timezone.value,
                  label: timezone.label,
                  compactLabel: compactTimezoneLabel(timezone.label),
                });
              }
            } else {
              for (
                const [regionName, regionTimezones] of Object.entries(
                  timezoneRegions,
                )
              ) {
                for (const timezone of regionTimezones.timezoneValues) {
                  allTimezones.push({
                    region: regionName,
                    value: timezone.value,
                    label: timezone.label,
                    compactLabel: compactTimezoneLabel(timezone.label),
                  });
                }
              }
            }
            const values = allTimezones.map((tz) =>
              sql`(${sql.lit(tz.region)}, ${sql.lit(tz.value)}, ${
                sql.lit(tz.label)
              }, ${sql.lit(tz.compactLabel)})`
            );
            s.modify(
              sql`insert into filtered_timezones (region, value, label, compact_label) values ${
                sql(values.map((v) => v.toSQL()).join(", "))
              }`,
            );
          }

          s.defScalar("target_value", {
            type: { type: "Enum", enum: "sys_timezone" },
            expr: nullableLabel
              ? sql`case
                when ${value ?? sql`null`} is null then null::enums.sys_timezone
                when ${value ?? sql`null`} is not null and ${
                sql.lit(region ?? "")
              } != '' and
                     exists (select 1 from filtered_timezones where value = ${
                value ?? sql`null`
              } and region = ${sql.lit(region ?? "")})
                then ${value ?? sql`null`}
                when ${value ?? sql`null`} is not null and ${
                sql.lit(region ?? "")
              } = ''
                then ${value ?? sql`null`}
                else ${sql.lit(system.timezone)}::enums.sys_timezone
              end`
              : sql`case
                when ${value ?? sql.lit``} is not null and ${
                sql.lit(region ?? "")
              } != '' and
                     exists (select 1 from filtered_timezones where value = ${
                value ?? sql.lit``
              } and region = ${sql.lit(region ?? "")})
                then ${value ?? sql.lit``}
                when ${value ?? sql`null`} is not null and ${
                sql.lit(region ?? "")
              } = ''
                then ${value ?? sql.lit``}
                else ${sql.lit(system.timezone)}::enums.sys_timezone
              end`,
          });

          s.defScalar("is_unfiltered_timezone", {
            expr: nullableLabel
              ? sql`case
                when ${value ?? sql`null`} is null then false
                when ${value ?? sql`null`} is not null and ${
                sql.lit(region ?? "")
              } != '' and
                   exists (select 1 from filtered_timezones where value = ${
                value ?? sql`null`
              } and region = ${sql.lit(region ?? "")})
                then false
                when ${value ?? sql`null`} is not null and ${
                sql.lit(region ?? "")
              } = ''
                then false
                else true
              end`
              : sql`case
                when ${value ?? sql.lit``} is not null and ${
                sql.lit(region ?? "")
              } != '' and
                   exists (select 1 from filtered_timezones where value = ${
                value ?? sql.lit``
              } and region = ${sql.lit(region ?? "")})
                then false
                when ${value ?? sql`null`} is not null and ${
                sql.lit(region ?? "")
              } = ''
                then false
                else true
              end`,
            allowNoRead: true,
          });

          s.defScalar("selected_24_hour", {
            type: "Bool",
            expr: sql.null,
            allowNoRead: true,
          });
          s.defScalar("search_query", sql.lit``);

          s.if(sql`target_value is not null`, (s) => {
            s.if(
              sql`not exists (select 1 from filtered_timezones where value = target_value)`,
              (s) => {
                s.defScalar(
                  "new_timezone_region",
                  sql`case
            when target_value like 'Asia/%' then 'Asia'
            when target_value like 'America/%' then 'America'
            when target_value like 'Europe/%' then 'Europe'
            when target_value like 'Africa/%' then 'Africa'
            when target_value like 'Pacific/%' then 'Pacific'
            when target_value like 'Atlantic/%' then 'Atlantic'
            when target_value like 'Australia/%' then 'Australia'
            when target_value = 'UTC' then 'UTC'
                else 'Other'
              end`,
                );
                s.modify(sql`
              insert into filtered_timezones (region, value, label, compact_label)
              values (
                new_timezone_region,
                target_value,
                cast(target_value as string),
                cast(target_value as string)
              )
            `);
              },
            );
          });
        }}
      >
        {onUnfilteredTimezoneChange && (
          <Show when={sql`is_unfiltered_timezone`}>
            <div
              style={{ display: "none" }}
              onMount={(s) => {
                onUnfilteredTimezoneChange(s, sql`target_value`);
              }}
            />
          </Show>
        )}
        {label
          ? (
            <Typography level="title-sm" className="text-left mb-[-10px]">
              {label}
            </Typography>
          )
          : null}
        <RootSlot {...rootProps}>
          <div
            sx={{
              position: "relative",
              display: "flex",
              flex: 1,
              alignItems: "center",
            }}
          >
            <Show when={sql`target_value is null`}>
              <div className={nullableLabel ? "ml-2" : "opacity-50 ml-2"}>
                {nullableLabel ?? placeholder}
              </div>
            </Show>
            <Switch>
              <Match
                when={sql`exists (select 1 from filtered_timezones where value = target_value)`}
              >
                <div className="ml-2 min-w-0 truncate">
                  {compact
                    ? sql`
                        (select compact_label from filtered_timezones where value = target_value)
                        || ', ' ||
                        format.date(now() at time zone target_value, case when selected_24_hour then '%H:%M' else '%-I:%M%P' end)
                      `
                    : (
                      <>
                        {sql`(select label from filtered_timezones where value = target_value)`}
                        {" "}
                        -{" "}
                        {sql`format.date(now() at time zone target_value, case when selected_24_hour then '%H:%M' else '%-I:%M%P' end)`}
                      </>
                    )}
                </div>
              </Match>
            </Switch>
          </div>
          <div
            sx={{
              ...selectPopoverStyles.popover(),
              minWidth: compact ? "240px" : undefined,
            }}
            tabIndex={-1}
            popover="auto"
            yolmPopoverShowing={sql`popover_open`}
            classes="skip-harmonize"
            id={popoverId}
            floating={{
              anchorEl: sql.lit`${anchorId}`,
              placement: popoverPlacement === "bottom"
                ? "bottom-start"
                : "top-start",
              strategy: "fixed",
              shift: { mainAxis: true, crossAxis: true },
              offset: { mainAxis: 4, crossAxis: 0 },
              flip: { crossAxis: false, mainAxis: false },
            }}
            onToggleHide={(s: DomStatements) => {
              s.setScalar("popover_open", false);
            }}
            style={{
              width: compact
                ? sql`case when popover_width is null or popover_width < 240 then '240px' else popover_width || 'px' end`
                : sql`coalesce(popover_width || 'px', '100%')`,
            }}
          >
            <div
              onClick={(s) => s.event.stopPropagation()}
              onKeyDown={(s) => s.event.stopPropagation()}
            >
              <div className="p-3">
                <Input
                  aria-label="Search timezones"
                  placeholder="Search timezone..."
                  value={sql`search_query`}
                  onInput={(s) =>
                    s.setScalar("search_query", sql`target_value`)}
                  sx={{ flex: 1 }}
                  color={color}
                  variant={variant}
                  size={size}
                  startIcon="Search"
                />

                <div className="flex flex-row mt-2">
                  <Typography
                    sx={{
                      backgroundColor: "background-popup",
                      flex: 1,
                      fontWeight: "bold",
                    }}
                    color={color}
                  >
                    Time zone
                  </Typography>
                  {props.show24HourToggle && (
                    <SwitchControl
                      variant={variant}
                      size={size}
                      color={color}
                      checked={sql`selected_24_hour`}
                      onCheckboxChange={(s) => {
                        s.setScalar("selected_24_hour", sql`target_checked`);
                      }}
                      startDecorator={
                        <Typography color={color}>am/pm</Typography>
                      }
                      endDecorator={<Typography color={color}>24h</Typography>}
                    />
                  )}
                </div>
              </div>
              <List
                sx={{ maxHeight: 300, overflowY: "auto" }}
                color={color}
                size={listSize}
                role="listbox"
              >
                {nullableLabel && (
                  <>
                    <ListItemButton
                      tabIndex={sql`case when target_value is null then 0 else -1 end`}
                      color={color}
                      role="option"
                      aria-selected={sql`target_value is null`}
                      sx={{
                        "&[aria-selected='true']": getVariantStyle(
                          "soft",
                          color,
                          "active",
                        ),
                      }}
                      onClick={(s) => {
                        s.setScalar(
                          "target_value",
                          sql`null::enums.sys_timezone`,
                        );
                        s.setScalar("popover_open", false);
                        if (onInput) {
                          onInput(s, sql`target_value`);
                        }
                        if (onChange) {
                          onChange(s, sql`target_value`);
                        }
                      }}
                      onKeyDown={(s) => {
                        s.if(sql`event.key in (' ', 'Enter')`, (s) => {
                          s.event.preventDefault();
                          s.setScalar(
                            "target_value",
                            sql`null::enums.sys_timezone`,
                          );
                          s.setScalar("popover_open", false);
                          if (onInput) {
                            onInput(s, sql`target_value`);
                          }
                          if (onChange) {
                            onChange(s, sql`target_value`);
                          }
                        });
                      }}
                    >
                      {nullableLabel}
                    </ListItemButton>
                    <ListDivider />
                  </>
                )}
                {(region ? [region] : Object.keys(timezoneRegions)).map(
                  (regionName) => (
                    <>
                      <Show
                        when={sql`exists (
                      select 1 from filtered_timezones
                      where region = ${sql.lit(regionName)}
                      and (
                        search_query = '' or
                        lower(label) like lower('%' || search_query || '%') or
                        lower(compact_label) like lower('%' || search_query || '%') or
                        lower(value) like lower('%' || search_query || '%')
                      )
                    )`}
                      >
                        <ListSubheader color={color} className="bg-popup">
                          {regionName}
                        </ListSubheader>
                        <ListDivider />
                        <Each
                          table="filtered_timezones"
                          recordName="timezone"
                          where={sql`region = ${sql.lit(regionName)} and (
                        search_query = '' or
                        lower(label) like lower('%' || search_query || '%') or
                        lower(compact_label) like lower('%' || search_query || '%') or
                        lower(value) like lower('%' || search_query || '%')
                      )`}
                        >
                          <ListItemButton
                            tabIndex={sql`case when target_value = timezone.value then 0 else -1 end`}
                            color={color}
                            role="option"
                            aria-selected={sql`target_value = timezone.value`}
                            sx={{
                              "&[aria-selected='true']": getVariantStyle(
                                "soft",
                                color,
                                "active",
                              ),
                            }}
                            onClick={(s) => {
                              s.setScalar("target_value", sql`timezone.value`);
                              s.setScalar("popover_open", false);
                              if (onInput) {
                                onInput(s, sql`target_value`);
                              }
                              if (onChange) {
                                onChange(s, sql`target_value`);
                              }
                            }}
                            onKeyDown={(s) => {
                              s.if(
                                sql`event.key in (' ', 'Enter')`,
                                (s) => {
                                  s.event.preventDefault();
                                  s.setScalar(
                                    "target_value",
                                    sql`timezone.value`,
                                  );
                                  s.setScalar("popover_open", false);
                                  if (onInput) {
                                    onInput(s, sql`target_value`);
                                  }
                                  if (onChange) {
                                    onChange(s, sql`target_value`);
                                  }
                                },
                              );
                            }}
                          >
                            {compact
                              ? (
                                <div className="flex w-full min-w-0 items-center justify-between gap-3">
                                  <span className="min-w-0 truncate">
                                    {sql`timezone.compact_label`}
                                  </span>
                                  <span className="shrink-0 text-secondary">
                                    {sql`format.date(now() at time zone timezone.value, case when selected_24_hour then '%H:%M' else '%-I:%M%P' end)`}
                                  </span>
                                </div>
                              )
                              : (
                                <>
                                  {sql`timezone.label`} -{" "}
                                  {sql`format.date(now() at time zone timezone.value, case when selected_24_hour then '%H:%M' else '%-I:%M%P' end)`}
                                </>
                              )}
                          </ListItemButton>
                        </Each>
                      </Show>
                    </>
                  ),
                )}
              </List>
            </div>
          </div>
          <IconSlot {...iconProps}>
            <SvgIcon>
              <SelectIcon />
            </SvgIcon>
          </IconSlot>
          {endDecoratorProp && (
            <EndDecoratorSlot {...endDecoratorProps}>
              {endDecoratorProp}
            </EndDecoratorSlot>
          )}
        </RootSlot>
      </Data>
    </Data>
  );
}
