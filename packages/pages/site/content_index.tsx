import { Button } from "components/button";
import { Card, CardOverflow } from "components/card";
import { Link } from "components/link";
import { Typography } from "components/typography";
import type { Style } from "std/style_types";
import { EventHandlers } from "std/ui";
import type { Node } from "std/ui";

/**
 * Generic listing page shell for public content indexes such as blogs,
 * articles, news, resources, or case studies.
 *
 * The component owns the common index-page structure: document title,
 * scroll-to-top behavior, header copy, and a responsive card grid. It consumes
 * the semantic `--site-*` token contract but does not define a concrete brand
 * palette. Apps that want decorative art can pass it through `background`.
 */
export function ContentIndexPage(props: {
  /** Browser document title before the app/brand suffix. */
  title: string;
  /** App or brand name appended to the document title. */
  titleBrand: string;
  /** Short uppercase label above the heading. */
  eyebrow: string;
  /** Main visible page heading. */
  heading: string;
  /** Intro copy shown under the heading. */
  description: string;
  /** Cards or other index items rendered inside the responsive grid. */
  children: Node;
  /** Optional decorative background supplied by the consuming app. */
  background?: Node;
  /** Override for the outer hero/index band. */
  sx?: Style;
}) {
  return (
    <>
      <title>{`${props.title} | ${props.titleBrand}`}</title>
      <meta name="description" content={props.description} />
      <EventHandlers
        mount={(s) => {
          s.window.scrollTo({ top: 0, left: 0 });
        }}
      />
      <div sx={{ minHeight: "100vh" }}>
        <div
          sx={[
            {
              position: "relative",
              overflow: "hidden",
              background: "var(--site-accent-soft)",
              pt: "calc(var(--page-header-height) + 64px)",
              pb: 18,
            },
            props.sx,
          ]}
        >
          {props.background}
          <div
            sx={{
              position: "relative",
              maxWidth: "1200px",
              mx: "auto",
              px: 6,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              sm: { px: 8 },
              md: { px: 12 },
            }}
          >
            <div
              className="text-center"
              sx={{
                maxWidth: "760px",
                mx: "auto",
                px: 4,
                py: 6,
                sm: { px: 8 },
              }}
            >
              <Typography
                level="body-xs"
                sx={{
                  mb: 2,
                  fontWeight: 700,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "var(--site-accent)",
                }}
              >
                {props.eyebrow}
              </Typography>
              <Typography
                level="h1"
                sx={{
                  mb: 3,
                  fontSize: "2.5rem",
                  fontWeight: "800",
                  letterSpacing: 0,
                  lineHeight: "1.1",
                  color: "var(--site-text)",
                  md: { fontSize: "3.5rem" },
                }}
              >
                {props.heading}
              </Typography>
              <Typography
                level="body-lg"
                sx={{
                  color: "var(--site-text-muted)",
                  lineHeight: "1.6",
                }}
              >
                {props.description}
              </Typography>
            </div>
            <div
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                justifyContent: "center",
                gap: 6,
                md: {
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 360px))",
                },
              }}
            >
              {props.children}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Generic empty state for public content indexes.
 *
 * Use when a filtered index has no matching items yet. Keeping this in the
 * shared content-index layer avoids one-off blank sections or app-specific
 * placeholder card styles.
 */
