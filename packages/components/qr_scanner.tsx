import { sql } from "std/sql_utils";
import { Show, useUniqueId } from "std/ui";
import { Data } from "std/data";
import { Button } from "./button";
import { MaterialIcon } from "./material_icon";
import { IconButton } from "./icon_button";
import { Input } from "./input";
import { useJsModule } from "std/js_modules";
import type { DomStatements } from "std/statements";
import type { Sql } from "std/sql_utils";

/**
 * Props for {@link QrScanner}. Choose `"automatic"` mode for kiosk-style
 * "scan one and submit" flows, or `"explicit"` mode when each scan needs
 * to be confirmed (e.g. by the user reviewing the resolved record before
 * acting on it).
 */
interface QrScannerProps {
  /** Scanner mode — automatic confirms each scan, explicit needs a confirm step. */
  mode: "explicit" | "automatic";

  // Core callbacks
  onScan: (s: DomStatements, scannedValue: Sql) => void;
  onClose: (s: DomStatements) => void;

  // Explicit mode: called on detection to resolve QR → display info
  onDetect?: (s: DomStatements, scannedValue: Sql, isCameraScan: Sql) => void;
  onBoundingBoxVisible?: (s: DomStatements) => void;
  onBoundingBoxExpired?: (s: DomStatements) => void;

  // Processing state
  scanning?: Sql;
  errorMessage?: Sql;
  onClearError?: (s: DomStatements) => void;
  /** Optional camera-error fallback for entering a barcode or QR value manually. */
  onManualEntry?: (s: DomStatements, enteredValue: Sql) => void;
  manualEntryLabel?: string;
  manualEntryPlaceholder?: string;

  // Display message for confirmation panel (set by onDetect callback)
  detectMessage?: Sql;
  candidateValue?: Sql;

  // Automatic mode confirm props (existing behavior)
  scanPhase?: Sql;
  confirmMessage?: Sql;
  onConfirm?: (s: DomStatements) => void;
  onReject?: (s: DomStatements) => void;

  // Photo capture endpoint URL (Sql string expression).
  // When provided, enables the photo capture flow (confirm → take photo → upload).
  // The component calls confirmAndCapture with this URL.
  captureEndpoint?: Sql;
  onUploadComplete?: (s: DomStatements) => void;
  onUploadFailed?: (s: DomStatements) => void;

  // Display
  itemCount?: Sql;

  // Audio/haptic feedback (default true)
  enableAudio?: boolean;
  enableVibration?: boolean;
}

/**
 * Camera-backed QR scanner with optional photo-capture flow. Pairs with
 * the `qr_scanner` JS module — calls `useJsModule("qr_scanner")`
 * internally. Renders a full-screen scanner overlay with confirm /
 * cancel actions wired to the supplied callbacks.
 *
 * See {@link https://docs.yolm.io/ui/mobile_capture_scanning | Mobile capture & scanning}.
 */
export function QrScanner({
  mode,
  onScan,
  onClose,
  onDetect,
  onBoundingBoxVisible,
  onBoundingBoxExpired,
  scanning,
  errorMessage,
  onClearError,
  onManualEntry,
  manualEntryLabel,
  manualEntryPlaceholder,
  detectMessage,
  candidateValue,
  scanPhase,
  confirmMessage,
  onConfirm,
  onReject,
  captureEndpoint,
  onUploadComplete,
  onUploadFailed,
  itemCount,
  enableAudio,
  enableVibration,
}: QrScannerProps) {
  useJsModule("qr_scanner");
  const scannerId = useUniqueId();
  const handle = sql.concat(scannerId, sql.lit`-scanner-handle`);
  const mountContainerId = sql.concat(scannerId, sql.lit`-scanner-mount`);

  if (mode === "explicit") {
    return ExplicitScanner({
      handle,
      mountContainerId,
      onScan,
      onClose,
      onDetect,
      onBoundingBoxVisible,
      onBoundingBoxExpired,
      scanning,
      errorMessage,
      onClearError,
      onManualEntry,
      manualEntryLabel,
      manualEntryPlaceholder,
      detectMessage,
      candidateValue,
      scanPhase,
      onConfirm,
      onReject,
      captureEndpoint,
      onUploadComplete,
      onUploadFailed,
      itemCount,
      enableAudio,
      enableVibration,
    });
  }

  return AutomaticScanner({
    handle,
    mountContainerId,
    onScan,
    onClose,
    scanning,
    errorMessage,
    onClearError,
    onManualEntry,
    manualEntryLabel,
    manualEntryPlaceholder,
    scanPhase,
    confirmMessage,
    onConfirm,
    onReject,
    captureEndpoint,
    onUploadComplete,
    onUploadFailed,
    itemCount,
    enableAudio,
    enableVibration,
  });
}

