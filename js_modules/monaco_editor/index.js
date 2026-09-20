const __v2 = 1;
// Monaco Editor Module for Yolm Studio
import JSZip from "jszip";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { INITIAL } from "@shikijs/vscode-textmate";
import typstLang from "shiki/langs/typst.mjs";
import githubLight from "shiki/themes/github-light.mjs";

// Module state
let monaco = null;
let editors = new Map();
let models = new Map();
let fileCache = new Map();
let packagesZip = null;
let zipFileMap = new Map();
let systemFiles = new Map();
let configuredTypeScriptVersionId = undefined;
let lastEventData = {};
let eventDataByHandle = new Map();
let suppressContentChanged = false;

if (typeof window !== "undefined") {
  window.monacoDebug = {
    get models() {
      return models;
    },
    get zipFileMap() {
      return zipFileMap;
    },
    get systemFiles() {
      return systemFiles;
    },
    get monaco() {
      return monaco;
    },
  };
}

const editorConfig = {
  automaticLayout: true,
  minimap: { enabled: false },
  theme: "vs-light",
  fontSize: 14,
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: true,
  renderValidationDecorations: "on",
  mouseWheelZoom: false,
  smoothScrolling: true,
  dragAndDrop: false,
  linkedEditing: true,
  renderControlCharacters: false,
  wordWrap: "off",
  scrollbar: {
    vertical: "visible",
    horizontal: "auto",
  },
  renderLineHighlight: "line",
  renderWhitespace: "none",
  quickSuggestions: {
    other: true,
    comments: false,
    strings: false,
  },
};

function getLanguageFromPath(path) {
  if (path.endsWith(".d.ts")) return "typescript";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".tsx")) return "typescript"; // Use 'typescript' not 'typescriptreact'
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".jsx")) return "javascript"; // Use 'javascript' not 'javascriptreact'

  const extension = path.split(".").pop().toLowerCase();
  const extensionLanguageMap = {
    "json": "json",
    "html": "html",
    "css": "css",
    "md": "markdown",
    "markdown": "markdown",
    "txt": "plaintext",
    "xml": "xml",
    "yaml": "yaml",
    "yml": "yaml",
    "sql": "sql",
    "py": "python",
    "sh": "shell",
    "bash": "shell",
    "dockerfile": "dockerfile",
    "bas": "vb",
    "vb": "vb",
    "vbs": "vb",
    "vba": "vb",
    "typ": "typst",
  };

  return extensionLanguageMap[extension] || "plaintext";
}

async function loadMonaco() {
  if (monaco) return monaco;

  return new Promise((resolve, reject) => {
    if (window.monaco) {
      monaco = window.monaco;
      resolve(monaco);
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js";

    script.onerror = () => reject(new Error("Failed to load Monaco loader"));

    script.onload = () => {
      window.require.config({
        paths: {
          vs:
            "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
        },
      });

      window.require([
        "vs/editor/editor.main",
        "vs/language/typescript/tsWorker",
      ], () => {
        monaco = window.monaco;
        resolve(monaco);
      }, (err) => reject(err));
    };

    document.head.appendChild(script);
  });
}

class ShikiTokenState {
  constructor(ruleStack) {
    this._ruleStack = ruleStack;
  }
  get ruleStack() {
    return this._ruleStack;
  }
  clone() {
    return new ShikiTokenState(this._ruleStack);
  }
  equals(other) {
    return other instanceof ShikiTokenState &&
      other._ruleStack === this._ruleStack;
  }
}

let shikiSetupDone = false;
async function setupShikiTypst() {
  if (shikiSetupDone || !monaco) return;
  shikiSetupDone = true;

  try {
    // Register typst as a Monaco language
    monaco.languages.register({
      id: "typst",
      extensions: [".typ"],
      aliases: ["Typst", "typ"],
    });

    // Create Shiki highlighter with JS regex engine (no WASM)
    const highlighter = await createHighlighterCore({
      themes: [githubLight],
      langs: [typstLang],
      engine: createJavaScriptRegexEngine(),
    });

    // Get the grammar for direct tokenization (avoids shikiToMonaco theme monkey-patching)
    const grammar = highlighter.getLanguage("typst");

    monaco.languages.setTokensProvider("typst", {
      getInitialState() {
        return new ShikiTokenState(INITIAL);
      },
      tokenize(line, state) {
        const result = grammar.tokenizeLine(line, state.ruleStack);
        const tokens = [];
        for (const token of result.tokens) {
          // Use the most specific TextMate scope — Monaco's built-in vs theme
          // matches standard scopes like keyword, comment, string, constant, etc.
          const scope = token.scopes[token.scopes.length - 1] || "";
          tokens.push({ startIndex: token.startIndex, scopes: scope });
        }
        return { endState: new ShikiTokenState(result.ruleStack), tokens };
      },
    });
  } catch (err) {
    console.warn("Failed to set up typst syntax highlighting:", err);
  }
}

async function loadAllSystemFiles(versionId) {
  try {
    const url = new URL("/api/get_all_files", window.location.origin);
    if (versionId !== undefined && versionId !== null) {
      url.searchParams.set("version_id", versionId);
    }

    const response = await fetch(url);

    if (response.ok) {
      const files = await response.json();

      for (const path of systemFiles.keys()) {
        fileCache.delete(path);
      }

      // Store all system files in memory
      systemFiles.clear();
      files.forEach((file) => {
        systemFiles.set(file.path, file.content);
        fileCache.set(file.path, file.content);
      });

      console.info(`Loaded ${systemFiles.size} system files`);
    }
  } catch (error) {
    console.error("Error loading system files: ", error);
  }
}

function monacoJsxEmitForYolm() {
  const jsxEmit = monaco.languages.typescript.JsxEmit;
  return jsxEmit.ReactJSXDev ?? jsxEmit.Preserve;
}

function monacoModuleDetectionForce() {
  return monaco.languages.typescript.ModuleDetectionKind?.Force ?? 3;
}

function yolmTypeScriptCompilerOptions(
  tsconfigCompilerOptions = {},
  paths = {},
) {
  // Keep this profile aligned with ~/dev/yolm/tsconfig.json and
  // crates/yolm_deno/bundled/compiler_host.js. Deno lint rules are intentionally
  // not run in Monaco; this is only the TypeScript diagnostic profile.
  const jsx = monacoJsxEmitForYolm();
  const options = {
    ...tsconfigCompilerOptions,
    jsx,
    jsxImportSource: "std",
    paths,
    baseUrl: ".",
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    moduleDetection: monacoModuleDetectionForce(),
    allowNonTsExtensions: true,
    allowImportingTsExtensions: true,
    allowJs: false,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    resolveJsonModule: true,
    esModuleInterop: false,
    allowSyntheticDefaultImports: true,
    forceConsistentCasingInFileNames: true,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    strict: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    removeComments: false,
    experimentalDecorators: true,
  };

  // Older Monaco builds may not expose ReactJSXDev. Preserve still needs the
  // classic factory names to parse existing Yolm TSX in the editor.
  if (jsx === monaco.languages.typescript.JsxEmit.Preserve) {
    options.jsxFactory = "jsx";
    options.jsxFragmentFactory = "Fragment";
  }

  return options;
}

async function configureTypeScript(versionId) {
  if (!monaco) return;

  await loadAllSystemFiles(versionId);
  configuredTypeScriptVersionId = versionId ?? null;

  if (!window._definitionProviderRegistered) {
    registerDefinitionProvider();
    window._definitionProviderRegistered = true;
  }

  let tsconfig = null;
  const tsconfigContent = systemFiles.get("tsconfig.json");

  if (tsconfigContent) {
    try {
      tsconfig = JSON.parse(tsconfigContent);
    } catch (error) {
      console.warn("Failed to parse tsconfig.json:", error);
    }
  }

  await loadPackagesZip();

  registerDefinitionProvider();

  if (tsconfig) {
    const paths = {};
    if (tsconfig.compilerOptions?.paths) {
      for (
        const [key, value] of Object.entries(tsconfig.compilerOptions.paths)
      ) {
        const cleanKey = key.replace("/*", "");
        const cleanValue = value[0].replace("/*", "");
        paths[cleanKey] = [cleanValue];
      }
    }

    // Don't use enhanced paths - let TypeScript resolve via extra libs
    const simplePaths = {
      ...paths,
    };

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
      yolmTypeScriptCompilerOptions(tsconfig.compilerOptions, simplePaths),
    );

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
      diagnosticCodesToIgnore: [],
      onlyVisible: true, // Only validate visible models
    });

    // Add Yolm-specific type declarations
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      // Yolm JSX declarations
      declare module "std/jsx-runtime" {
        export function jsx(type: any, props: any, key?: any): any;
        export function jsxs(type: any, props: any, key?: any): any;
        export const Fragment: any;
      }

      declare module "std/jsx-dev-runtime" {
        export function jsxDEV(type: any, props: any, key?: any, isStatic?: boolean, source?: any, self?: any): any;
        export const Fragment: any;
      }

      declare global {
        namespace JSX {
          interface Element {}
          interface ElementClass {
            render(): any;
          }
          interface IntrinsicElements {
            [elem: string]: any;
          }
        }
      }
    `,
      "ts:jsx-declarations.d.ts",
    );

    await addPackageTypesAsExtraLibs();
  } else {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
      yolmTypeScriptCompilerOptions(),
    );

    // Add JSX declarations and package types even without tsconfig
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
      declare module "std/jsx-runtime" {
        export function jsx(type: any, props: any, key?: any): any;
        export function jsxs(type: any, props: any, key?: any): any;
        export const Fragment: any;
      }

      declare module "std/jsx-dev-runtime" {
        export function jsxDEV(type: any, props: any, key?: any, isStatic?: boolean, source?: any, self?: any): any;
        export const Fragment: any;
      }

      declare global {
        namespace JSX {
          interface Element {}
          interface ElementClass {
            render(): any;
          }
          interface IntrinsicElements {
            [elem: string]: any;
          }
        }
      }
    `,
      "ts:jsx-declarations.d.ts",
    );

    await addPackageTypesAsExtraLibs();
  }
}

async function loadPackagesZip() {
  try {
    const response = await fetch("/_y/packages_dts.zip");
    if (!response.ok) {
      console.error(
        "Failed to load packages.zip:",
        response.status,
        response.statusText,
      );
      return;
    }

    const zipData = await response.arrayBuffer();
    packagesZip = await JSZip.loadAsync(zipData);

    packagesZip.forEach((relativePath, file) => {
      zipFileMap.set(relativePath, file);
    });

    await preloadCommonTypes();
  } catch (error) {
    console.error("Error loading packages.zip:", error);
  }
}

async function preloadCommonTypes() {
  const commonTypes = [
    "std/ui",
    "std/jsx-dev-runtime",
    "std/jsx-runtime",
    "std/system",
    "std/sql_utils",
    "std/read",
    "std/write",
    "components/button",
    "components/card",
    "components/input",
    "components/typography",
  ];

  await Promise.all(commonTypes.map((path) => loadTypeDefinitions(path)));
}

