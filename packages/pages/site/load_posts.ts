import type { StaticBlogPost } from "./static_blog";
import type { StaticPage } from "./static_content";
import * as YolmGenApi from "std/yolm_gen_api";

async function loadSystemExports<T>(
  dir: string,
  exportName: string,
): Promise<T[]> {
  const allFiles: string[] = YolmGenApi.listSystemFiles(dir);
  const files = allFiles.filter((file) =>
    file.endsWith(".ts") || file.endsWith(".tsx")
  );

  return await Promise.all(
    files.map(async (file) => {
      const module = await import(
        YolmGenApi.resolveSystemModule(`${dir}/${file}`)
      );
      return module[exportName] as T;
    }),
  );
}

/**
 * Generation-time helper that imports every blog-post module under
 * `dir` (a path relative to the system root) and returns the
 * `module.post` exports sorted newest first. Use to feed
 * {@link StaticBlogPages}.
 */
export async function loadBlogPosts(dir: string): Promise<StaticBlogPost[]> {
  const posts = await loadSystemExports<StaticBlogPost>(dir, "post");
  return posts.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/**
 * Generation-time helper that imports every static-page module under
 * `dir` and returns the `module.page` exports sorted alphabetically by
 * title. Use to feed {@link StaticContent}.
 */
export async function loadPages(dir: string): Promise<StaticPage[]> {
  const pages = await loadSystemExports<StaticPage>(dir, "page");
  return pages.sort((a, b) => a.title.localeCompare(b.title));
}
