import type { Node } from "std/ui";
import { Route } from "std/ui";
import { EventHandlers } from "std/ui";
import { siteProseStyles } from "pages/site/prose_styles";

/** A single static page imported by {@link loadPages} and rendered by {@link StaticContent}. */
export interface StaticPage {
  /** Route path the page mounts at. */
  path: string;
  /** Document title (combined with `titleBrand`). */
  title: string;
  /** Page body. */
  content: Node;
}

/**
 * Routes for a set of code-defined static pages (terms, privacy,
 * marketing copy). Load file-based pages with {@link loadPages} at
 * generation time, then pass the resulting `pages` array here.
 */
export function StaticContent(props: {
  /** Pages loaded at generation time with {@link loadPages}. */
  pages?: StaticPage[];
  /** App or brand name appended to page titles. */
  titleBrand: string;
}) {
  const pages = props.pages ?? [];
  return (
    <>
      {pages.map((page) => (
        <Route path={page.path}>
          <title>
            {page.title} | {props.titleBrand}
          </title>
          <EventHandlers
            mount={(s) => {
              s.window.scrollTo({ top: 0, left: 0 });
            }}
          />
          <div
            className="xs:px-6 sm:px-8 md:px-12 py-18 md:py-24"
            sx={{
              maxWidth: "800px",
              mx: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
            }}
          >
            <div sx={siteProseStyles}>{page.content}</div>
          </div>
        </Route>
      ))}
    </>
  );
}