// ---------------------------------------------------------------------------
// Shared UI fragments
// ---------------------------------------------------------------------------

function ScannerHeader({
  handle,
  onClose,
  itemCount,
  extraStatus,
}: {
  handle: Sql;
  onClose: (s: DomStatements) => void;
  itemCount?: Sql;
  extraStatus?: () => ReturnType<typeof Show>;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-black/80 z-10">
      <div className="flex items-center gap-2">
        <IconButton
          icon="Close"
          variant="plain"
          color="neutral"
          size="lg"
          className="text-white"
          onClick={onClose}
        />
        <Show when={itemCount ? sql`true` : sql`false`}>
          <span className="text-white/80 text-sm font-medium">
            {itemCount ?? sql.lit``} scanned
          </span>
        </Show>
        {extraStatus?.()}
      </div>
      <Show when={sql`camera_ready`}>
        <div className="flex items-center gap-1">
          <IconButton
            icon="Cameraswitch"
            variant="plain"
            color="neutral"
            size="lg"
            className="text-white"
            onClick={(s) => {
              s.jsCall({
                module: "qr_scanner",
                exportName: "switchCamera",
                handle,
                argJson: sql`json_build_object('handle', ${handle})`,
              });
            }}
          />
          <IconButton
            icon="FlashOn"
            variant="plain"
            color="neutral"
            size="lg"
            className="text-white"
            onClick={(s) => {
              s.jsCall({
                module: "qr_scanner",
                exportName: "toggleFlash",
                handle,
                argJson: sql`json_build_object('handle', ${handle})`,
              });
            }}
          />
        </div>
      </Show>
    </div>
  );
}

function CameraContainer({
  handle,
  mountContainerId,
  enableAudio,
  enableVibration,
}: {
  handle: Sql;
  mountContainerId: Sql;
  enableAudio?: boolean;
  enableVibration?: boolean;
}) {
  return (
    <div className="w-full h-full bg-gray-900 relative">
      <div
        id={mountContainerId}
        className="absolute inset-0"
        onMount={(s) => {
          s.jsCall({
            module: "qr_scanner",
            exportName: "initializeScanner",
            handle,
            argJson:
              sql`json_build_object('handle', ${handle}, 'elementId', ${mountContainerId}, 'enableAudio', ${
                enableAudio !== false ? sql`true` : sql`false`
              }, 'enableVibration', ${
                enableVibration !== false ? sql`true` : sql`false`
              })`,
          });
        }}
      />
      <Show when={sql`not camera_ready and camera_error = ''`}>
        <div className="w-full h-full flex flex-col items-center justify-center text-white">
          <MaterialIcon
            icon="CameraAlt"
            className="text-5xl mb-3 opacity-50 animate-pulse"
          />
          <p className="text-sm opacity-75">Starting camera...</p>
        </div>
      </Show>
    </div>
  );
}