async function addPackageTypesAsExtraLibs() {
  if (!packagesZip || !monaco) return;

  let loadedCount = 0;

  // Suppress validation while loading
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });

  for (const [filePath, file] of zipFileMap) {
    // Handle both .d.ts files (type declarations) and .tsx/.ts files (source)
    if (
      filePath.endsWith(".d.ts") || filePath.endsWith(".ts") ||
      filePath.endsWith(".tsx")
    ) {
      try {
        const content = await file.async("string");

        // Remove extension to get the base path
        const basePath = filePath.replace(/\.(d\.ts|tsx?|jsx?)$/, "");

        // Add as extra lib with the exact import paths used in the code
        const moduleNames = [];

        // If the file is in a standard package directory, add with packages/ prefix
        if (
          basePath.match(
            /^(std|components|blocks|services|pages|tables|enums|vis|utils|apps)\//,
          )
        ) {
          moduleNames.push(
            `file:///node_modules/packages/${basePath}.ts`,
            `file:///node_modules/packages/${basePath}.tsx`,
            `file:///node_modules/packages/${basePath}`,
            `file:///node_modules/${basePath}.ts`,
            `file:///node_modules/${basePath}.tsx`,
            `file:///node_modules/${basePath}`,
          );
        }

        // Always add without prefix for std imports
        moduleNames.push(
          `file:///node_modules/${basePath}.ts`,
          `file:///node_modules/${basePath}.tsx`,
          `file:///node_modules/${basePath}`,
        );

        // Add the content for each possible module name
        for (const moduleName of moduleNames) {
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            content,
            moduleName,
          );
        }

        loadedCount++;
      } catch (error) {
        console.warn(`Failed to load ${filePath}:`, error);
      }
    }
  }

  // Keep Monaco diagnostics disabled; server check results own editor markers.
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
}

async function loadTypeDefinitions(importPath) {
  let content = await loadFromZip(importPath + ".d.ts");
  if (!content) {
    content = await loadFromZip(importPath + "/index.d.ts");
  }

  return content;
}

async function loadFromZip(path) {
  if (!packagesZip || !zipFileMap.has(path)) {
    return null;
  }

  try {
    const file = zipFileMap.get(path);
    const content = await file.async("string");
    return content;
  } catch (error) {
    console.warn(`Error loading ${path} from zip:`, error);
    return null;
  }
}

async function loadFileContent(path, useCache = true) {
  if (useCache && fileCache.has(path)) {
    return fileCache.get(path);
  }

  let content = null;

  let normalizedPath = path;
  if (path.startsWith("./")) {
    normalizedPath = path.substring(2);
  }

  if (normalizedPath.startsWith("/")) {
    normalizedPath = normalizedPath.substring(1);
  }

  // Handle "packages/" prefix by removing it
  if (normalizedPath.startsWith("packages/")) {
    normalizedPath = normalizedPath.substring("packages/".length);
  }

  const isPackageFile = normalizedPath.match(
    /^(std|components|blocks|services|pages|tables|enums|vis|utils|apps)\//,
  ) ||
    normalizedPath.includes("node_modules");

  if (isPackageFile && packagesZip) {
    const basePath = normalizedPath.replace(/\.(tsx?|jsx?|d\.ts)$/, "");

    content = await loadFromZip(basePath + ".d.ts");
    if (!content) {
      content = await loadFromZip(basePath + "/index.d.ts");
    }
    if (!content) {
      content = await loadFromZip(normalizedPath);
    }
  } else {
    content = systemFiles.get(normalizedPath);
  }

  if (content !== null) {
    fileCache.set(path, content);
  }

  return content;
}

function loadImportsFromContent(content, currentPath) {
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const imports = new Set();
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }

  for (const importPath of imports) {
    try {
      if (importPath.startsWith(".")) {
        const currentDir = currentPath.split("/").slice(0, -1).join("/");
        const resolvedPath = resolvePath(currentDir, importPath);

        if (resolvedPath === null) {
          console.error(
            `Blocked invalid relative import: "${importPath}" from "${currentPath}"`,
          );
          continue;
        }

        let systemFileContent = systemFiles.get(resolvedPath);
        let finalPath = resolvedPath;

        if (!systemFileContent) {
          const extensions = [".ts", ".tsx", ".d.ts"];
          for (const ext of extensions) {
            const pathWithExt = resolvedPath + ext;
            systemFileContent = systemFiles.get(pathWithExt);
            if (systemFileContent) {
              finalPath = pathWithExt;
              break;
            }
          }
        }

        if (systemFileContent) {
          const uri = monaco.Uri.parse(`file:///${finalPath}`);
          if (!models.has(uri.toString())) {
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
              systemFileContent,
              uri.toString(),
            );
          }
          createModel(finalPath, systemFileContent, true);
        } else {
          console.warn(
            `System file not found: "${resolvedPath}" (imported from "${currentPath}")`,
          );
        }
      }
    } catch (error) {
      console.warn(
        `Error loading import: "${importPath}" from "${currentPath}":`,
        error,
      );
    }
  }
}

function resolvePath(basePath, relativePath) {
  if (basePath.startsWith("/")) {
    basePath = basePath.substring(1);
  }

  const cleanRelativePath = relativePath.replace(/\.(tsx?|jsx?|d\.ts)$/, "");

  const baseSegments = basePath.split("/").filter(Boolean);
  const relativeSegments = cleanRelativePath.split("/").filter(Boolean);

  for (const segment of relativeSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (baseSegments.length === 0) {
        console.warn(
          `Invalid relative import: "${relativePath}" from "${basePath}" goes outside system directory`,
        );
        return null;
      }
      baseSegments.pop();
    } else {
      baseSegments.push(segment);
    }
  }

  const resolvedPath = baseSegments.join("/");

  const isFromSystemDir = basePath.match(
    /^(apps|components|blocks|services|pages|tables|enums)\//,
  );

  if (
    isFromSystemDir &&
    resolvedPath.match(
      /^(apps|components|blocks|services|pages|tables|enums)\//,
    )
  ) {
    return resolvedPath;
  }

  if (!isFromSystemDir && resolvedPath.match(/^(std|packages)\//)) {
    console.warn(
      `Invalid relative import: "${relativePath}" from "${basePath}" resolves to package path "${resolvedPath}"`,
    );
    return null;
  }

  return resolvedPath;
}

function resolveImportToFilePath(importPath, currentFilePath) {
  importPath = importPath.replace(/['"]/g, "");

  const currentDir = currentFilePath.substring(
    0,
    currentFilePath.lastIndexOf("/"),
  );

  if (importPath.startsWith(".")) {
    const resolvedPath = resolvePath(currentDir, importPath);
    if (resolvedPath) {
      if (systemFiles.has(resolvedPath)) {
        return resolvedPath;
      }

      const extensions = [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        "/index.ts",
        "/index.tsx",
      ];
      for (const ext of extensions) {
        const pathWithExt = resolvedPath + ext;
        if (systemFiles.has(pathWithExt)) {
          return pathWithExt;
        }
      }
    }
    return null;
  }

  const packagePrefixes = [
    "std",
    "components",
    "blocks",
    "services",
    "pages",
    "tables",
    "enums",
    "vis",
    "utils",
    "apps",
  ];

  const isPackageImport = packagePrefixes.some((prefix) =>
    importPath === prefix || importPath.startsWith(prefix + "/")
  );

  if (isPackageImport) {
    return null;
  }

  return null;
}

function registerDefinitionProvider() {
  if (!monaco) return;

  monaco.languages.registerDefinitionProvider(
    ["typescript", "typescriptreact"],
    {
      provideDefinition: async (model, position, token) => {
        try {
          const word = model.getWordAtPosition(position);
          if (!word) {
            return null;
          }

          const lineContent = model.getLineContent(position.lineNumber);
          const wordStart = word.startColumn - 1;
          const wordEnd = word.endColumn - 1;
          // Check if we're in an import statement
          const importMatch = lineContent.match(
            /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:{[^}]*}|\w+))?\s*from\s*['"]([^'"]+)['"]/,
          );

          if (importMatch) {
            const importPath = importMatch[1];
            const currentFilePath = model.uri.path.substring(1); // Remove leading /

            // Check if cursor is on the import path itself
            const fromIndex = lineContent.indexOf("from");
            const importPathStart = lineContent.indexOf(importPath, fromIndex);
            const importPathEnd = importPathStart + importPath.length;

            if (
              position.column >= importPathStart &&
              position.column <= importPathEnd + 2
            ) {
              return null;
            } else {
              const symbolName = word.word;
              const resolvedPath = resolveImportToFilePath(
                importPath,
                currentFilePath,
              );

              // Only handle system files, not package files
              if (resolvedPath && systemFiles.has(resolvedPath)) {
                const targetContent = systemFiles.get(resolvedPath);
                const targetUri = monaco.Uri.parse("file:///" + resolvedPath);

                createModel(resolvedPath, targetContent, true);

                const patterns = [
                  new RegExp(
                    `export\\s+(const|let|var|function|class|interface|type|enum)\\s+${symbolName}\\b`,
                  ),
                  new RegExp(`export\\s+{[^}]*\\b${symbolName}\\b[^}]*}`),
                  new RegExp(
                    `^\\s*(const|let|var|function|class|interface|type|enum)\\s+${symbolName}\\b`,
                    "m",
                  ),
                ];

                const lines = targetContent.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  for (const pattern of patterns) {
                    if (pattern.test(lines[i])) {
                      return {
                        uri: targetUri,
                        range: new monaco.Range(i + 1, 1, i + 1, 1),
                      };
                    }
                  }
                }

                // If not found, just go to the file
                return {
                  uri: targetUri,
                  range: new monaco.Range(1, 1, 1, 1),
                };
              }
            }
          }

          // Check if it's a JSX component usage
          const jsxComponentMatch = lineContent.match(/<(\w+)/);
          if (jsxComponentMatch) {
            const componentName = word.word;

            const currentContent = model.getValue();

            const importRegex = new RegExp(
              `import\\s+(?:{[^}]*\\b${componentName}\\b[^}]*}|${componentName})\\s+from\\s+['"]([^'"]+)['"]`,
            );
            const match = currentContent.match(importRegex);

            if (match) {
              const importPath = match[1];
              const currentFilePath = model.uri.path.substring(1);
              const resolvedPath = resolveImportToFilePath(
                importPath,
                currentFilePath,
              );
              if (resolvedPath && systemFiles.has(resolvedPath)) {
                // Try to find the component definition in the target file
                const targetContent = systemFiles.get(resolvedPath);
                const targetUri = monaco.Uri.parse("file:///" + resolvedPath);

                if (targetContent) {
                  // Ensure model exists
                  createModel(resolvedPath, targetContent, true);
                  const patterns = [
                    new RegExp(
                      `export\\s+(?:default\\s+)?(?:function|const|class)\\s+${componentName}\\b`,
                    ),
                    new RegExp(`export\\s+{[^}]*\\b${componentName}\\b[^}]*}`),
                    new RegExp(
                      `^\\s*(?:export\\s+)?(?:function|const|class)\\s+${componentName}\\b`,
                      "m",
                    ),
                  ];

                  const lines = targetContent.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    for (const pattern of patterns) {
                      if (pattern.test(lines[i])) {
                        return {
                          uri: targetUri,
                          range: new monaco.Range(i + 1, 1, i + 1, 1),
                        };
                      }
                    }
                  }
                }

                return {
                  uri: targetUri,
                  range: new monaco.Range(1, 1, 1, 1),
                };
              }
            }
          }

          const currentContent = model.getValue();
          const identifierName = word.word;

          const anyImportRegex = new RegExp(
            `import\\s+(?:{[^}]*\\b${identifierName}\\b[^}]*}|${identifierName})\\s+from\\s+['"]([^'"]+)['"]`,
          );
          const anyMatch = currentContent.match(anyImportRegex);

          if (anyMatch) {
            const importPath = anyMatch[1];
            const currentFilePath = model.uri.path.substring(1);
            const resolvedPath = resolveImportToFilePath(
              importPath,
              currentFilePath,
            );

            if (resolvedPath && systemFiles.has(resolvedPath)) {
              const targetContent = systemFiles.get(resolvedPath);
              const targetUri = monaco.Uri.parse("file:///" + resolvedPath);

              createModel(resolvedPath, targetContent, true);

              const patterns = [
                new RegExp(
                  `export\\s+(?:default\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${identifierName}\\b`,
                ),
                new RegExp(`export\\s+{[^}]*\\b${identifierName}\\b[^}]*}`),
                new RegExp(
                  `^\\s*(?:export\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${identifierName}\\b`,
                  "m",
                ),
              ];

              const lines = targetContent.split("\n");
              for (let i = 0; i < lines.length; i++) {
                for (const pattern of patterns) {
                  if (pattern.test(lines[i])) {
                    return {
                      uri: targetUri,
                      range: new monaco.Range(i + 1, 1, i + 1, 1),
                    };
                  }
                }
              }

              return {
                uri: targetUri,
                range: new monaco.Range(1, 1, 1, 1),
              };
            }
          }

          return null;
        } catch (error) {
          console.error("[Definition Provider] Error:", error);
          return null;
        }
      },
    },
  );
}

