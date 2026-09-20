# Browser JavaScript modules

These modules extend Yolm browser UI. Source code and module-local package.json and bun.lock files are included; the proprietary Yolm compiler, runtime and deployment tooling are not.

## Dependencies

Review each module's dependency manifest before installing dependencies. Modules with a package.json use their local dependency installation; node_modules is not included. Installing dependencies is not necessary just to read the source. The root runtime deployment registry is not part of this source export.

## Runtime assets

The seven PDF.js links under pdf_markup/files are preserved as relative symlinks to that module's node_modules/pdfjs-dist. Their targets are supplied by installing the pinned dependency; this export never follows the links or copies those third-party files.

Bundled GLB/Draco decoder payloads under glb_viewer/files are omitted. Obtain the decoder assets from the module's pinned three dependency and configure the runtime sidecar URLs when deploying. These source files alone are not a complete deployed module bundle.

The adapted DRACOLoader retains the upstream MIT license in glb_viewer/vendor/LICENSE. Refer to ../NOTICE for third-party attribution.
