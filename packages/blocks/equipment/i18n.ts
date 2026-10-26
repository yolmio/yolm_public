import { createTranslator } from "std/i18n";

export const { t: equipmentText } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: {
      unavailable: "Unavailable",
      needsAttention: "Needs attention",
      operational: "Operational",
      unknown: "Unknown",
      planned: "Planned",
      commissioning: "Commissioning",
      inService: "In service",
      stored: "Stored",
      retired: "Retired",
    },
    es: {
      unavailable: "No disponible",
      needsAttention: "Requiere atención",
      operational: "Operativo",
      unknown: "Desconocido",
      planned: "Planificado",
      commissioning: "En puesta en marcha",
      inService: "En servicio",
      stored: "Almacenado",
      retired: "Retirado",
    },
  },
});