function CornerMarkers({ opacity }: { opacity?: string }) {
  const borderClass = opacity === "50" ? "border-white/50" : "border-white/70";
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        className={`absolute top-6 left-6 w-12 h-12 border-l-3 border-t-3 ${borderClass} rounded-tl-lg`}
      />
      <div
        className={`absolute top-6 right-6 w-12 h-12 border-r-3 border-t-3 ${borderClass} rounded-tr-lg`}
      />
      <div
        className={`absolute bottom-6 left-6 w-12 h-12 border-l-3 border-b-3 ${borderClass} rounded-bl-lg`}
      />
      <div
        className={`absolute bottom-6 right-6 w-12 h-12 border-r-3 border-b-3 ${borderClass} rounded-br-lg`}
      />
    </div>
  );
}

function CameraErrorOverlay({
  onManualEntry,
  manualEntryLabel,
  manualEntryPlaceholder,
}: {
  onManualEntry?: (s: DomStatements, enteredValue: Sql) => void;
  manualEntryLabel?: string;
  manualEntryPlaceholder?: string;
}) {
  const manualInputId = useUniqueId();
  return (
    <Show when={sql`camera_error != ''`}>
      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6">
        <MaterialIcon
          icon="VideocamOff"
          className="text-5xl text-danger-400 mb-3"
        />
        <p className="text-white text-center mb-4">
          {sql`camera_error`}
        </p>
        {onManualEntry
          ? (
            <div className="w-full max-w-sm rounded-xl bg-white p-4">
              <label
                htmlFor={manualInputId}
                className="mb-2 block text-sm font-semibold text-neutral-900"
              >
                {manualEntryLabel ?? "Enter code instead"}
              </label>
              <Input
                id={manualInputId}
                bindScalar="manual_entry_value"
                size="lg"
                fullWidth
                placeholder={manualEntryPlaceholder ?? "Scan or type a code"}
              />
              <Button
                size="lg"
                className="mt-3 w-full"
                disabled={sql`trim(manual_entry_value) = ''`}
                onClick={(s) => onManualEntry(s, sql`trim(manual_entry_value)`)}
              >
                Open
              </Button>
            </div>
          )
          : (
            <p className="text-white/60 text-sm text-center">
              You can still use a hardware scanner
            </p>
          )}
      </div>
    </Show>
  );
}