async function validateModel(model) {
  if (!monaco || !model) return;

  const language = model.getLanguageId();
  if (language !== "typescript" && language !== "javascript") {
    return;
  }

  monaco.editor.setModelMarkers(model, "typescript", []);

  // Skip validation for original models in diff view
  if (model.uri.path.endsWith(".original")) {
    return;
  }

  const filePath = model.uri.path.substring(1);
  for (const currentEditorInfo of editors.values()) {
    if (currentEditorInfo.model === model) {
      currentEditorInfo.latestDiagnostics = {
        filePath,
        hasErrors: false,
        errors: [],
      };
      currentEditorInfo.lastEmittedDiagnosticsFingerprint = JSON.stringify(
        currentEditorInfo.latestDiagnostics,
      );
      break;
    }
  }
}

function getHandleEventData(handle, eventName) {
  if (!handle) {
    return lastEventData;
  }

  const handleEvents = eventDataByHandle.get(handle);
  if (!handleEvents) {
    return lastEventData;
  }

  if (eventName) {
    return handleEvents.get(eventName) ?? lastEventData;
  }

  return handleEvents.get("__last__") ?? lastEventData;
}

function setHandleEventData(handle, eventName, json) {
  lastEventData = json ?? {};

  if (!handle) {
    return;
  }

  let handleEvents = eventDataByHandle.get(handle);
  if (!handleEvents) {
    handleEvents = new Map();
    eventDataByHandle.set(handle, handleEvents);
  }

  handleEvents.set("__last__", lastEventData);
  if (eventName) {
    handleEvents.set(eventName, lastEventData);
  }
}

function emitWithEventData(name, args) {
  setHandleEventData(args?.handle, name, args?.json);
  emit(name, args);
}

function disposeDisposables(disposables) {
  if (!disposables) return;

  disposables.forEach((d) => {
    try {
      d.dispose();
    } catch (e) {
      console.warn("Error disposing listener:", e);
    }
  });
}

function clearEditorTimers(editorInfo) {
  if (!editorInfo) return;

  if (editorInfo.changeTimer) {
    clearTimeout(editorInfo.changeTimer);
    editorInfo.changeTimer = null;
  }
  if (editorInfo.persistTimer) {
    clearTimeout(editorInfo.persistTimer);
    editorInfo.persistTimer = null;
  }
  if (editorInfo.validationTimer) {
    clearTimeout(editorInfo.validationTimer);
    editorInfo.validationTimer = null;
  }
}

function clearTypeScriptMarkers(model) {
  if (!monaco || !model) return;
  const markers = monaco.editor.getModelMarkers({ resource: model.uri });
  if (!markers.some((marker) => marker.owner === "typescript")) {
    return;
  }
  monaco.editor.setModelMarkers(model, "typescript", []);
}

function suppressTypeScriptMarkersForDiff(editorInfo, markerModels) {
  if (!monaco || !editorInfo) return;

  disposeDisposables(editorInfo.diagnosticDisposables);

  const clearMarkers = () => {
    for (const model of markerModels) {
      clearTypeScriptMarkers(model);
    }
  };

  clearMarkers();

  const timeouts = [0, 250, 1000, 2500].map((delay) =>
    setTimeout(clearMarkers, delay)
  );
  const markerUris = new Set(markerModels.map((model) => model.uri.toString()));
  const markerDisposable = monaco.editor.onDidChangeMarkers((changedUris) => {
    if (changedUris.some((uri) => markerUris.has(uri.toString()))) {
      setTimeout(clearMarkers, 0);
    }
  });

  editorInfo.diagnosticDisposables = [
    markerDisposable,
    {
      dispose() {
        for (const timeout of timeouts) {
          clearTimeout(timeout);
        }
      },
    },
  ];
}

function scheduleValidation(editorInfo, model, delay, opts = {}) {
  if (!editorInfo) return;

  if (editorInfo.validationTimer) {
    clearTimeout(editorInfo.validationTimer);
  }

  const { emitEvent = false } = opts;
  editorInfo.validationTimer = setTimeout(() => {
    if (editorInfo.model !== model) {
      return;
    }

    editorInfo.shouldEmitDiagnostics = emitEvent;
    validateModel(model).finally(() => {
      if (editorInfo.model === model) {
        editorInfo.shouldEmitDiagnostics = false;
      }
    });
  }, delay);
}

function getEditorContainer(containerId) {
  if (containerId) {
    const dataContainer = document.querySelector(
      `[data-monaco-container-id="${containerId}"]`,
    );
    if (dataContainer) return dataContainer;

    const idContainer = document.getElementById(containerId);
    if (idContainer) return idContainer;
  }
  return document.getElementById("ts-editor");
}

function createModelWithUri(filePath, content, uri, skipImportLoading = false) {
  if (!monaco) return null;

  const language = getLanguageFromPath(filePath);

  let model = models.get(uri.toString());
  if (model) {
    const fullRange = model.getFullModelRange();
    model.pushEditOperations(
      [],
      [{ range: fullRange, text: content }],
      () => null,
    );
    return model;
  }

  // Load imports BEFORE creating the model to ensure dependencies exist
  if (!skipImportLoading && language === "typescript") {
    loadImportsFromContent(content, filePath);
  }

  model = monaco.editor.createModel(content, language, uri);
  models.set(uri.toString(), model);

  return model;
}

function createModel(filePath, content, skipImportLoading = false) {
  const uri = monaco.Uri.parse(`file:///${filePath}`);
  return createModelWithUri(filePath, content, uri, skipImportLoading);
}

function diffModelUri(handle, side, filePath) {
  const safeHandle = encodeURIComponent(String(handle || "diff"));
  const safePath = String(filePath || "file")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return monaco.Uri.parse(
    `file:///__yolm_diff/${safeHandle}/${side}/${safePath}`,
  );
}

function detectMergeConflicts(content) {
  const conflicts = [];
  const lines = content.split("\n");
  let inConflict = false;
  let conflictStart = 0;
  let conflictMiddle = 0;
  let startMarker = "";
  let middleMarker = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("<<<<<<<")) {
      inConflict = true;
      conflictStart = i + 1;
      startMarker = line;
    } else if (line.startsWith("=======") && inConflict) {
      conflictMiddle = i + 1;
      middleMarker = line;
    } else if (line.startsWith(">>>>>>>") && inConflict) {
      conflicts.push({
        start: conflictStart,
        middle: conflictMiddle,
        end: i + 1,
        startMarker,
        middleMarker,
        endMarker: line,
        ours: { start: conflictStart + 1, end: conflictMiddle - 1 },
        theirs: { start: conflictMiddle + 1, end: i },
      });
      inConflict = false;
    }
  }

  console.log("Detected conflicts:", conflicts);
  return conflicts;
}

