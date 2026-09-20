import { Divider } from "components/divider";
import { Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { siteProseStyles } from "pages/site/prose_styles";
import type { Style } from "std/style_types";
import type { Node } from "std/ui";
import { EventHandlers } from "std/ui";

/** Author/byline metadata shown on a content detail page. */
export interface ContentDetailAuthor {
  /** Visible author name. */
  name: string;
  /** Optional avatar image URL. */
  avatar?: string;
  /** Optional author title or role. */
  title?: string;
}

/**
 * Props for {@link ContentDetailPage}.
 *
 * This component owns the common detail-page shell for public long-form
 * content: title metadata, scroll reset, optional cover image, optional
 * eyebrow/byline/date metadata, shared prose styling, tags, unavailable state,
 * and a return link. It is token-driven and contains no app-specific routes,
 * copy, or palette.
 */
export interface ContentDetailPageProps {
  /** Browser document title and visible page heading. */
  title: string;
  /** App or brand name appended to the document title. */
  titleBrand: string;
  /** Optional meta description for the document head. */
  description?: string;
  /** Rendered long-form body content. */
  content?: Node;
  /** Whether the content should render. Defaults to `true`. */
  available?: boolean;
  /** Optional cover image URL. */
  coverImage?: string;
  /** Optional label shown above the title. */
  eyebrow?: string;
  /** Optional date or metadata string shown below the title. */
  date?: string;
  /** Optional author/byline block. */
  author?: ContentDetailAuthor;
  /** Optional tag pills shown after the body. */
  tags?: string[];
  /** Destination for the return link. */
  indexHref: string;
  /** Return-link label. */
  indexLabel: string;
  /** Message shown when `available` is false. */
  unavailableMessage?: string;
  /** Optional style overrides for the outer band. */
  outerSx?: Style;
  /** Optional style overrides for the centered content container. */
  containerSx?: Style;
}

/** Generic detail page for public articles, posts, resources, and case studies. */
export function ContentDetailPage(props: ContentDetailPageProps) {
  const available = props.available ?? true;

  return (
    <>
      <title>{`${props.title} | ${props.titleBrand}`}</title>
      {props.description && (
        <meta name="description" content={props.description} />
      )}
      <EventHandlers
        mount={(s) => {
          s.window.scrollTo({ top: 0, left: 0 });
        }}
      />
      <div
        sx={[
          {
            minHeight: "100vh",
          },
          props.outerSx,
        ]}
      >
        <div
          sx={[
            {
              maxWidth: "800px",
              mx: "auto",
              px: 6,
              py: 12,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
              sm: { px: 8 },
              md: { px: 12, py: 24 },
            },
            props.containerSx,
          ]}
        >
          {available
            ? (
              <>
                {props.coverImage && (
                  <img
                    src={props.coverImage}
                    alt={props.title}
                    sx={{
                      width: "100%",
                      height: "400px",
                      objectFit: "cover",
                      borderRadius: "xl",
                      boxShadow: "lg",
                    }}
                  />
                )}
                <div className="mb-12">
                  {props.eyebrow && (
                    <Typography
                      level="body-xs"
                      sx={{
                        fontWeight: 700,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "var(--site-accent-strong)",
                        mb: 3,
                      }}
                    >
                      {props.eyebrow}
                    </Typography>
                  )}
                  <Typography
                    level="h1"
                    sx={{
                      mb: 3,
                      fontSize: "2.5rem",
                      fontWeight: "800",
                      lineHeight: "1.2",
                      color: "var(--site-text)",
                      md: { fontSize: "3.5rem" },
                    }}
                  >
                    {props.title}
                  </Typography>
                  <div
                    sx={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      color: "var(--site-text-muted)",
                      flexWrap: "wrap",
                    }}
                  >
                    {props.author && (
                      <div className="flex items-center gap-4">
                        {props.author.avatar
                          ? (
                            <img
                              src={props.author.avatar}
                              alt={props.author.name}
                              sx={{
                                width: 48,
                                height: 48,
                                borderRadius: "50%",
                                objectFit: "cover",
                                border: "2px solid",
                                borderColor: "var(--site-shadow-brand)",
                              }}
                            />
                          )
                          : (
                            <div
                              className="w-[48px] h-[48px] rounded-[50%] flex items-center justify-center"
                              sx={{
                                background: "var(--site-accent-tint)",
                                color: "var(--site-accent)",
                              }}
                            >
                              <MaterialIcon icon="Person" />
                            </div>
                          )}
                        <div>
                          <Typography
                            level="body-sm"
                            sx={{
                              fontWeight: "bold",
                              color: "var(--site-text)",
                            }}
                          >
                            {props.author.name}
                          </Typography>
                          {props.author.title && (
                            <Typography
                              level="body-xs"
                              sx={{ color: "var(--site-text-muted)" }}
                            >
                              {props.author.title}
                            </Typography>
                          )}
                        </div>
                      </div>
                    )}
                    {props.date && (
                      <Typography
                        level="body-sm"
                        className="flex items-center gap-2"
                        sx={{ color: "var(--site-text-body)" }}
                      >
                        <MaterialIcon
                          icon="CalendarToday"
                          className="text-[1.2em]"
                        />
                        {props.date}
                      </Typography>
                    )}
                  </div>
                </div>
                <Divider />
                <div sx={siteProseStyles}>{props.content}</div>
                {props.tags && props.tags.length > 0 && (
                  <div
                    sx={{
                      display: "flex",
                      gap: 1,
                      flexWrap: "wrap",
                      mt: 8,
                      pt: 4,
                      borderTop: "1px solid",
                      borderColor: "var(--site-border)",
                    }}
                  >
                    {props.tags.map((tag) => (
                      <Typography
                        level="body-xs"
                        className="px-4 py-1.5 rounded-full font-medium"
                        sx={{
                          background: "var(--site-accent-tint)",
                          color: "var(--site-accent)",
                        }}
                      >
                        {tag}
                      </Typography>
                    ))}
                  </div>
                )}
                <div className="pt-8">
                  <Link
                    href={props.indexHref}
                    className="inline-flex items-center gap-2 font-medium no-underline hover:underline"
                    sx={{ color: "var(--site-accent-strong)" }}
                  >
                    <MaterialIcon icon="ArrowBack" />
                    {props.indexLabel}
                  </Link>
                </div>
              </>
            )
            : (
              <div className="text-center py-24">
                <Typography
                  level="h3"
                  sx={{ color: "var(--site-danger)", mb: 6 }}
                >
                  {props.unavailableMessage ?? "This content is not available."}
                </Typography>
                <Link
                  href={props.indexHref}
                  className="inline-flex items-center gap-2 font-medium no-underline hover:underline"
                  sx={{ color: "var(--site-accent)" }}
                >
                  <MaterialIcon icon="ArrowBack" />
                  {props.indexLabel}
                </Link>
              </div>
            )}
        </div>
      </div>
    </>
  );
}
