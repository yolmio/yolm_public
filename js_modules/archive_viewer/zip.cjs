// Use the package's CommonJS build so Bun's IIFE output does not retain the
// ESM build's import.meta worker-base probe. This viewer disables workers.
module.exports = require("@zip.js/zip.js");