function applyMergeConflictDecorations(editor, model, conflicts) {
  if (!editor || !model || !conflicts.length) return;

  console.log("Applying merge conflict decorations for conflicts:", conflicts);

  const decorations = [];

  conflicts.forEach((conflict) => {
    decorations.push({
      range: new monaco.Range(conflict.start, 1, conflict.start, 1),
      options: {
        isWholeLine: true,
        className: "merge-conflict-marker",
        marginClassName: "merge-conflict-marker-margin",
        overviewRuler: {
          color: "#808080",
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
    });

    decorations.push({
      range: new monaco.Range(conflict.middle, 1, conflict.middle, 1),
      options: {
        isWholeLine: true,
        className: "merge-conflict-marker",
        marginClassName: "merge-conflict-marker-margin",
        overviewRuler: {
          color: "#808080",
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
    });

    decorations.push({
      range: new monaco.Range(conflict.end, 1, conflict.end, 1),
      options: {
        isWholeLine: true,
        className: "merge-conflict-marker",
        marginClassName: "merge-conflict-marker-margin",
        overviewRuler: {
          color: "#808080",
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
    });

    if (conflict.ours.start <= conflict.ours.end) {
      console.log(
        'Adding "ours" decoration from line',
        conflict.ours.start,
        "to",
        conflict.ours.end,
      );
      decorations.push({
        range: new monaco.Range(conflict.ours.start, 1, conflict.ours.end, 1),
        options: {
          isWholeLine: true,
          className: "merge-conflict-ours",
          marginClassName: "merge-conflict-ours-margin",
          overviewRuler: {
            color: "rgb(64, 195, 255)",
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      });
    }

    if (conflict.theirs.start <= conflict.theirs.end) {
      console.log(
        'Adding "theirs" decoration from line',
        conflict.theirs.start,
        "to",
        conflict.theirs.end,
      );
      decorations.push({
        range: new monaco.Range(
          conflict.theirs.start,
          1,
          conflict.theirs.end,
          1,
        ),
        options: {
          isWholeLine: true,
          className: "merge-conflict-theirs",
          marginClassName: "merge-conflict-theirs-margin",
          overviewRuler: {
            color: "rgb(255, 236, 61)",
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      });
    }
  });

  const editorInfo = Array.from(editors.values()).find((info) =>
    info.editor === editor
  );
  if (editorInfo) {
    if (!editorInfo.mergeConflictDecorations) {
      editorInfo.mergeConflictDecorations = editor
        .createDecorationsCollection();
    }
    editorInfo.mergeConflictDecorations.set(decorations);
  } else {
    console.error("Could not find editor info to store decorations");
  }
}

function mergeConflictLabel(marker, fallback) {
  if (!marker) return fallback;
  return marker.replace(/^<{7}\s*/, "")
    .replace(/^>{7}\s*/, "")
    .trim() || fallback;
}

function conflictRangeText(model, startLine, endLine) {
  if (startLine > endLine) return "";

  const lines = [];
  for (let line = startLine; line <= endLine; line++) {
    lines.push(model.getLineContent(line));
  }
  return lines.join("\n");
}

function conflictReplacementText(model, conflict, resolution) {
  const ours = conflictRangeText(model, conflict.ours.start, conflict.ours.end);
  const theirs = conflictRangeText(
    model,
    conflict.theirs.start,
    conflict.theirs.end,
  );

  if (resolution === "ours") return ours;
  if (resolution === "theirs") return theirs;

  if (!ours) return theirs;
  if (!theirs) return ours;
  return `${ours}\n${theirs}`;
}

function disposeMergeConflictCompare(editorInfo) {
  if (!editorInfo?.mergeConflictCompare) return;

  const compare = editorInfo.mergeConflictCompare;
  try {
    compare.diffEditor?.dispose?.();
    compare.originalModel?.dispose?.();
    compare.modifiedModel?.dispose?.();
    compare.overlay?.remove?.();
  } catch (error) {
    console.warn("Error disposing merge conflict comparison:", error);
  }
  editorInfo.mergeConflictCompare = null;
}

function showMergeConflictCompare(editor, model, conflict, index) {
  const editorInfo = Array.from(editors.values()).find((info) =>
    info.editor === editor
  );
  if (!editorInfo || !monaco) return;

  disposeMergeConflictCompare(editorInfo);

  const ours = conflictRangeText(model, conflict.ours.start, conflict.ours.end);
  const theirs = conflictRangeText(
    model,
    conflict.theirs.start,
    conflict.theirs.end,
  );
  const oursLabel = mergeConflictLabel(conflict.startMarker, "A");
  const theirsLabel = mergeConflictLabel(conflict.endMarker, "B");

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "10000";
  overlay.style.background = "rgba(15, 23, 42, 0.24)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "32px";
  overlay.tabIndex = -1;

  const panel = document.createElement("div");
  panel.style.width = "min(1120px, 92vw)";
  panel.style.height = "min(720px, 82vh)";
  panel.style.background = "#ffffff";
  panel.style.border = "1px solid rgba(15, 23, 42, 0.18)";
  panel.style.boxShadow = "0 24px 60px rgba(15, 23, 42, 0.22)";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.overflow = "hidden";

  const header = document.createElement("div");
  header.style.height = "42px";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "10px";
  header.style.padding = "0 12px";
  header.style.borderBottom = "1px solid #e5e7eb";
  header.style.background = "#f8fafc";

  const title = document.createElement("div");
  title.textContent = `Compare conflict ${index + 1}`;
  title.style.fontSize = "13px";
  title.style.fontWeight = "600";
  title.style.color = "#111827";
  title.style.flexShrink = "0";
  title.style.whiteSpace = "nowrap";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent = `${oursLabel} <-> ${theirsLabel}`;
  subtitle.style.fontSize = "12px";
  subtitle.style.color = "#4b5563";
  subtitle.style.minWidth = "0";
  subtitle.style.overflow = "hidden";
  subtitle.style.textOverflow = "ellipsis";
  subtitle.style.whiteSpace = "nowrap";
  header.appendChild(subtitle);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close comparison");
  closeButton.style.border = "1px solid #d1d5db";
  closeButton.style.background = "#ffffff";
  closeButton.style.borderRadius = "4px";
  closeButton.style.color = "#111827";
  closeButton.style.fontSize = "12px";
  closeButton.style.fontWeight = "600";
  closeButton.style.lineHeight = "22px";
  closeButton.style.padding = "0 8px";
  closeButton.style.cursor = "pointer";
  header.appendChild(closeButton);

  const diffNode = document.createElement("div");
  diffNode.style.flex = "1";
  diffNode.style.minHeight = "0";

  panel.appendChild(header);
  panel.appendChild(diffNode);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const originalModel = monaco.editor.createModel(
    ours,
    model.getLanguageId?.() || "plaintext",
    monaco.Uri.parse(
      `inmemory://merge-conflict/${Date.now()}-${index}-a`,
    ),
  );
  const modifiedModel = monaco.editor.createModel(
    theirs,
    model.getLanguageId?.() || "plaintext",
    monaco.Uri.parse(
      `inmemory://merge-conflict/${Date.now()}-${index}-b`,
    ),
  );
  const diffEditor = monaco.editor.createDiffEditor(diffNode, {
    automaticLayout: true,
    readOnly: true,
    renderSideBySide: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
  });
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });

  editorInfo.mergeConflictCompare = {
    overlay,
    diffEditor,
    originalModel,
    modifiedModel,
  };

  const close = () => disposeMergeConflictCompare(editorInfo);
  closeButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  overlay.onclick = (event) => {
    if (event.target === overlay) close();
  };
  overlay.onkeydown = (event) => {
    if (event.key === "Escape") close();
  };

  setTimeout(() => diffEditor.layout(), 0);
  overlay.focus();
}

function resolveMergeConflict(editor, model, conflict, resolution, handle) {
  if (!editor || !model || !conflict) return;

  const editorInfo = Array.from(editors.values()).find((info) =>
    info.editor === editor
  );
  disposeMergeConflictCompare(editorInfo);

  const replacement = conflictReplacementText(model, conflict, resolution);
  const range = new monaco.Range(
    conflict.start,
    1,
    conflict.end,
    model.getLineMaxColumn(conflict.end),
  );

  editor.pushUndoStop();
  editor.executeEdits("merge-conflict-resolution", [{
    range,
    text: replacement,
    forceMoveMarkers: true,
  }]);
  editor.pushUndoStop();

  const nextLine = Math.min(conflict.start, model.getLineCount());
  editor.setPosition({ lineNumber: nextLine, column: 1 });
  editor.revealLineInCenterIfOutsideViewport(nextLine);
  refreshMergeConflictState(editor, model, handle);
}

function clearMergeConflictWidgets(editorInfo) {
  if (!editorInfo) return;

  if (editorInfo.mergeConflictWidgets?.length) {
    for (const widget of editorInfo.mergeConflictWidgets) {
      try {
        editorInfo.editor.removeContentWidget(widget);
      } catch (error) {
        console.warn("Error removing merge conflict widget:", error);
      }
    }
    editorInfo.mergeConflictWidgets = [];
  }

  if (editorInfo.mergeConflictViewZoneIds?.length) {
    editorInfo.editor.changeViewZones((accessor) => {
      for (const zoneId of editorInfo.mergeConflictViewZoneIds) {
        accessor.removeZone(zoneId);
      }
    });
    editorInfo.mergeConflictViewZoneIds = [];
  }
}

function makeMergeConflictAction(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = label;
  button.style.border = "0";
  button.style.background = "transparent";
  button.style.color = "#006ab1";
  button.style.fontFamily = "inherit";
  button.style.fontSize = "12px";
  button.style.fontWeight = "500";
  button.style.lineHeight = "20px";
  button.style.padding = "0";
  button.style.cursor = "pointer";
  button.style.whiteSpace = "nowrap";
  button.style.maxWidth = "180px";
  button.style.minWidth = "0";
  button.style.flexShrink = "1";
  button.style.overflow = "hidden";
  button.style.textOverflow = "ellipsis";
  button.onmousedown = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };
  button.onmouseenter = () => {
    button.style.textDecoration = "underline";
  };
  button.onmouseleave = () => {
    button.style.textDecoration = "none";
  };
  return button;
}

function makeMergeConflictSeparator() {
  const separator = document.createElement("span");
  separator.textContent = " | ";
  separator.style.color = "#9ca3af";
  separator.style.fontSize = "12px";
  separator.style.flexShrink = "0";
  return separator;
}

function applyMergeConflictWidgets(editor, model, conflicts, handle) {
  const editorInfo = Array.from(editors.values()).find((info) =>
    info.editor === editor
  );
  if (!editorInfo) return;

  clearMergeConflictWidgets(editorInfo);
  if (!conflicts.length || editorInfo.editor.getRawOptions?.().readOnly) {
    return;
  }

  const zones = [];
  const widgets = [];
  for (const [index, conflict] of conflicts.entries()) {
    const oursLabel = mergeConflictLabel(conflict.startMarker, "A");
    const theirsLabel = mergeConflictLabel(conflict.endMarker, "B");
    const zoneNode = document.createElement("div");
    zoneNode.className = "merge-conflict-actions-spacer";
    zoneNode.style.height = "24px";
    zoneNode.style.overflow = "hidden";
    zoneNode.style.background = "#ffffff";

    const node = document.createElement("div");
    node.className = "merge-conflict-actions";
    node.dataset.testid = `merge-conflict-actions-${index}`;
    node.style.display = "inline-flex";
    node.style.alignItems = "center";
    node.style.gap = "0";
    node.style.padding = "0 8px 0 0";
    node.style.background = "transparent";
    node.style.pointerEvents = "auto";
    node.style.position = "relative";
    node.style.zIndex = "1000";
    node.style.maxWidth = `${
      Math.max(320, editor.getLayoutInfo().contentWidth - 12)
    }px`;
    node.style.overflow = "hidden";

    const label = document.createElement("span");
    label.textContent = `Conflict ${index + 1}`;
    label.style.fontSize = "12px";
    label.style.fontWeight = "500";
    label.style.color = "#6b7280";
    label.style.flexShrink = "0";
    node.appendChild(label);
    node.appendChild(makeMergeConflictSeparator());

    node.appendChild(
      makeMergeConflictAction(
        `Accept ${oursLabel}`,
        () => resolveMergeConflict(editor, model, conflict, "ours", handle),
      ),
    );
    node.appendChild(makeMergeConflictSeparator());
    node.appendChild(
      makeMergeConflictAction(
        `Accept ${theirsLabel}`,
        () => resolveMergeConflict(editor, model, conflict, "theirs", handle),
      ),
    );
    node.appendChild(makeMergeConflictSeparator());
    node.appendChild(
      makeMergeConflictAction(
        "Accept both",
        () => resolveMergeConflict(editor, model, conflict, "both", handle),
      ),
    );
    node.appendChild(makeMergeConflictSeparator());
    node.appendChild(
      makeMergeConflictAction(
        "Compare changes",
        () => showMergeConflictCompare(editor, model, conflict, index),
      ),
    );

    zones.push({
      afterLineNumber: conflict.start,
      heightInPx: 24,
      domNode: zoneNode,
    });

    widgets.push({
      allowEditorOverflow: true,
      suppressMouseDown: true,
      getId: () => `merge-conflict-actions-${handle}-${index}`,
      getDomNode: () => node,
      getPosition: () => ({
        position: { lineNumber: conflict.start, column: 1 },
        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
      }),
    });
  }

  editor.changeViewZones((accessor) => {
    editorInfo.mergeConflictViewZoneIds = zones.map((zone) =>
      accessor.addZone(zone)
    );
  });
  editorInfo.mergeConflictWidgets = widgets;
  for (const widget of widgets) {
    editor.addContentWidget(widget);
    editor.layoutContentWidget(widget);
  }
}

function refreshMergeConflictState(editor, model, handle, opts = {}) {
  if (!editor || !model) return [];

  const { emitEvent = true } = opts;
  const currentContent = model.getValue();
  const conflicts = detectMergeConflicts(currentContent);
  const editorInfo = Array.from(editors.values()).find((info) =>
    info.editor === editor
  );

  if (conflicts.length > 0) {
    applyMergeConflictDecorations(editor, model, conflicts);
  } else if (editorInfo?.mergeConflictDecorations) {
    editorInfo.mergeConflictDecorations.clear();
  }

  applyMergeConflictWidgets(editor, model, conflicts, handle);

  if (editorInfo) {
    editorInfo.latestMergeConflicts = conflicts;
  }

  if (emitEvent) {
    const eventData = {
      filePath: model.uri.path.substring(1),
      count: conflicts.length,
      conflicts: conflicts.map((conflict, index) => ({
        index,
        startLine: conflict.start,
        endLine: conflict.end,
        aLabel: mergeConflictLabel(conflict.startMarker, "A"),
        bLabel: mergeConflictLabel(conflict.endMarker, "B"),
      })),
    };
    setHandleEventData(handle, "mergeConflictStateChanged", eventData);
    emit("mergeConflictStateChanged", { handle, json: eventData });
  }

  return conflicts;
}

function setupEditorEventListeners(editor, model, handle) {
  const editorInfo = editors.get(handle);
  if (!editorInfo) {
    console.error("No editor info found for handle:", handle);
    return;
  }

  if (editorInfo.disposables && editorInfo.disposables.length > 0) {
    editorInfo.disposables.forEach((d) => {
      try {
        if (typeof d.dispose === "function") {
          d.dispose();
        }
      } catch (e) {
        console.warn("Error disposing listener:", e);
      }
    });
    editorInfo.disposables = [];
  }

  if (editorInfo.changeTimer) {
    clearTimeout(editorInfo.changeTimer);
    editorInfo.changeTimer = null;
  }

  if (editorInfo.persistTimer) {
    clearTimeout(editorInfo.persistTimer);
    editorInfo.persistTimer = null;
  }

  const disposables = [];

  const goToDefinitionDisposable = editor.onMouseDown(async (e) => {
    if (!e.event.ctrlKey && !e.event.metaKey) return;

    const target = e.target;
    if (!target || !target.position) return;
    e.event.preventDefault();
    e.event.stopPropagation();

    const position = target.position;
    const model = editor.getModel();
    if (!model) return;

    try {
      const word = model.getWordAtPosition(position);
      if (!word) {
        return;
      }

      const lineContent = model.getLineContent(position.lineNumber);

      const currentContent = model.getValue();

      let definition = null;

      const importMatch = lineContent.match(
        /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:{[^}]*}|\w+))?\s*from\s*['"]([^'"]+)['"]/,
      );

      if (importMatch) {
        const importPath = importMatch[1];
        const currentFilePath = model.uri.path.substring(1);

        const fromIndex = lineContent.indexOf("from");
        const importPathStart = lineContent.indexOf(importPath, fromIndex);
        const importPathEnd = importPathStart + importPath.length;

        if (
          position.column >= importPathStart &&
          position.column <= importPathEnd + 2
        ) {
          return;
        } else {
          const symbolName = word.word;
          const resolvedPath = resolveImportToFilePath(
            importPath,
            currentFilePath,
          );

          if (resolvedPath && systemFiles.has(resolvedPath)) {
            const targetContent = systemFiles.get(resolvedPath);
            const lines = targetContent.split("\n");
            let foundLine = 1;

            const patterns = [
              new RegExp(
                `export\\s+(const|let|var|function|class|interface|type|enum)\\s+${symbolName}\\b`,
              ),
              new RegExp(`export\\s+{[^}]*\\b${symbolName}\\b[^}]*}`),
              new RegExp(
                `^\\s*(const|let|var|function|class|interface|type|enum)\\s+${symbolName}\\b`,
                "m",
              ),
            ];

            for (let i = 0; i < lines.length; i++) {
              for (const pattern of patterns) {
                if (pattern.test(lines[i])) {
                  foundLine = i + 1;
                  break;
                }
              }
              if (foundLine > 1) break;
            }

            definition = {
              uri: monaco.Uri.parse("file:///" + resolvedPath),
              range: new monaco.Range(foundLine, 1, foundLine, 1),
            };
          }
        }
      }

      if (!definition) {
        const jsxComponentMatch = lineContent.match(/<(\w+)/);
        if (jsxComponentMatch && word.word === jsxComponentMatch[1]) {
          const componentName = word.word;

          const currentContent = model.getValue();
          const importRegex = new RegExp(
            `import\\s+(?:{[^}]*\\b${componentName}\\b[^}]*}|${componentName})\\s+from\\s+['"]([^'"]+)['"]`,
          );
          const match = currentContent.match(importRegex);

          if (match) {
            const importPath = match[1];
            const currentFilePath = model.uri.path.substring(1);
            const resolvedPath = resolveImportToFilePath(
              importPath,
              currentFilePath,
            );

            if (resolvedPath && systemFiles.has(resolvedPath)) {
              const targetContent = systemFiles.get(resolvedPath);
              const lines = targetContent.split("\n");
              let foundLine = 1;

              const patterns = [
                new RegExp(
                  `export\\s+(?:default\\s+)?(?:function|const|class)\\s+${componentName}\\b`,
                ),
                new RegExp(`export\\s+{[^}]*\\b${componentName}\\b[^}]*}`),
                new RegExp(
                  `^\\s*(?:export\\s+)?(?:function|const|class)\\s+${componentName}\\b`,
                  "m",
                ),
              ];

              for (let i = 0; i < lines.length; i++) {
                for (const pattern of patterns) {
                  if (pattern.test(lines[i])) {
                    foundLine = i + 1;
                    break;
                  }
                }
                if (foundLine > 1) break;
              }

              definition = {
                uri: monaco.Uri.parse("file:///" + resolvedPath),
                range: new monaco.Range(foundLine, 1, foundLine, 1),
              };
            }
          }
        }
      }

      if (!definition) {
        const identifierName = word.word;

        const anyImportRegex = new RegExp(
          `import\\s+(?:{[^}]*\\b${identifierName}\\b[^}]*}|${identifierName})\\s+from\\s+['"]([^'"]+)['"]`,
        );
        const anyMatch = currentContent.match(anyImportRegex);

        if (anyMatch) {
          const importPath = anyMatch[1];
          const currentFilePath = model.uri.path.substring(1);
          const resolvedPath = resolveImportToFilePath(
            importPath,
            currentFilePath,
          );

          if (resolvedPath && systemFiles.has(resolvedPath)) {
            const targetContent = systemFiles.get(resolvedPath);
            const lines = targetContent.split("\n");
            let foundLine = 1;

            const patterns = [
              new RegExp(
                `export\\s+(?:default\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${identifierName}\\b`,
              ),
              new RegExp(`export\\s+{[^}]*\\b${identifierName}\\b[^}]*}`),
              new RegExp(
                `^\\s*(?:export\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${identifierName}\\b`,
                "m",
              ),
            ];

            for (let i = 0; i < lines.length; i++) {
              for (const pattern of patterns) {
                if (pattern.test(lines[i])) {
                  foundLine = i + 1;
                  break;
                }
              }
              if (foundLine > 1) break;
            }

            definition = {
              uri: monaco.Uri.parse("file:///" + resolvedPath),
              range: new monaco.Range(foundLine, 1, foundLine, 1),
            };
          } else {
            console.log(
              "[MouseDown] Identifier path not resolved or not a system file",
            );
          }
        }
      }

      if (!definition) {
        console.log("[MouseDown] No definition found for:", word.word);
        return;
      }

      const targetPath = definition.uri.path.substring(1); // Remove leading /

      if (targetPath !== model.uri.path.substring(1)) {
        const targetContent = systemFiles.get(targetPath);
        if (targetContent) {
          const newModel = createModel(targetPath, targetContent);
          editor.setModel(newModel);

          editorInfo.model = newModel;
          editorInfo.filePath = targetPath;

          if (definition.range) {
            setTimeout(() => {
              editor.setPosition({
                lineNumber: definition.range.startLineNumber,
                column: definition.range.startColumn,
              });
              editor.revealLineInCenter(definition.range.startLineNumber);

              const decorations = editor.createDecorationsCollection([{
                range: new monaco.Range(
                  definition.range.startLineNumber,
                  1,
                  definition.range.startLineNumber,
                  1,
                ),
                options: {
                  isWholeLine: true,
                  className: "line-highlight",
                },
              }]);

              setTimeout(() => {
                decorations.clear();
              }, 2000);
            }, 50);
          }

          lastEventData = {
            sourcePath: model.uri.path.substring(1),
            targetPath: targetPath,
          };
          emit("navigatedToFile", {
            handle,
            json: lastEventData,
          });
        }
      } else {
        if (definition.range) {
          editor.setPosition({
            lineNumber: definition.range.startLineNumber,
            column: definition.range.startColumn,
          });
          editor.revealLineInCenter(definition.range.startLineNumber);
        }
      }
    } catch (error) {
      console.error("[MouseDown] Error navigating to definition:", error);
    }
  });

  if (goToDefinitionDisposable) {
    disposables.push(goToDefinitionDisposable);
  }

  const timerHolder = { changeTimer: null, persistTimer: null };

  const contentChangeDisposable = model.onDidChangeContent(() => {
    if (suppressContentChanged) return;

    // Immediate: lightweight dirty notification (no server work)
    emit("contentDirty", { handle });

    // Debounced 1.5s: persist unsaved state to DB
    if (timerHolder.persistTimer) {
      clearTimeout(timerHolder.persistTimer);
    }
    timerHolder.persistTimer = setTimeout(() => {
      emitWithEventData("contentChanged", {
        handle,
        json: {
          content: model.getValue(),
          filePath: model.uri.path.substring(1),
        },
      });
    }, 1500);

    // Debounced 500ms: validation and merge-conflict detection
    if (timerHolder.changeTimer) {
      clearTimeout(timerHolder.changeTimer);
    }
    timerHolder.changeTimer = setTimeout(() => {
      validateModel(model);

      refreshMergeConflictState(editor, model, handle);
    }, 500);

    if (editorInfo) {
      editorInfo.changeTimer = timerHolder.changeTimer;
      editorInfo.persistTimer = timerHolder.persistTimer;
    }
  });

  if (contentChangeDisposable) {
    disposables.push(contentChangeDisposable);
  } else {
    console.error("Failed to attach content change listener");
  }

  const saveCommandDisposable = editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    async () => {
      // Format on save for TypeScript files
      const filePath = editorInfo.filePath;
      if (filePath && (filePath.endsWith(".ts") || filePath.endsWith(".tsx"))) {
        emit("formatAndSave", { handle });
      } else {
        emit("save", { handle });
      }
    },
  );

  if (saveCommandDisposable) {
    disposables.push(saveCommandDisposable);
  }

  // Track last clicked line for shift-click range selection in editorInfo
  if (!editorInfo.lastClickedLine) {
    editorInfo.lastClickedLine = null;
  }

  const lineNumberClickDisposable = editor.onMouseDown((e) => {
    if (e.event.ctrlKey || e.event.metaKey) return;

    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
      const lineNumber = e.target.position.lineNumber;
      const isShiftClick = e.event.shiftKey;

      let startLine = lineNumber;
      let endLine = lineNumber;

      // If shift-clicking, create a range
      if (isShiftClick && editorInfo.lastClickedLine !== null) {
        startLine = Math.min(editorInfo.lastClickedLine, lineNumber);
        endLine = Math.max(editorInfo.lastClickedLine, lineNumber);
      } else {
        editorInfo.lastClickedLine = lineNumber;
      }

      emit("lineClicked", {
        handle,
        json: {
          line: lineNumber,
          startLine: startLine,
          endLine: endLine,
        },
      });
    }
  });

  if (lineNumberClickDisposable) {
    disposables.push(lineNumberClickDisposable);
  }

  let isNavigating = false;
  const editorChangeDisposable = editor.onDidChangeModel((e) => {
    if (isNavigating) return; // Prevent recursive navigation

    if (
      e.newModelUrl && e.oldModelUrl &&
      e.newModelUrl.path !== e.oldModelUrl.path
    ) {
      const newPath = e.newModelUrl.path.substring(1); // Remove leading /
      const oldPath = e.oldModelUrl.path.substring(1);

      isNavigating = true;

      editorInfo.filePath = newPath;
      editorInfo.model = editor.getModel();

      const newModel = editor.getModel();
      if (newModel) {
        setupEditorEventListeners(editor, newModel, handle);
      }

      lastEventData = {
        sourcePath: oldPath,
        targetPath: newPath,
      };
      emit("navigatedToFile", {
        handle,
        json: lastEventData,
      });

      setTimeout(() => {
        isNavigating = false;
      }, 100);
    }
  });

  if (editorChangeDisposable) {
    disposables.push(editorChangeDisposable);
  }

  editorInfo.disposables = disposables;

  // Delay validation to ensure all imports are loaded
  setTimeout(() => validateModel(model), 100);
}

function attachModelEventListeners(editor, model, handle) {
  const editorInfo = editors.get(handle);
  if (!editorInfo || !model) return;

  const modelUri = model.uri.toString();
  if (editorInfo.modelListenerUri === modelUri) {
    return;
  }

  clearEditorTimers(editorInfo);
  disposeDisposables(editorInfo.modelDisposables);

  editorInfo.model = model;
  editorInfo.filePath = model.uri.path.substring(1);
  editorInfo.modelListenerUri = modelUri;
  editorInfo.shouldEmitDiagnostics = false;

  const modelDisposables = [];

  const contentChangeDisposable = model.onDidChangeContent(() => {
    if (suppressContentChanged) return;

    monaco.editor.setModelMarkers(model, "files_errors", []);
    emitWithEventData("contentDirty", { handle });

    if (editorInfo.persistTimer) {
      clearTimeout(editorInfo.persistTimer);
    }
    editorInfo.persistTimer = setTimeout(() => {
      emitWithEventData("contentChanged", {
        handle,
        json: {
          content: model.getValue(),
          filePath: model.uri.path.substring(1),
        },
      });
    }, 1500);

    if (editorInfo.changeTimer) {
      clearTimeout(editorInfo.changeTimer);
    }
    editorInfo.changeTimer = setTimeout(() => {
      scheduleValidation(editorInfo, model, 0, { emitEvent: true });

      refreshMergeConflictState(editor, model, handle);
    }, 500);
  });

  if (contentChangeDisposable) {
    modelDisposables.push(contentChangeDisposable);
  } else {
    console.error("Failed to attach content change listener");
  }

  editorInfo.modelDisposables = modelDisposables;
  scheduleValidation(editorInfo, model, 100, { emitEvent: false });
}

function setupEditorEventListeners(editor, model, handle) {
  const editorInfo = editors.get(handle);
  if (!editorInfo) {
    console.error("No editor info found for handle:", handle);
    return;
  }

  if (!editorInfo.editorDisposables) {
    const disposables = [];

    const goToDefinitionDisposable = editor.onMouseDown(async (e) => {
      if (!(e.event.ctrlKey || e.event.metaKey)) return;
      const target = e.target;
      if (!target || !target.position) return;
      e.event.preventDefault();
      e.event.stopPropagation();

      const position = target.position;
      const currentModel = editor.getModel();
      if (!currentModel) return;

      try {
        const word = currentModel.getWordAtPosition(position);
        if (!word) {
          return;
        }

        const lineContent = currentModel.getLineContent(position.lineNumber);
        const currentContent = currentModel.getValue();

        let definition = null;

        const importMatch = lineContent.match(
          /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:{[^}]*}|\w+))?\s*from\s*['"]([^'"]+)['"]/,
        );

        if (importMatch) {
          const importPath = importMatch[1];
          const currentFilePath = currentModel.uri.path.substring(1);

          const fromIndex = lineContent.indexOf("from");
          const importPathStart = lineContent.indexOf(importPath, fromIndex);
          const importPathEnd = importPathStart + importPath.length;

          if (
            position.column >= importPathStart &&
            position.column <= importPathEnd + 2
          ) {
            return;
          }

          const symbolName = word.word;
          const resolvedPath = resolveImportToFilePath(
            importPath,
            currentFilePath,
          );

          if (resolvedPath && systemFiles.has(resolvedPath)) {
            const targetContent = systemFiles.get(resolvedPath);
            const lines = targetContent.split("\n");
            let foundLine = 1;

            const patterns = [
              new RegExp(
                `export\\s+(const|let|var|function|class|interface|type|enum)\\s+${symbolName}\\b`,
              ),
              new RegExp(`export\\s+{[^}]*\\b${symbolName}\\b[^}]*}`),
              new RegExp(
                `^\\s*(const|let|var|function|class|interface|type|enum)\\s+${symbolName}\\b`,
                "m",
              ),
            ];

            for (let i = 0; i < lines.length; i++) {
              for (const pattern of patterns) {
                if (pattern.test(lines[i])) {
                  foundLine = i + 1;
                  break;
                }
              }
              if (foundLine > 1) break;
            }

            definition = {
              uri: monaco.Uri.parse("file:///" + resolvedPath),
              range: new monaco.Range(foundLine, 1, foundLine, 1),
            };
          }
        }

        if (!definition) {
          const jsxComponentMatch = lineContent.match(/<(\w+)/);
          if (jsxComponentMatch && word.word === jsxComponentMatch[1]) {
            const componentName = word.word;
            const importRegex = new RegExp(
              `import\\s+(?:{[^}]*\\b${componentName}\\b[^}]*}|${componentName})\\s+from\\s+['"]([^'"]+)['"]`,
            );
            const match = currentContent.match(importRegex);

            if (match) {
              const importPath = match[1];
              const currentFilePath = currentModel.uri.path.substring(1);
              const resolvedPath = resolveImportToFilePath(
                importPath,
                currentFilePath,
              );

              if (resolvedPath && systemFiles.has(resolvedPath)) {
                const targetContent = systemFiles.get(resolvedPath);
                const lines = targetContent.split("\n");
                let foundLine = 1;

                const patterns = [
                  new RegExp(
                    `export\\s+(?:default\\s+)?(?:function|const|class)\\s+${componentName}\\b`,
                  ),
                  new RegExp(`export\\s+{[^}]*\\b${componentName}\\b[^}]*}`),
                  new RegExp(
                    `^\\s*(?:export\\s+)?(?:function|const|class)\\s+${componentName}\\b`,
                    "m",
                  ),
                ];

                for (let i = 0; i < lines.length; i++) {
                  for (const pattern of patterns) {
                    if (pattern.test(lines[i])) {
                      foundLine = i + 1;
                      break;
                    }
                  }
                  if (foundLine > 1) break;
                }

                definition = {
                  uri: monaco.Uri.parse("file:///" + resolvedPath),
                  range: new monaco.Range(foundLine, 1, foundLine, 1),
                };
              }
            }
          }
        }

        if (!definition) {
          const identifierName = word.word;
          const anyImportRegex = new RegExp(
            `import\\s+(?:{[^}]*\\b${identifierName}\\b[^}]*}|${identifierName})\\s+from\\s+['"]([^'"]+)['"]`,
          );
          const anyMatch = currentContent.match(anyImportRegex);

          if (anyMatch) {
            const importPath = anyMatch[1];
            const currentFilePath = currentModel.uri.path.substring(1);
            const resolvedPath = resolveImportToFilePath(
              importPath,
              currentFilePath,
            );

            if (resolvedPath && systemFiles.has(resolvedPath)) {
              const targetContent = systemFiles.get(resolvedPath);
              const lines = targetContent.split("\n");
              let foundLine = 1;

              const patterns = [
                new RegExp(
                  `export\\s+(?:default\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${identifierName}\\b`,
                ),
                new RegExp(`export\\s+{[^}]*\\b${identifierName}\\b[^}]*}`),
                new RegExp(
                  `^\\s*(?:export\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${identifierName}\\b`,
                  "m",
                ),
              ];

              for (let i = 0; i < lines.length; i++) {
                for (const pattern of patterns) {
                  if (pattern.test(lines[i])) {
                    foundLine = i + 1;
                    break;
                  }
                }
                if (foundLine > 1) break;
              }

              definition = {
                uri: monaco.Uri.parse("file:///" + resolvedPath),
                range: new monaco.Range(foundLine, 1, foundLine, 1),
              };
            } else {
              console.log(
                "[MouseDown] Identifier path not resolved or not a system file",
              );
            }
          }
        }

        if (!definition) {
          console.log("[MouseDown] No definition found for:", word.word);
          return;
        }

        const targetPath = definition.uri.path.substring(1);
        const currentPath = currentModel.uri.path.substring(1);

        if (targetPath !== currentPath) {
          const targetContent = systemFiles.get(targetPath);
          if (targetContent) {
            const newModel = createModel(targetPath, targetContent);
            editor.setModel(newModel);

            editorInfo.model = newModel;
            editorInfo.filePath = targetPath;

            if (definition.range) {
              setTimeout(() => {
                editor.setPosition({
                  lineNumber: definition.range.startLineNumber,
                  column: definition.range.startColumn,
                });
                editor.revealLineInCenter(definition.range.startLineNumber);

                const decorations = editor.createDecorationsCollection([{
                  range: new monaco.Range(
                    definition.range.startLineNumber,
                    1,
                    definition.range.startLineNumber,
                    1,
                  ),
                  options: {
                    isWholeLine: true,
                    className: "line-highlight",
                  },
                }]);

                setTimeout(() => {
                  decorations.clear();
                }, 2000);
              }, 50);
            }

            emitWithEventData("navigatedToFile", {
              handle,
              json: {
                sourcePath: currentPath,
                targetPath: targetPath,
              },
            });
          }
        } else if (definition.range) {
          editor.setPosition({
            lineNumber: definition.range.startLineNumber,
            column: definition.range.startColumn,
          });
          editor.revealLineInCenter(definition.range.startLineNumber);
        }
      } catch (error) {
        console.error("[MouseDown] Error navigating to definition:", error);
      }
    });

    if (goToDefinitionDisposable) {
      disposables.push(goToDefinitionDisposable);
    }

    const saveCommandDisposable = editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      async () => {
        // Cancel the pending debounced contentChanged: the save flow
        // persists/clears unsaved state itself, and a contentChanged
        // racing the save can recreate the unsaved_files row after the
        // save deletes it, leaving a stale unsaved indicator.
        if (editorInfo.persistTimer) {
          clearTimeout(editorInfo.persistTimer);
          editorInfo.persistTimer = null;
        }
        const filePath = editorInfo.filePath;
        if (
          filePath && (filePath.endsWith(".ts") || filePath.endsWith(".tsx"))
        ) {
          emitWithEventData("formatAndSave", { handle });
        } else {
          emitWithEventData("save", { handle });
        }
      },
    );

    if (saveCommandDisposable) {
      disposables.push(saveCommandDisposable);
    }

    if (!editorInfo.lastClickedLine) {
      editorInfo.lastClickedLine = null;
    }

    const lineNumberClickDisposable = editor.onMouseDown((e) => {
      if (e.event.ctrlKey || e.event.metaKey) return;

      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const lineNumber = e.target.position.lineNumber;
        const isShiftClick = e.event.shiftKey;

        let startLine = lineNumber;
        let endLine = lineNumber;

        if (isShiftClick && editorInfo.lastClickedLine !== null) {
          startLine = Math.min(editorInfo.lastClickedLine, lineNumber);
          endLine = Math.max(editorInfo.lastClickedLine, lineNumber);
        } else {
          editorInfo.lastClickedLine = lineNumber;
        }

        emitWithEventData("lineClicked", {
          handle,
          json: {
            line: lineNumber,
            startLine: startLine,
            endLine: endLine,
          },
        });
      }
    });

    if (lineNumberClickDisposable) {
      disposables.push(lineNumberClickDisposable);
    }

    let isNavigating = false;
    const editorChangeDisposable = editor.onDidChangeModel((e) => {
      if (isNavigating) return;

      if (
        e.newModelUrl && e.oldModelUrl &&
        e.newModelUrl.path !== e.oldModelUrl.path
      ) {
        const newPath = e.newModelUrl.path.substring(1);
        const oldPath = e.oldModelUrl.path.substring(1);

        isNavigating = true;

        const newModel = editor.getModel();
        if (newModel) {
          editorInfo.filePath = newPath;
          editorInfo.model = newModel;
          attachModelEventListeners(editor, newModel, handle);
        }

        emitWithEventData("navigatedToFile", {
          handle,
          json: {
            sourcePath: oldPath,
            targetPath: newPath,
          },
        });

        setTimeout(() => {
          isNavigating = false;
        }, 100);
      }
    });

    if (editorChangeDisposable) {
      disposables.push(editorChangeDisposable);
    }

    const findKeydownHandler = (event) => {
      if (
        event.defaultPrevented ||
        event.shiftKey ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }

      if (!document.body.contains(editor.getDomNode())) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openFind({ handle });
    };

    document.addEventListener("keydown", findKeydownHandler, true);
    disposables.push({
      dispose() {
        document.removeEventListener("keydown", findKeydownHandler, true);
      },
    });

    editorInfo.editorDisposables = disposables;
  }

  attachModelEventListeners(editor, model, handle);
}

