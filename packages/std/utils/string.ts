/**
Removes common leading whitespace from every line in a template literal.
This function can be used as a template tag or called directly with a string.

@param {TemplateStringsArray | string} templateStrings - The template strings array or a single string.
@param {...any} values - The interpolated values if used as a template tag.
@returns {string} The dedented string with common leading whitespace removed.

@category Helper Function
 */
export function dedent(
  templateStrings: TemplateStringsArray | string,
  ...values: any[]
) {
  const matches = [];
  const strings = typeof templateStrings === "string"
    ? [templateStrings]
    : templateStrings.slice();

  // 1. Remove trailing whitespace.
  strings[strings.length - 1] = strings[strings.length - 1].replace(
    /\r?\n([\t ]*)$/,
    "",
  );

  // 2. Find all line breaks to determine the highest common indentation level.
  for (const string of strings) {
    const match = string.match(/\n[\t ]+/g);

    if (match) {
      matches.push(...match);
    }
  }

  // 3. Remove the common indentation from all strings.
  if (matches.length) {
    const size = Math.min(...matches.map((value) => value.length - 1));
    const pattern = new RegExp(`\n[\t ]{${size}}`, "g");

    for (let i = 0; i < strings.length; i++) {
      strings[i] = strings[i].replace(pattern, "\n");
    }
  }

  // 4. Remove leading whitespace.
  strings[0] = strings[0].replace(/^\r?\n/, "");

  // 5. Perform interpolation.
  let string = strings[0];

  for (let i = 0; i < values.length; i++) {
    string += values[i] + strings[i + 1];
  }

  return string;
}

/**
 * Returns the last portion of a path, similar to Node's path.basename.
 *
 * @param {string} path - The file path
 * @param {string} [ext] - Optional file extension to remove from the result
 * @returns {string} The basename of the path
 *
 * @example
 * ```typescript
 * basename('/path/to/file.txt') // 'file.txt'
 * basename('/path/to/file.txt', '.txt') // 'file'
 * basename('/path/to/file.txt', 'txt') // 'file'
 * basename('file.txt') // 'file.txt'
 * basename('file.txt', '.txt') // 'file'
 * basename('/path/to/') // ''
 * basename('/path/to') // 'to'
 * ```
 *
 * @category Helper Function
 */
export function basename(path: string, ext?: string): string {
  // Handle edge cases
  if (!path) {
    return "";
  }

  // Normalize path separators to forward slashes for consistency
  const normalizedPath = path.replace(/\\/g, "/");

  // Remove trailing slashes
  const trimmedPath = normalizedPath.replace(/\/+$/, "");

  // If the path is empty after trimming, return empty string
  if (!trimmedPath) {
    return "";
  }

  // Get the last part of the path
  const parts = trimmedPath.split("/");
  const result = parts[parts.length - 1];

  // If no extension provided, return the basename as is
  if (!ext) {
    return result;
  }

  // Remove the extension if it matches
  // Handle both with and without leading dot
  const extToRemove = ext.startsWith(".") ? ext : `.${ext}`;

  if (result.endsWith(extToRemove)) {
    return result.slice(0, -extToRemove.length);
  }

  return result;
}
