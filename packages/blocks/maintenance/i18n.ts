import { createTranslator } from "std/i18n";

export const { t: maintenanceText } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: {
      emergency: "Emergency",
      high: "High",
      normal: "Normal",
      low: "Low",
    },
    es: {
      emergency: "Emergencia",
      high: "Alta",
      normal: "Normal",
      low: "Baja",
    },
  },
});