function loadErrorMarkers(model, errors) {
  if (!monaco || !model || !errors) return;

  const markers = errors.map((error) => {
    let severity = monaco.MarkerSeverity.Error;
    if (error.severity === "warning") {
      severity = monaco.MarkerSeverity.Warning;
    } else if (error.severity === "info") {
      severity = monaco.MarkerSeverity.Info;
    } else if (error.severity === "hint") {
      severity = monaco.MarkerSeverity.Hint;
    }

    return {
      startLineNumber: error.line || 1,
      startColumn: error.column || 1,
      endLineNumber: error.endLine || error.line || 1,
      endColumn: error.endColumn ||
        (error.endLine && error.endLine !== error.line
          ? 1
          : (error.column || 1) + 1),
      message: error.message || "Unknown error",
      severity: severity,
      source: error.source || "external",
    };
  });

  monaco.editor.setModelMarkers(model, "files_errors", markers);
}

async function init(args) {
  const {
    handle,
    filePath,
    content,
    readOnly = false,
    versionId,
    errors,
    containerId,
  } = args;

  console.log("Monaco init called with:", {
    handle,
    filePath,
    contentLength: content?.length,
  });

  try {
    await loadMonaco();
    setupShikiTypst(); // Fire-and-forget: registers typst highlighting async
    await configureTypeScript(versionId);

    const container = getEditorContainer(containerId);
    if (!container) {
      console.error("Editor container not found:", containerId || "ts-editor");
      return false;
    }

    //If editor exists, reuse it
    const existingEditor = editors.get(handle);
    if (existingEditor && existingEditor.editor) {
      try {
        const model = createModel(filePath, content);
        suppressContentChanged = true;
        existingEditor.editor.setModel(model);
        suppressContentChanged = false;
        existingEditor.model = model;
        existingEditor.filePath = filePath;
        existingEditor.editor.updateOptions({ readOnly });
        setupEditorEventListeners(existingEditor.editor, model, handle);
        refreshMergeConflictState(existingEditor.editor, model, handle);
        return true;
      } catch (error) {
        console.warn(
          "Failed to reuse existing editor, will create new one:",
          error,
        );
        try {
          if (typeof existingEditor.editor.dispose === "function") {
            existingEditor.editor.dispose();
          }
        } catch (e) {
          console.warn("Error disposing failed editor:", e);
        }
        editors.delete(handle);
      }
    }

    if (systemFiles.size === 0) {
      await loadAllSystemFiles(versionId);
    }

    const model = createModel(filePath, content);

    // Only create models for files that are likely to be imported
    // Avoid creating models for all system files to prevent memory leak
    const importantSystemFiles = [];
    systemFiles.forEach((content, path) => {
      if (
        path !== filePath && (path.endsWith(".ts") || path.endsWith(".tsx"))
      ) {
        // Only create models for files in the same directory or commonly imported files
        const currentDir = filePath.split("/").slice(0, -1).join("/");
        const fileDir = path.split("/").slice(0, -1).join("/");

        if (
          fileDir === currentDir ||
          path.includes("system.tsx") ||
          path.includes("core.tsx") ||
          path.endsWith("/index.ts") ||
          path.endsWith("/index.tsx")
        ) {
          importantSystemFiles.push(path);
        }
      }
    });

    importantSystemFiles.forEach((path) => {
      createModel(path, systemFiles.get(path));
    });

    const editor = monaco.editor.create(container, {
      ...editorConfig,
      model: model,
      readOnly,
    });

    editors.set(handle, { editor, model, filePath });

    setupEditorEventListeners(editor, model, handle);

    if (errors && errors.length > 0) {
      loadErrorMarkers(model, errors);
    }

    refreshMergeConflictState(editor, model, handle);

    requestAnimationFrame(() => {
      emitWithEventData("contentRendered", { handle, json: { filePath } });
    });

    return true;
  } catch (error) {
    console.error("Failed to initialize Monaco editor:", error);
    return false;
  }
}