function ErrorPanel({
  handle,
  when,
  errorExpr,
  onClearError,
}: {
  handle: Sql;
  when: Sql;
  errorExpr: Sql;
  onClearError?: (s: DomStatements) => void;
}) {
  return (
    <Show when={when}>
      <div className="absolute bottom-0 left-0 right-0 bg-danger-600 p-4 shadow-lg">
        <div className="flex items-center gap-3 mb-3">
          <MaterialIcon icon="Error" className="text-white text-2xl" />
          <p className="text-white font-medium flex-1">{errorExpr}</p>
        </div>
        <Button
          variant="solid"
          color="danger"
          size="lg"
          className="w-full bg-white text-danger-700 hover:bg-danger-50"
          onClick={(s) => {
            s.jsCall({
              module: "qr_scanner",
              exportName: "resetLastScan",
              handle,
              argJson: sql`json_build_object('handle', ${handle})`,
            });
            if (onClearError) onClearError(s);
          }}
        >
          Dismiss
        </Button>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Explicit mode: Detect → Confirm → Take Photo → auto-cycle
// ---------------------------------------------------------------------------

interface ExplicitScannerProps {
  handle: Sql;
  mountContainerId: Sql;
  onScan: (s: DomStatements, scannedValue: Sql) => void;
  onClose: (s: DomStatements) => void;
  onDetect?: (s: DomStatements, scannedValue: Sql, isCameraScan: Sql) => void;
  onBoundingBoxVisible?: (s: DomStatements) => void;
  onBoundingBoxExpired?: (s: DomStatements) => void;
  scanning?: Sql;
  errorMessage?: Sql;
  onClearError?: (s: DomStatements) => void;
  onManualEntry?: (s: DomStatements, enteredValue: Sql) => void;
  manualEntryLabel?: string;
  manualEntryPlaceholder?: string;
  detectMessage?: Sql;
  candidateValue?: Sql;
  scanPhase?: Sql;
  onConfirm?: (s: DomStatements) => void;
  onReject?: (s: DomStatements) => void;
  captureEndpoint?: Sql;
  onUploadComplete?: (s: DomStatements) => void;
  onUploadFailed?: (s: DomStatements) => void;
  itemCount?: Sql;
  enableAudio?: boolean;
  enableVibration?: boolean;
}

function ExplicitScanner({
  handle,
  mountContainerId,
  onScan,
  onClose,
  onDetect,
  onBoundingBoxVisible,
  onBoundingBoxExpired,
  scanning,
  errorMessage,
  onClearError,
  onManualEntry,
  manualEntryLabel,
  manualEntryPlaceholder,
  detectMessage,
  candidateValue,
  scanPhase,
  onConfirm,
  onReject,
  captureEndpoint,
  onUploadComplete,
  onUploadFailed,
  itemCount,
  enableAudio,
  enableVibration,
}: ExplicitScannerProps) {
  const scanningExpr = scanning ?? sql`false`;
  const errorExpr = errorMessage ?? sql.lit``;
  const scanPhaseExpr = scanPhase ?? sql.lit`scanning`;
  const candidateValueExpr = candidateValue ?? sql.lit``;
  const detectMsg = detectMessage
    ? sql`case when ${detectMessage} != '' then ${detectMessage} else ${candidateValueExpr} end`
    : candidateValueExpr;
  const hasPhotos = captureEndpoint !== undefined;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("camera_ready", sql`false`);
        s.defScalar("camera_error", sql.lit``);
        if (onManualEntry) {
          s.defScalar("manual_entry_value", sql.lit``);
        }
        s.defScalar("success_flash_visible", sql`false`);
        s.defScalar("hw_toast_visible", sql`false`);
        if (hasPhotos) {
          s.defScalar("uploading", sql`false`);
        }
      }}
    >
      <div
        className="fixed inset-0 z-50 bg-black flex flex-col"
        js={{
          handles: [
            {
              module: "qr_scanner",
              cleanup: "cleanup",
              handle,
            },
          ],
          on: {
            "qr_scanner.error": (s) => {
              s.setScalar(
                "camera_error",
                sql`event.payload_json->>'message'`,
              );
              s.setScalar("camera_ready", sql`false`);
            },
            "qr_scanner.initialized": (s) => {
              s.setScalar("camera_ready", sql`true`);
              s.setScalar("camera_error", sql.lit``);
            },
            "qr_scanner.boundingBoxVisible": (s) => {
              if (onBoundingBoxVisible) onBoundingBoxVisible(s);
            },
            "qr_scanner.boundingBoxExpired": (s) => {
              if (onBoundingBoxExpired) onBoundingBoxExpired(s);
              s.jsCall({
                module: "qr_scanner",
                exportName: "resetLastScan",
                handle,
                argJson: sql`json_build_object('handle', ${handle})`,
              });
            },
            "qr_scanner.qrCodeDetected": (s) => {
              const isCameraScan =
                sql`not (event.payload_json->'location' is null or event.payload_json->'location'->'topLeft' is null)`;
              s.if(sql`not ${isCameraScan}`, (s) => {
                s.setScalar("hw_toast_visible", sql`true`);
                s.commitUiTreeChanges();
                s.setScalar("hw_toast_visible", sql`false`);
              });
              if (onDetect) {
                onDetect(s, sql`event.payload_json->>'data'`, isCameraScan);
              }
            },
            ...(hasPhotos
              ? {
                "qr_scanner.uploadStarted": (s: DomStatements) => {
                  s.setScalar("uploading", sql`true`);
                },
                "qr_scanner.uploadComplete": (s: DomStatements) => {
                  s.setScalar("uploading", sql`false`);
                  s.setScalar("success_flash_visible", sql`true`);
                  s.commitUiTreeChanges();
                  s.setScalar("success_flash_visible", sql`false`);
                  s.jsCall({
                    module: "qr_scanner",
                    exportName: "startScanning",
                    handle,
                    argJson: sql`json_build_object('handle', ${handle})`,
                  });
                  s.jsCall({
                    module: "qr_scanner",
                    exportName: "resetLastScan",
                    handle,
                    argJson: sql`json_build_object('handle', ${handle})`,
                  });
                  if (onUploadComplete) onUploadComplete(s);
                },
                "qr_scanner.uploadFailed": (s: DomStatements) => {
                  s.setScalar("uploading", sql`false`);
                  if (onUploadFailed) onUploadFailed(s);
                },
              }
              : {}),
          },
        }}
      >
        <ScannerHeader
          handle={handle}
          onClose={onClose}
          itemCount={itemCount}
        />

        {/* Camera viewfinder */}
        <div className="flex-1 relative overflow-hidden">
          <CameraContainer
            handle={handle}
            mountContainerId={mountContainerId}
            enableAudio={enableAudio}
            enableVibration={enableVibration}
          />

          {/* Corner markers — scanning phase */}
          <Show when={sql`camera_ready and ${scanPhaseExpr} = 'scanning'`}>
            <CornerMarkers />
          </Show>

          {/* Corner markers — confirmed phase (dimmer, camera visible for framing) */}
          <Show when={sql`camera_ready and ${scanPhaseExpr} = 'confirmed'`}>
            <CornerMarkers opacity="50" />
          </Show>

          {/* Success flash overlay */}
          <Show when={sql`success_flash_visible`}>
            <div className="absolute inset-0 bg-success-500/80 flex items-center justify-center z-20">
              <MaterialIcon
                icon="CheckCircle"
                className="text-white text-7xl"
              />
            </div>
          </Show>

          {/* Processing/validating overlay */}
          <Show
            when={sql`${scanningExpr} and ${scanPhaseExpr} = 'scanning'`}
          >
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="text-white text-center">
                <MaterialIcon icon="Sync" className="text-4xl animate-spin" />
                <p className="text-sm mt-2">Validating...</p>
              </div>
            </div>
          </Show>

          <CameraErrorOverlay
            onManualEntry={onManualEntry}
            manualEntryLabel={manualEntryLabel}
            manualEntryPlaceholder={manualEntryPlaceholder}
          />

          {/* Hardware scanner toast */}
          <Show when={sql`hw_toast_visible`}>
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-800/90 text-white px-4 py-2 rounded-full text-sm flex items-center gap-2 z-30">
              <MaterialIcon icon="QrCodeScanner" className="text-base" />
              Scanned via hardware
            </div>
          </Show>

          {/* Detection panel — scanning phase, QR detected */}
          <Show
            when={sql`${scanPhaseExpr} = 'candidate' and ${candidateValueExpr} != '' and ${errorExpr} = '' and not ${scanningExpr}`}
          >
            <div
              className="absolute bottom-0 left-0 right-0 bg-gray-900/95 p-4 shadow-lg"
              sx={{ borderLeft: "4px solid #f97316" }}
            >
              <div className="flex items-center gap-3 mb-3">
                <MaterialIcon
                  icon="QrCodeScanner"
                  className="text-2xl"
                  sx={{ color: "#f97316" }}
                />
                <p className="text-white font-semibold text-lg flex-1">
                  {detectMsg}
                </p>
              </div>
              <Button
                variant="solid"
                size="lg"
                className="w-full text-white font-semibold"
                sx={{ backgroundColor: "#f97316", borderColor: "#f97316" }}
                onClick={hasPhotos
                  ? {
                    detachedFromNode: true,
                    procedure: (s) => {
                      if (onConfirm) onConfirm(s);
                      s.jsCall({
                        module: "qr_scanner",
                        exportName: "stopScanning",
                        handle,
                        argJson: sql`json_build_object('handle', ${handle})`,
                      });
                    },
                  }
                  : {
                    detachedFromNode: true,
                    procedure: (s) => {
                      if (onConfirm) {
                        onConfirm(s);
                      } else {
                        onScan(s, candidateValueExpr);
                      }
                      // s.jsCall({
                      //   module: "qr_scanner",
                      //   exportName: "hideBoundingBox",
                      //   handle,
                      //   argJson: sql`json_build_object('handle', ${handle})`,
                      // });
                      // s.jsCall({
                      //   module: "qr_scanner",
                      //   exportName: "resetLastScan",
                      //   handle,
                      //   argJson: sql`json_build_object('handle', ${handle})`,
                      // });
                    },
                  }}
              >
                Confirm
              </Button>
            </div>
          </Show>

          {/* Confirmed panel — take photo */}
          {hasPhotos && (
            <Show when={sql`${scanPhaseExpr} = 'confirmed'`}>
              <div className="absolute bottom-0 left-0 right-0 bg-primary-600 p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-3">
                  <MaterialIcon
                    icon="Lock"
                    className="text-white text-2xl"
                  />
                  <p className="text-white font-semibold text-lg flex-1">
                    {detectMsg}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outlined"
                    color="neutral"
                    size="lg"
                    className="border-white/50 text-white hover:bg-white/10 py-4"
                    onClick={(s) => {
                      if (onReject) onReject(s);
                      s.jsCall({
                        module: "qr_scanner",
                        exportName: "startScanning",
                        handle,
                        argJson: sql`json_build_object('handle', ${handle})`,
                      });
                      s.jsCall({
                        module: "qr_scanner",
                        exportName: "resetLastScan",
                        handle,
                        argJson: sql`json_build_object('handle', ${handle})`,
                      });
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    variant="solid"
                    color="primary"
                    size="lg"
                    className="flex-1 bg-white text-primary-700 hover:bg-primary-50 py-4 text-lg font-semibold"
                    disabled={sql`uploading or ${scanningExpr}`}
                    onClick={{
                      detachedFromNode: true,
                      procedure: (s) => {
                        s.jsCall({
                          module: "qr_scanner",
                          exportName: "confirmAndCapture",
                          handle,
                          argJson:
                            sql`json_build_object('handle', ${handle}, 'endpoint', ${captureEndpoint!})`,
                        });
                      },
                    }}
                  >
                    <MaterialIcon icon="CameraAlt" />
                    <span className="ml-2">Take Photo</span>
                  </Button>
                </div>
              </div>
            </Show>
          )}

          {/* Error overlay */}
          <ErrorPanel
            handle={handle}
            when={sql`${errorExpr} != ''`}
            errorExpr={errorExpr}
            onClearError={(s) => {
              if (onReject) onReject(s);
              if (onClearError) onClearError(s);
            }}
          />
        </div>
      </div>
    </Data>
  );
}

// ---------------------------------------------------------------------------
// Automatic mode: existing behavior (backward-compatible)
// ---------------------------------------------------------------------------

interface AutomaticScannerProps {
  handle: Sql;
  mountContainerId: Sql;
  onScan: (s: DomStatements, scannedValue: Sql) => void;
  onClose: (s: DomStatements) => void;
  scanning?: Sql;
  errorMessage?: Sql;
  onClearError?: (s: DomStatements) => void;
  onManualEntry?: (s: DomStatements, enteredValue: Sql) => void;
  manualEntryLabel?: string;
  manualEntryPlaceholder?: string;
  scanPhase?: Sql;
  confirmMessage?: Sql;
  onConfirm?: (s: DomStatements) => void;
  onReject?: (s: DomStatements) => void;
  captureEndpoint?: Sql;
  onUploadComplete?: (s: DomStatements) => void;
  onUploadFailed?: (s: DomStatements) => void;
  itemCount?: Sql;
  enableAudio?: boolean;
  enableVibration?: boolean;
}

function AutomaticScanner({
  handle,
  mountContainerId,
  onScan,
  onClose,
  scanning,
  errorMessage,
  onClearError,
  onManualEntry,
  manualEntryLabel,
  manualEntryPlaceholder,
  scanPhase,
  confirmMessage,
  onConfirm,
  onReject,
  captureEndpoint,
  onUploadComplete,
  onUploadFailed,
  itemCount,
  enableAudio,
  enableVibration,
}: AutomaticScannerProps) {
  const confirmMode = scanPhase !== undefined;
  const scanningExpr = scanning ?? sql`false`;
  const errorExpr = errorMessage ?? sql.lit``;
  const confirmMsg = confirmMessage ?? sql.lit`Item detected`;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("camera_ready", sql`false`);
        s.defScalar("camera_error", sql.lit``);
        if (onManualEntry) {
          s.defScalar("manual_entry_value", sql.lit``);
        }
        s.defScalar("dismiss_overlay", sql`false`);
        s.defScalar("scan_success_flash", sql`false`);
        if (confirmMode) {
          s.defScalar("uploading_count", sql`0`);
        }
      }}
    >
      <div
        className="fixed inset-0 z-50 bg-black flex flex-col"
        js={{
          handles: [
            {
              module: "qr_scanner",
              cleanup: "cleanup",
              handle,
            },
          ],
          on: {
            "qr_scanner.error": (s) => {
              s.setScalar(
                "camera_error",
                sql`event.payload_json->>'message'`,
              );
              s.setScalar("camera_ready", sql`false`);
            },
            "qr_scanner.initialized": (s) => {
              s.setScalar("camera_ready", sql`true`);
              s.setScalar("camera_error", sql.lit``);
            },
            "qr_scanner.qrCodeDetected": (s) => {
              if (confirmMode) {
                s.if(sql`${scanPhase} = 'ready'`, (s) => {
                  s.setScalar("dismiss_overlay", sql`false`);
                  onScan(s, sql`event.payload_json->>'data'`);
                });
              } else {
                // Simple mode: flash green corners then process
                s.setScalar("scan_success_flash", sql`false`);
                s.setScalar("dismiss_overlay", sql`false`);
                s.commitUiTreeChanges();
                s.setScalar("scan_success_flash", sql`true`);
                s.commitUiTreeChanges();
                onScan(s, sql`event.payload_json->>'data'`);
                s.setScalar("scan_success_flash", sql`false`);
              }
            },
            ...(confirmMode
              ? {
                "qr_scanner.uploadStarted": (s: DomStatements) => {
                  s.setScalar("uploading_count", sql`uploading_count + 1`);
                },
                "qr_scanner.uploadComplete": (s: DomStatements) => {
                  s.setScalar("uploading_count", sql`uploading_count - 1`);
                  if (onUploadComplete) onUploadComplete(s);
                },
                "qr_scanner.uploadFailed": (s: DomStatements) => {
                  s.setScalar("uploading_count", sql`uploading_count - 1`);
                  if (onUploadFailed) onUploadFailed(s);
                },
              }
              : {}),
          },
        }}
      >
        <ScannerHeader
          handle={handle}
          onClose={onClose}
          itemCount={itemCount}
          extraStatus={confirmMode
            ? () => (
              <Show when={sql`uploading_count > 0`}>
                <span className="text-yellow-300/80 text-sm">
                  {sql`uploading_count`} uploading
                </span>
              </Show>
            )
            : undefined}
        />

        {/* Camera viewfinder */}
        <div className="flex-1 relative overflow-hidden">
          <CameraContainer
            handle={handle}
            mountContainerId={mountContainerId}
            enableAudio={enableAudio}
            enableVibration={enableVibration}
          />

          {/* Corner scan markers */}
          {confirmMode
            ? (
              <Show when={sql`camera_ready and ${scanPhase} = 'ready'`}>
                <CornerMarkers />
              </Show>
            )
            : (
              <Show when={sql`camera_ready`}>
                <Show when={sql`not scan_success_flash`}>
                  <CornerMarkers />
                </Show>
                <Show when={sql`scan_success_flash`}>
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-6 left-6 w-14 h-14 border-l-4 border-t-4 border-success-400 rounded-tl-lg" />
                    <div className="absolute top-6 right-6 w-14 h-14 border-r-4 border-t-4 border-success-400 rounded-tr-lg" />
                    <div className="absolute bottom-6 left-6 w-14 h-14 border-l-4 border-b-4 border-success-400 rounded-bl-lg" />
                    <div className="absolute bottom-6 right-6 w-14 h-14 border-r-4 border-b-4 border-success-400 rounded-br-lg" />
                  </div>
                </Show>
              </Show>
            )}

          {/* Processing/validating overlay — tap to dismiss */}
          <Show when={sql`${scanningExpr} and not dismiss_overlay`}>
            <div
              className="absolute inset-0 bg-black/40 flex items-center justify-center"
              onClick={(s) => s.setScalar("dismiss_overlay", sql`true`)}
            >
              <div className="text-white text-center">
                <MaterialIcon icon="Sync" className="text-4xl animate-spin" />
                <p className="text-sm mt-2">
                  {confirmMode ? "Validating..." : "Processing..."}
                </p>
                <p className="text-xs mt-3 opacity-50">Tap to dismiss</p>
              </div>
            </div>
          </Show>

          <CameraErrorOverlay
            onManualEntry={onManualEntry}
            manualEntryLabel={manualEntryLabel}
            manualEntryPlaceholder={manualEntryPlaceholder}
          />

          {/* Green confirm overlay (confirm mode only) */}
          {confirmMode && onConfirm && onReject && (
            <Show when={sql`${scanPhase} = 'confirming'`}>
              <div className="absolute bottom-0 left-0 right-0 bg-success-600 p-4 shadow-lg">
                <div className="flex items-center gap-3 mb-3">
                  <MaterialIcon
                    icon="CheckCircle"
                    className="text-white text-2xl"
                  />
                  <p className="text-white font-semibold text-lg flex-1">
                    {confirmMsg}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outlined"
                    color="neutral"
                    size="lg"
                    className="border-white/50 text-white hover:bg-white/10 py-4"
                    onClick={(s) => {
                      s.jsCall({
                        module: "qr_scanner",
                        exportName: "resetLastScan",
                        handle,
                        argJson: sql`json_build_object('handle', ${handle})`,
                      });
                      onReject(s);
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="solid"
                    color="success"
                    size="lg"
                    className="flex-1 bg-white text-success-700 hover:bg-success-50 py-4 text-lg font-semibold"
                    onClick={{
                      detachedFromNode: true,
                      procedure: (s) => {
                        onConfirm(s);
                        if (captureEndpoint) {
                          s.jsCall({
                            module: "qr_scanner",
                            exportName: "confirmAndCapture",
                            handle,
                            argJson:
                              sql`json_build_object('handle', ${handle}, 'endpoint', ${captureEndpoint})`,
                          });
                        }
                        s.jsCall({
                          module: "qr_scanner",
                          exportName: "resetLastScan",
                          handle,
                          argJson: sql`json_build_object('handle', ${handle})`,
                        });
                      },
                    }}
                  >
                    <MaterialIcon icon="CameraAlt" />
                    <span className="ml-2">Confirm + Snap</span>
                  </Button>
                </div>
              </div>
            </Show>
          )}

          {/* Error overlay */}
          {confirmMode
            ? (
              <ErrorPanel
                handle={handle}
                when={sql`${scanPhase} = 'ready' and not ${scanningExpr} and ${errorExpr} != ''`}
                errorExpr={errorExpr}
                onClearError={onClearError}
              />
            )
            : (
              <ErrorPanel
                handle={handle}
                when={sql`${errorExpr} != ''`}
                errorExpr={errorExpr}
                onClearError={onClearError}
              />
            )}
        </div>
      </div>
    </Data>
  );
}