export function ContentIndexEmptyState(props: {
  /** Visible empty-state heading. */
  title: Node;
  /** Optional explanatory copy. */
  description?: Node;
  /** Optional link to a broader index or next useful page. */
  action?: {
    label: Node;
    href: string;
  };
}) {
  return (
    <div
      sx={{
        gridColumn: "1 / -1",
        width: "100%",
        maxWidth: "640px",
        mx: "auto",
        p: 8,
        textAlign: "center",
        background: "var(--site-surface)",
        border: "1px solid var(--site-border)",
        borderRadius: "18px",
        boxShadow: "0 1px 3px var(--site-shadow-soft)",
      }}
    >
      <Typography
        level="h3"
        sx={{
          color: "var(--site-text)",
          fontSize: "1.45rem",
          fontWeight: 750,
          lineHeight: 1.2,
          mb: props.description ? 3 : 0,
        }}
      >
        {props.title}
      </Typography>
      {props.description && (
        <Typography
          level="body-md"
          sx={{
            color: "var(--site-text-muted)",
            lineHeight: 1.65,
            mb: props.action ? 5 : 0,
          }}
        >
          {props.description}
        </Typography>
      )}
      {props.action && (
        <Button
          href={props.action.href}
          endIcon="ArrowForward"
          sx={{
            background: "var(--site-accent)",
            color: "var(--site-on-accent)",
            fontWeight: 700,
            "&:hover": {
              hoverEnabled: {
                background: "var(--site-accent-strong)",
                color: "var(--site-on-accent)",
              },
            },
          }}
        >
          {props.action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * Generic card for a public content index.
 *
 * The card is intentionally data-oriented: consumers provide title, link,
 * date/metadata text, optional description, image, eyebrow and tags. Visual
 * styling comes from semantic `--site-*` tokens.
 */
export function ContentIndexCard(props: {
  /** Card heading. */
  title: string;
  /** Destination for the image, title, and action button. */
  href: string;
  /** Short date or metadata string displayed under the title. */
  date: string;
  /** Optional summary copy. */
  description?: string;
  /** Optional cover image URL. */
  coverImage?: string;
  /** Optional label shown above tags/title. */
  eyebrow?: string;
  /** Optional tag pills. */
  tags?: string[];
  /** Action button label. Defaults to "Read more". */
  actionLabel?: string;
}) {
  return (
    <Card
      variant="plain"
      className="flex flex-col"
      sx={{
        backgroundColor: "var(--site-surface)",
        borderRadius: "xl",
        overflow: "hidden",
        border: "1px solid var(--site-border)",
        boxShadow: "0 1px 3px var(--site-shadow-soft)",
        transition: "box-shadow 0.25s ease, transform 0.25s ease",
        "&:hover": {
          boxShadow: "0 12px 32px var(--site-shadow-panel)",
          transform: "translateY(-3px)",
        },
      }}
    >
      {props.coverImage && (
        <CardOverflow>
          <Link href={props.href}>
            <img
              src={props.coverImage}
              alt={props.title}
              loading="lazy"
              sx={{
                width: "100%",
                height: "240px",
                objectFit: "cover",
              }}
            />
          </Link>
        </CardOverflow>
      )}
      <div className="p-8 flex flex-col gap-4 grow">
        {props.eyebrow && (
          <Typography
            level="body-xs"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--site-accent)",
            }}
          >
            {props.eyebrow}
          </Typography>
        )}
        {props.tags && props.tags.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {props.tags.map((tag) => (
              <Typography
                level="body-xs"
                sx={{
                  px: 4,
                  py: 1.5,
                  background: "var(--site-accent-tint)",
                  color: "var(--site-accent)",
                  borderRadius: "999px",
                  fontWeight: 600,
                }}
              >
                {tag}
              </Typography>
            ))}
          </div>
        )}
        <Link
          href={props.href}
          sx={{ textDecoration: "none", color: "inherit" }}
        >
          <Typography
            level="h3"
            sx={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              lineHeight: "1.3",
              color: "var(--site-text)",
            }}
          >
            {props.title}
          </Typography>
        </Link>
        <Typography
          level="body-sm"
          sx={{ color: "var(--site-text-muted)", fontWeight: "medium" }}
        >
          {props.date}
        </Typography>
        {props.description && (
          <Typography
            level="body-md"
            sx={{
              color: "var(--site-text-muted)",
              lineHeight: "1.6",
            }}
          >
            {props.description}
          </Typography>
        )}
      </div>
      <div
        sx={{
          borderTop: "1px solid var(--site-border)",
          mt: "auto",
          px: 3,
          py: 2,
        }}
      >
        <Link
          href={props.href}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "0.9rem",
            fontWeight: 700,
            color: "var(--site-accent)",
            textDecoration: "none",
            "& [data-content-card-arrow]": {
              transition: "transform 0.2s ease",
            },
            "&:hover": {
              hoverEnabled: {
                color: "var(--site-accent-strong)",
                "& [data-content-card-arrow]": {
                  transform: "translateX(3px)",
                },
              },
            },
          }}
        >
          {props.actionLabel ?? "Read more"}
          <span data-content-card-arrow="" aria-hidden="true">→</span>
        </Link>
      </div>
    </Card>
  );
}