function getContent(args) {
  const { handle } = args;
  const editorInfo = editors.get(handle);

  if (editorInfo) {
    // Handle diff editor
    if (editorInfo.isDiff && editorInfo.editor) {
      const modifiedModel = editorInfo.editor.getModifiedEditor().getModel();
      if (modifiedModel) {
        return {
          found: true,
          content: modifiedModel.getValue(),
          filePath: editorInfo.filePath || "",
        };
      }
    } // Handle regular editor
    else if (editorInfo.model) {
      return {
        found: true,
        content: editorInfo.model.getValue(),
        filePath: editorInfo.filePath || "",
      };
    }
  }

  return { found: false, content: null, filePath: null };
}

function updateContent(args) {
  const { handle, content } = args;
  const editorInfo = editors.get(handle);

  if (editorInfo && editorInfo.model && typeof content === "string") {
    clearEditorTimers(editorInfo);
    const fullRange = editorInfo.model.getFullModelRange();
    suppressContentChanged = true;
    try {
      editorInfo.model.pushEditOperations(
        [],
        [{ range: fullRange, text: content }],
        () => null,
      );
    } finally {
      suppressContentChanged = false;
    }
    refreshMergeConflictState(editorInfo.editor, editorInfo.model, handle);
    return { updated: true };
  }
  return {
    updated: false,
    error: typeof content !== "string"
      ? "Content must be a string"
      : "Editor model not found",
  };
}

