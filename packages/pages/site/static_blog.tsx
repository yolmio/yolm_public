import { ContentDetailPage } from "pages/site/content_detail";
import {
  ContentIndexCard,
  ContentIndexEmptyState,
  ContentIndexPage,
} from "pages/site/content_index";
import type { Node } from "std/ui";
import { Route } from "std/ui";

/** Publication state of a {@link StaticBlogPost}. */
export type StaticBlogStatus = "draft" | "archived" | "published";

/**
 * App-defined grouping key used to filter posts into audience, category,
 * vertical, industry, or other app-specific indexes.
 */
export type StaticBlogGroup = string;

/** A single static blog post imported by {@link loadBlogPosts}. */
export interface StaticBlogPost {
  /** URL slug mounted under `basePath`, e.g. `my-post`. */
  slug: string;
  /** Visible post title and document title. */
  title: string;
  /** Display date string. Sorts newest-first via `new Date(date)`. */
  date: string;
  /** Optional summary used by index cards. */
  description?: string;
  /** Optional image URL used on indexes and detail pages. */
  coverImage?: string;
  /** Rendered post body. Usually plain TSX content. */
  content: Node;
  /** Publication status; only `published` appears on indexes. */
  status: StaticBlogStatus;
  /** Optional byline metadata. */
  author?: {
    name: string;
    avatar?: string;
    title?: string;
  };
  /** Optional tag pills shown on index/detail pages. */
  tags?: string[];
  /** Optional app-defined grouping keys used by `filterRoutes`. */
  groups?: StaticBlogGroup[];
  /** Optional route allow-list for apps that expose subsets of posts. */
  showOnPaths?: string[];
}

/** Route definition for an additional filtered blog index. */
export interface StaticBlogFilterRoute {
  /** Route path for the filtered index. */
  path: string;
  /** Browser document title before the app/brand suffix. */
  title: string;
  /** Short uppercase label above the heading. */
  eyebrow: string;
  /** Main visible page heading. */
  heading: string;
  /** Intro copy shown under the heading. */
  description: string;
  /** App-defined grouping key to match against `post.groups`. */
  group: StaticBlogGroup;
}

function normalizePath(path: string) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function shouldShowPostForPath(post: StaticBlogPost, path?: string) {
  if (!path || !post.showOnPaths) return true;
  const normalizedPath = normalizePath(path);
  return post.showOnPaths.some((showOnPath) =>
    normalizePath(showOnPath) === normalizedPath
  );
}

function shouldShowPostForGroup(
  post: StaticBlogPost,
  group?: StaticBlogGroup,
) {
  if (!group) return true;
  return post.groups?.includes(group) ?? false;
}

function publishedPosts(
  posts: StaticBlogPost[],
  opts: { showForPath?: string; group?: StaticBlogGroup },
) {
  return posts
    .filter((p) => p.status === "published")
    .filter((p) => shouldShowPostForPath(p, opts.showForPath))
    .filter((p) => shouldShowPostForGroup(p, opts.group))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function BlogPostDetail(props: {
  post: StaticBlogPost;
  titleBrand: string;
  basePath: string;
}) {
  const { post } = props;
  return (
    <ContentDetailPage
      title={post.title}
      titleBrand={props.titleBrand}
      description={post.description}
      content={post.content}
      available={post.status === "published"}
      coverImage={post.coverImage}
      date={post.date}
      author={post.author}
      tags={post.tags}
      indexHref={props.basePath}
      indexLabel="Return to blog home"
      unavailableMessage="This post is not available."
    />
  );
}

/**
 * Routes for a static, file-driven blog: a listing page and a detail
 * page per post. Load file-based posts with {@link loadBlogPosts} at
 * generation time, then pass the resulting `posts` array here.
 *
 * Use for marketing / public-facing blog sections of an app.
 */
export function StaticBlogPages(props: {
  /** Posts loaded at generation time with {@link loadBlogPosts}. */
  posts?: StaticBlogPost[];
  /** App or brand name appended to page titles. */
  titleBrand: string;
  /** Optional allow-list filter applied to post indexes. */
  showForPath?: string;
  /** Optional app-defined grouping key applied to the default indexes. */
  showForGroup?: StaticBlogGroup;
  /** Extra filtered index routes such as audience or category-specific blogs. */
  filterRoutes?: StaticBlogFilterRoute[];
  /** Base path for the canonical blog index and detail routes. Defaults to `/blog`. */
  basePath?: string;
  /** Additional index aliases. Defaults to `/blogs`; pass `[]` to disable. */
  aliases?: string[];
}) {
  const posts = props.posts ?? [];
  const basePath = normalizePath(props.basePath ?? "/blog");
  const aliases = props.aliases ?? ["/blogs"];
  const renderBlogIndex = (opts?: {
    title?: string;
    eyebrow?: string;
    heading?: string;
    description?: string;
    group?: StaticBlogGroup;
  }) => {
    const visiblePosts = publishedPosts(posts, {
      showForPath: props.showForPath,
      group: opts?.group ?? props.showForGroup,
    });
    return (
      <ContentIndexPage
        title={opts?.title ?? "Blog"}
        titleBrand={props.titleBrand}
        eyebrow={opts?.eyebrow ?? "Insights"}
        heading={opts?.heading ?? "Latest Posts"}
        description={opts?.description ??
          "Insights, updates, and stories from the team."}
      >
        {visiblePosts.length === 0 && (
          <ContentIndexEmptyState
            title="No posts published here yet."
            description="This filtered index is ready for future content. Browse the full blog for the latest published posts."
            action={{ label: "Browse all posts", href: basePath }}
          />
        )}
        {visiblePosts.map((post) => (
          <ContentIndexCard
            title={post.title}
            href={`${basePath}/${post.slug}`}
            date={post.date}
            description={post.description}
            coverImage={post.coverImage}
            tags={post.tags}
          />
        ))}
      </ContentIndexPage>
    );
  };

  return (
    <>
      <Route path={basePath}>
        {renderBlogIndex()}
      </Route>
      {aliases.map((alias) => (
        <Route path={normalizePath(alias)}>
          {renderBlogIndex()}
        </Route>
      ))}
      {props.filterRoutes?.map((route) => (
        <Route path={route.path}>
          {renderBlogIndex({
            title: route.title,
            eyebrow: route.eyebrow,
            heading: route.heading,
            description: route.description,
            group: route.group,
          })}
        </Route>
      ))}
      {posts.map((post) => (
        <Route path={`${basePath}/${post.slug}`}>
          <BlogPostDetail
            post={post}
            titleBrand={props.titleBrand}
            basePath={basePath}
          />
        </Route>
      ))}
    </>
  );
}
