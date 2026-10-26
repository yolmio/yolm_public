import { createTranslator } from "std/i18n";

export const { t: qrScannerText } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: {
      scanned: "scanned",
      startingCamera: "Starting camera...",
      cameraUnavailable:
        "Camera unavailable. Enter the equipment code instead.",
      enterCode: "Enter code instead",
      scanOrType: "Scan or type a code",
      open: "Open",
      hardwareAvailable: "You can still use a hardware scanner",
      dismiss: "Dismiss",
      validating: "Validating...",
      processing: "Processing...",
      tapToDismiss: "Tap to dismiss",
      hardwareScan: "Scanned via hardware",
      confirm: "Confirm",
      reject: "Reject",
      confirmAndSnap: "Confirm + Snap",
      back: "Back",
      takePhoto: "Take Photo",
    },
    es: {
      scanned: "escaneados",
      startingCamera: "Iniciando cámara…",
      cameraUnavailable:
        "La cámara no está disponible. Ingrese el código del equipo.",
      enterCode: "Ingresar código",
      scanOrType: "Escanee o escriba un código",
      open: "Abrir",
      hardwareAvailable: "También puede usar un escáner físico",
      dismiss: "Cerrar",
      validating: "Validando...",
      processing: "Procesando...",
      tapToDismiss: "Toque para cerrar",
      hardwareScan: "Escaneado con lector físico",
      confirm: "Confirmar",
      reject: "Rechazar",
      confirmAndSnap: "Confirmar y tomar foto",
      back: "Volver",
      takePhoto: "Tomar foto",
    },
  },
});