async function updateFile(args) {
  const { handle, filePath, content, errors, readOnly } = args;
  const editorInfo = editors.get(handle);

  if (!editorInfo) {
    console.error("No editor info found for handle:", handle);
    return;
  }

  if (!monaco) {
    console.error("Monaco not loaded");
    return;
  }

  const model = createModel(filePath, content);

  suppressContentChanged = true;
  editorInfo.editor.setModel(model);
  suppressContentChanged = false;
  editorInfo.model = model;
  editorInfo.filePath = filePath;

  // Update read-only state if provided
  if (readOnly !== undefined) {
    editorInfo.editor.updateOptions({ readOnly: readOnly });
  }

  const language = getLanguageFromPath(filePath);
  monaco.editor.setModelLanguage(model, language);
  if (errors && errors.length > 0) {
    loadErrorMarkers(model, errors);
  }

  refreshMergeConflictState(editorInfo.editor, model, handle);

  requestAnimationFrame(() => {
    emitWithEventData("contentRendered", { handle, json: { filePath } });
  });
}

async function reloadSystemFiles(args) {
  const { versionId } = args || {};

  systemFiles.clear();

  models.forEach((model, uri) => {
    if (!uri.includes("node_modules")) {
      model.dispose();
      models.delete(uri);
    }
  });

  await loadAllSystemFiles(versionId);

  return true;
}

function focus(args) {
  const { handle } = args;
  const editorInfo = editors.get(handle);

  if (editorInfo) {
    editorInfo.editor.focus();
  }
}

function openFind(args) {
  const { handle } = args;
  const editorInfo = editors.get(handle);

  if (!editorInfo || !editorInfo.editor) {
    return;
  }

  const editor = editorInfo.editor;
  editor.focus();
  const findAction = editor.getAction("actions.find");
  if (findAction) {
    findAction.run();
  } else {
    editor.trigger("keyboard", "actions.find", null);
  }
}

function cleanup(args) {
  const { handle } = args;

  // Don't cleanup if handle is empty or invalid
  if (!handle || handle === "") {
    console.log("Skipping cleanup - invalid handle");
    return;
  }

  const editorInfo = editors.get(handle);

  if (editorInfo) {
    try {
      clearEditorTimers(editorInfo);
      disposeMergeConflictCompare(editorInfo);
      clearMergeConflictWidgets(editorInfo);
      disposeDisposables(editorInfo.modelDisposables);
      disposeDisposables(editorInfo.diagnosticDisposables);
      disposeDisposables(editorInfo.editorDisposables);
      disposeDisposables(editorInfo.disposables);

      // Dispose editor
      if (
        editorInfo.editor && typeof editorInfo.editor.dispose === "function"
      ) {
        editorInfo.editor.dispose();
      }

      editors.delete(handle);
      eventDataByHandle.delete(handle);

      // Clean up unused models to prevent memory leaks
      cleanupUnusedModels();
    } catch (error) {
      console.error("Error disposing editor:", error);
      // Still remove from map even if dispose fails
      editors.delete(handle);
      eventDataByHandle.delete(handle);
    }
  } else {
    console.log("No editor found for handle:", handle);
  }
}

function cleanupUnusedModels() {
  // Clean up models that are no longer referenced by any editor
  const usedModels = new Set();
  editors.forEach((editorInfo) => {
    if (editorInfo.model) {
      usedModels.add(editorInfo.model.uri.toString());
    }
    if (editorInfo.originalModelUri) {
      usedModels.add(editorInfo.originalModelUri);
    }
  });

  let cleanedCount = 0;
  models.forEach((model, uri) => {
    if (!usedModels.has(uri) && !uri.includes("node_modules")) {
      // Don't dispose node_modules models as they might be reused
      model.dispose();
      models.delete(uri);
      cleanedCount++;
    }
  });

  if (cleanedCount > 0) {
  }
}

function layout(args) {
  const { handle } = args;
  const editorInfo = editors.get(handle);

  if (editorInfo) {
    editorInfo.editor.layout();
    requestAnimationFrame(() => {
      editorInfo.editor.layout();
    });
  }
}

async function initDiff(args) {
  const {
    handle,
    filePath,
    original,
    modified,
    readOnly = false,
    renderSideBySide,
    versionId,
    containerId,
  } = args;

  try {
    await loadMonaco();
    setupShikiTypst();

    if (
      systemFiles.size === 0 ||
      configuredTypeScriptVersionId !== (versionId ?? null)
    ) {
      await configureTypeScript(versionId);
    }

    const container = getEditorContainer(containerId);
    if (!container) {
      console.error("Editor container not found:", containerId || "ts-editor");
      return false;
    }

    const existingEditor = editors.get(handle);

    if (existingEditor && existingEditor.isDiff) {
      const currentRenderSideBySide = renderSideBySide !== undefined
        ? renderSideBySide
        : window.innerWidth > 768;
      const canReuse =
        existingEditor.renderSideBySide === currentRenderSideBySide;

      if (canReuse) {
        const oldOriginalModelUri = existingEditor.originalModelUri;
        const originalModel = createModelWithUri(
          filePath,
          original,
          diffModelUri(handle, "original", filePath),
          true,
        );
        const modifiedModel = createModelWithUri(
          filePath,
          modified,
          diffModelUri(handle, "modified", filePath),
          true,
        );
        existingEditor.editor.setModel({
          original: originalModel,
          modified: modifiedModel,
        });

        existingEditor.model = modifiedModel;
        existingEditor.filePath = filePath;
        existingEditor.originalModelUri = originalModel.uri.toString();
        existingEditor.readOnly = readOnly;

        existingEditor.editor.updateOptions({
          readOnly,
          glyphMargin: false,
          lineDecorationsWidth: 4,
          lineNumbersMinChars: 2,
          originalEditable: false,
          modifiedEditable: !readOnly,
          overviewRulerLanes: 0,
          renderMarginRevertIcon: false,
          renderValidationDecorations: "off",
        });

        const originalEditor = existingEditor.editor.getOriginalEditor();
        if (originalEditor) {
          originalEditor.updateOptions({
            glyphMargin: false,
            lineDecorationsWidth: 4,
            lineNumbersMinChars: 2,
            overviewRulerLanes: 0,
            readOnly: true,
            renderMarginRevertIcon: false,
            renderValidationDecorations: "off",
          });
        }

        const modifiedEditor = existingEditor.editor.getModifiedEditor();
        if (modifiedEditor) {
          modifiedEditor.updateOptions({
            glyphMargin: false,
            lineDecorationsWidth: 4,
            lineNumbersMinChars: 2,
            overviewRulerLanes: 0,
            readOnly,
            renderMarginRevertIcon: false,
            renderValidationDecorations: "off",
          });
        }
        suppressTypeScriptMarkersForDiff(existingEditor, [
          originalModel,
          modifiedModel,
        ]);

        if (
          oldOriginalModelUri &&
          oldOriginalModelUri !== originalModel.uri.toString()
        ) {
          const oldOriginalModel = models.get(oldOriginalModelUri);
          if (oldOriginalModel) {
            oldOriginalModel.dispose();
            models.delete(oldOriginalModelUri);
          }
        }

        return true;
      }
    }

    if (existingEditor) {
      disposeDisposables(existingEditor.diagnosticDisposables);
      if (typeof existingEditor.dispose === "function") {
        existingEditor.dispose();
      } else if (
        existingEditor.editor &&
        typeof existingEditor.editor.dispose === "function"
      ) {
        existingEditor.editor.dispose();
      }

      if (existingEditor.originalModelUri) {
        const oldOriginalModel = models.get(existingEditor.originalModelUri);
        if (oldOriginalModel) {
          oldOriginalModel.dispose();
          models.delete(existingEditor.originalModelUri);
        }
      }

      editors.delete(handle);
    }

    const originalModel = createModelWithUri(
      filePath,
      original,
      diffModelUri(handle, "original", filePath),
      true,
    );

    const modifiedModel = createModelWithUri(
      filePath,
      modified,
      diffModelUri(handle, "modified", filePath),
      true,
    );

    const diffEditor = monaco.editor.createDiffEditor(container, {
      ...editorConfig,
      glyphMargin: false,
      lineDecorationsWidth: 4,
      lineNumbersMinChars: 2,
      overviewRulerLanes: 0,
      readOnly,
      originalEditable: false,
      modifiedEditable: !readOnly,
      renderSideBySide: renderSideBySide !== undefined
        ? renderSideBySide
        : window.innerWidth > 768,
      hideUnchangedRegions: {
        enabled: true,
      },
      renderMarginRevertIcon: false,
      renderValidationDecorations: "off",
    });

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    const originalEditor = diffEditor.getOriginalEditor();
    if (originalEditor) {
      originalEditor.updateOptions({
        quickSuggestions: false,
        parameterHints: { enabled: false },
        suggestOnTriggerCharacters: false,
        hover: { enabled: false },
        occurrencesHighlight: false,
        selectionHighlight: false,
        codeLens: false,
        lightbulb: { enabled: false },
        inlayHints: { enabled: false },
        linkedEditing: false,
        glyphMargin: false,
        lineDecorationsWidth: 4,
        lineNumbersMinChars: 2,
        overviewRulerLanes: 0,
        readOnly: true,
        renderMarginRevertIcon: false,
        renderValidationDecorations: "off",
      });
    }

    const modifiedEditor = diffEditor.getModifiedEditor();
    if (modifiedEditor) {
      modifiedEditor.updateOptions({
        glyphMargin: false,
        lineDecorationsWidth: 4,
        lineNumbersMinChars: 2,
        overviewRulerLanes: 0,
        readOnly,
        renderMarginRevertIcon: false,
        renderValidationDecorations: "off",
      });
    }

    const finalRenderSideBySide = renderSideBySide !== undefined
      ? renderSideBySide
      : window.innerWidth > 768;
    const editorInfo = {
      editor: diffEditor,
      model: modifiedModel,
      filePath,
      isDiff: true,
      renderSideBySide: finalRenderSideBySide,
      originalModelUri: originalModel.uri.toString(),
      readOnly,
    };
    editors.set(handle, editorInfo);
    suppressTypeScriptMarkersForDiff(editorInfo, [
      originalModel,
      modifiedModel,
    ]);

    return true;
  } catch (error) {
    console.error("Failed to initialize diff editor:", error);
    return false;
  }
}

