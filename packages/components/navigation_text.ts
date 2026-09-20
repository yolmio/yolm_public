import { createTranslator } from "std/i18n";

/** Shared chrome follows the language supplied through setUserLanguage. */
export const { t: navigationText } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: {
      navigation: "Navigation",
      mobileNavigation: "Mobile navigation",
      collapsedNavigation: "Collapsed navigation",
      openNavigation: "Open navigation",
      closeNavigation: "Close navigation",
      expandNavigation: "Expand navigation",
      collapseNavigation: "Collapse navigation",
      accountAndApps: "Account and apps",
      apps: "Apps",
      logout: "Log out",
    },
    es: {
      navigation: "Navegación",
      mobileNavigation: "Navegación móvil",
      collapsedNavigation: "Navegación contraída",
      openNavigation: "Abrir navegación",
      closeNavigation: "Cerrar navegación",
      expandNavigation: "Expandir navegación",
      collapseNavigation: "Contraer navegación",
      accountAndApps: "Cuenta y aplicaciones",
      apps: "Aplicaciones",
      logout: "Cerrar sesión",
    },
  },
});