function getEventData(args = {}) {
  return getHandleEventData(args.handle, args.eventName);
}

function goToLine(args) {
  const { handle, line, column, endLine, endColumn } = args;
  const editorInfo = editors.get(handle);
  if (!editorInfo || !editorInfo.editor) {
    console.warn("Editor not found:", handle);
    return;
  }

  const editor = editorInfo.editor;
  const startColumn = column || 1;
  const targetEndLine = endLine || line;
  const targetEndColumn = endColumn ||
    (targetEndLine !== line ? 1 : startColumn + 1);
  editor.setPosition({
    lineNumber: line,
    column: startColumn,
  });
  editor.setSelection({
    startLineNumber: line,
    startColumn,
    endLineNumber: targetEndLine,
    endColumn: Math.max(targetEndColumn, startColumn + 1),
  });
  editor.revealRangeInCenter({
    startLineNumber: line,
    startColumn,
    endLineNumber: targetEndLine,
    endColumn: Math.max(targetEndColumn, startColumn + 1),
  });
  editor.focus();
}

// Highlight lines without scrolling (for when user clicks line numbers)
function highlightLines(args) {
  const { handle, startLine, endLine } = args;
  const editorInfo = editors.get(handle);
  if (!editorInfo || !editorInfo.editor) {
    console.warn("Editor not found:", handle);
    return;
  }

  const editor = editorInfo.editor;

  // Store the decorations collection if not already present
  if (!editorInfo.lineHighlightDecorations) {
    editorInfo.lineHighlightDecorations = editor.createDecorationsCollection();
  }

  // Create decorations for the line range
  const decorations = [{
    range: new monaco.Range(startLine, 1, endLine, 1),
    options: {
      isWholeLine: true,
      className: "line-highlight",
      marginClassName: "line-highlight-margin",
    },
  }];

  editorInfo.lineHighlightDecorations.set(decorations);
}

// Highlight and scroll to lines (for when loading from URL)
function searchAndGoToMatch(args) {
  const { handle, searchText } = args;
  const editorInfo = editors.get(handle);
  if (!editorInfo || !editorInfo.editor) {
    console.warn("Editor not found:", handle);
    return;
  }

  const editor = editorInfo.editor;
  const model = editorInfo.model;

  if (!searchText || !model) {
    return;
  }

  // Find the first match
  const matches = model.findMatches(
    searchText,
    false,
    false,
    false,
    null,
    false,
  );

  if (matches && matches.length > 0) {
    const firstMatch = matches[0];

    // Go to the match
    editor.setPosition({
      lineNumber: firstMatch.range.startLineNumber,
      column: firstMatch.range.startColumn,
    });

    // Reveal the line in center
    editor.revealLineInCenter(firstMatch.range.startLineNumber);

    // Highlight the match temporarily
    const decorations = editor.createDecorationsCollection([{
      range: firstMatch.range,
      options: {
        className: "line-highlight",
        inlineClassName: "line-highlight",
      },
    }]);

    // Clear highlight after 2 seconds
    setTimeout(() => {
      decorations.clear();
    }, 2000);

    // Focus the editor
    editor.focus();
  }
}

function highlightAndScrollToLines(args) {
  const { handle, startLine, endLine } = args;
  const editorInfo = editors.get(handle);
  if (!editorInfo || !editorInfo.editor) {
    console.warn("Editor not found:", handle);
    return;
  }

  const editor = editorInfo.editor;

  // Store the decorations collection if not already present
  if (!editorInfo.lineHighlightDecorations) {
    editorInfo.lineHighlightDecorations = editor.createDecorationsCollection();
  }

  // Create decorations for the line range
  const decorations = [{
    range: new monaco.Range(startLine, 1, endLine, 1),
    options: {
      isWholeLine: true,
      className: "line-highlight",
      marginClassName: "line-highlight-margin",
    },
  }];

  editorInfo.lineHighlightDecorations.set(decorations);

  // Scroll to the line
  editor.revealLineInCenter(startLine);
}

function navigateToDefinition(args) {
  const { handle, filePath, line, symbol } = args;
  const editorInfo = editors.get(handle);

  if (!editorInfo || !editorInfo.editor) {
    console.warn("Editor not found:", handle);
    return false;
  }

  let targetPath = filePath;
  let content = systemFiles.get(targetPath);

  if (!content) {
    const extensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      "/index.ts",
      "/index.tsx",
    ];
    for (const ext of extensions) {
      const pathWithExt = targetPath + ext;
      if (systemFiles.has(pathWithExt)) {
        targetPath = pathWithExt;
        content = systemFiles.get(pathWithExt);
        break;
      }
    }
  }

  if (!content) {
    console.warn("Target file not found:", filePath);
    emitWithEventData("navigationFailed", {
      handle,
      json: {
        reason: "fileNotFound",
        path: filePath,
      },
    });
    return false;
  }

  const model = createModel(targetPath, content);

  editorInfo.editor.setModel(model);
  editorInfo.model = model;
  editorInfo.filePath = targetPath;

  if (line && line > 0) {
    editorInfo.editor.setPosition({
      lineNumber: line,
      column: 1,
    });
    editorInfo.editor.revealLineInCenter(line);
  } else if (symbol) {
    const lines = content.split("\n");
    const patterns = [
      new RegExp(
        `export\\s+(?:default\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${symbol}\\b`,
      ),
      new RegExp(`export\\s+{[^}]*\\b${symbol}\\b[^}]*}`),
      new RegExp(
        `^\\s*(?:export\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${symbol}\\b`,
        "m",
      ),
    ];

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (pattern.test(lines[i])) {
          editorInfo.editor.setPosition({
            lineNumber: i + 1,
            column: 1,
          });
          editorInfo.editor.revealLineInCenter(i + 1);

          const decorations = editorInfo.editor.createDecorationsCollection([{
            range: new monaco.Range(i + 1, 1, i + 1, lines[i].length + 1),
            options: {
              className: "line-highlight",
              isWholeLine: true,
            },
          }]);

          setTimeout(() => {
            decorations.clear();
          }, 2000);

          return true;
        }
      }
    }
  }

  editorInfo.editor.focus();

  setupEditorEventListeners(editorInfo.editor, model, handle);

  emitWithEventData("navigatedToFile", {
    handle,
    json: {
      targetPath: targetPath,
      success: true,
    },
  });

  return true;
}

function refreshErrorMarkers(args) {
  const { handle, errors } = args;
  const editorInfo = editors.get(handle);

  if (!editorInfo || !editorInfo.model) {
    console.warn("No editor or model found for handle:", handle);
    return;
  }

  monaco.editor.setModelMarkers(editorInfo.model, "files_errors", []);

  if (errors && errors.length > 0) {
    loadErrorMarkers(editorInfo.model, errors);
  }
}

function getErrorMarkers(args) {
  const { handle } = args;
  const editorInfo = editors.get(handle);

  if (!editorInfo || !editorInfo.model) {
    return [];
  }

  const markers = monaco.editor.getModelMarkers({
    resource: editorInfo.model.uri,
  });
  return markers.map((marker) => ({
    line: marker.startLineNumber,
    column: marker.startColumn,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn,
    severity: marker.severity === monaco.MarkerSeverity.Error
      ? "error"
      : marker.severity === monaco.MarkerSeverity.Warning
      ? "warning"
      : marker.severity === monaco.MarkerSeverity.Info
      ? "info"
      : "hint",
    message: marker.message,
    source: marker.source || "external",
  }));
}

async function formatContent(args) {
  const { handle, formattedContent } = args;
  const editorInfo = editors.get(handle);

  if (!editorInfo || !editorInfo.model) {
    return { formatted: false, error: "No editor or model found" };
  }

  if (formattedContent !== undefined) {
    if (formattedContent === null) {
      return { formatted: false, error: "Invalid TypeScript syntax" };
    }

    const currentContent = editorInfo.model.getValue();
    if (currentContent !== formattedContent) {
      const position = editorInfo.editor.getPosition();

      const fullRange = editorInfo.model.getFullModelRange();
      suppressContentChanged = true;
      editorInfo.model.pushEditOperations(
        [],
        [{ range: fullRange, text: formattedContent }],
        () => null,
      );
      suppressContentChanged = false;

      if (position) {
        editorInfo.editor.setPosition(position);
      }

      return { formatted: true };
    }
    return { formatted: true, unchanged: true };
  }

  const content = editorInfo.model.getValue();
  const filePath = editorInfo.filePath;

  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
    return { formatted: false, error: "Not a TypeScript file" };
  }

  emit("formatRequest", {
    handle,
    json: {
      content: content,
      filePath: filePath,
    },
  });

  return { formatted: false, pending: true };
}

registerModule({
  init,
  initDiff,
  updateContent,
  updateFile,
  focus,
  openFind,
  getContent,
  getEventData,
  goToLine,
  highlightLines,
  highlightAndScrollToLines,
  searchAndGoToMatch,
  navigateToDefinition,
  cleanup,
  layout,
  reloadSystemFiles,
  refreshErrorMarkers,
  getErrorMarkers,
  formatContent,
});
