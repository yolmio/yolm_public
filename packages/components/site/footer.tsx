import { Divider } from "components/divider";
import { DiscordIcon } from "components/icons/discord";
import { EmailIcon } from "components/icons/email";
import { FacebookIcon } from "components/icons/facebook";
import { GithubIcon } from "components/icons/github";
import { InstagramIcon } from "components/icons/instagram";
import { LinkedInIcon } from "components/icons/linkedin";
import { XIcon } from "components/icons/x";
import { YouTubeIcon } from "components/icons/youtube";
import { Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Typography } from "components/typography";
import type { Style } from "std/style_types";
import { sql } from "std/sql_utils";
import { useState } from "std/ui";
import type { Node } from "std/ui";

/**
 * Link item rendered inside a footer column.
 */
export interface FooterLink {
  /** Visible link label. */
  label: Node;
  /** Destination path or URL. */
  href: string;
  /** Optional Material icon shown before the label. */
  icon?: IconName;
}

/**
 * Group of related footer links.
 */
export interface FooterColumn {
  /** Column heading. */
  header: string;
  /** Links displayed under this heading. */
  links: FooterLink[];
}

/** Built-in footer social icon names plus Material icon names. */
export type FooterSocialIcon =
  | IconName
  | "X"
  | "Facebook"
  | "LinkedIn"
  | "YouTube"
  | "Instagram"
  | "GitHub"
  | "Discord"
  | "Email";

function Icon({ icon, sx }: { icon: FooterSocialIcon; sx?: Style }) {
  if (icon === "X") {
    return <XIcon sx={sx} />;
  }
  if (icon === "Facebook") {
    return <FacebookIcon sx={sx} />;
  }
  if (icon === "LinkedIn") {
    return <LinkedInIcon sx={sx} />;
  }
  if (icon === "YouTube") {
    return <YouTubeIcon sx={sx} />;
  }
  if (icon === "Instagram") {
    return <InstagramIcon sx={sx} />;
  }
  if (icon === "GitHub") {
    return <GithubIcon sx={sx} />;
  }
  if (icon === "Discord") {
    return <DiscordIcon sx={sx} />;
  }
  if (icon === "Email") {
    return <EmailIcon sx={sx} />;
  }
  return <MaterialIcon icon={icon} sx={sx} />;
}

/** Social/profile link rendered as a compact icon link. */
export interface FooterSocialLink {
  /** Icon name, also used as the link's accessible label. */
  type: FooterSocialIcon;
  /** Destination URL. */
  href: string;
}

/**
 * Props for {@link Footer}.
 *
 * The footer is a generic website shell. It consumes semantic `--site-*`
 * tokens supplied by the app and does not define a concrete brand palette.
 */
export interface FooterProps {
  /** Navigation columns displayed in the main footer grid. */
  columns?: FooterColumn[];
  /** Optional profile/social icon links. */
  socialLinks?: FooterSocialLink[];
  /** Optional privacy policy link shown in the legal row. */
  privacyPolicyLink?: string;
  /** Optional terms of service link shown in the legal row. */
  termsOfServiceLink?: string;
  /** Optional notes shown below the main link grid. */
  disclaimers?: string[];
  /**
   * Optional SQL expression for the displayed year. Defaults to the current
   * runtime year.
   */
  copyrightYearExpr?: string;
  /**
   * Fully overrides the bottom-row copyright text. When omitted, the footer
   * renders `© {year}` plus `companyName` when provided.
   */
  bottomText?: string;
  /** Optional organization name used in the default bottom text. */
  companyName?: string;
  /** Optional logo or brand node shown beside the bottom text. */
  logo?: Node;
}

function FooterSocialLinks(props: { links: FooterSocialLink[] }) {
  return (
    <div className="flex gap-4">
      {props.links.map((social) => (
        <Link
          href={social.href}
          aria-label={social.type}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            color: "var(--site-text-body)",
            textDecoration: "none",
            "&:hover": {
              color: "var(--site-accent)",
              "& svg": {
                color: "var(--site-accent)",
              },
            },
          }}
        >
          <Icon
            icon={social.type}
            sx={{
              color: "var(--site-text-body)",
              width: "18px",
              height: "18px",
            }}
          />
        </Link>
      ))}
    </div>
  );
}

/**
 * Generic website footer with navigation columns, optional legal links,
 * disclaimers, social/profile links, and bottom copyright text.
 *
 * Styling is driven by semantic `--site-*` CSS variables from the consuming
 * app. Keep app-specific copy, route sets, and palettes in the app layer.
 */
export function Footer(props: FooterProps) {
  const {
    columns,
    socialLinks,
    privacyPolicyLink,
    termsOfServiceLink,
    disclaimers,
    copyrightYearExpr,
    bottomText,
  } = props;
  const hasColumns = (columns?.length ?? 0) > 0;

  useState((s) => {
    s.defScalar(
      "current_year",
      copyrightYearExpr
        ? sql.lit(copyrightYearExpr)
        : sql`date.part(year, today())::string`,
    );
  });

  const defaultBottomText = props.companyName
    ? sql.concat(
      "© ",
      sql`cast(current_year as string)`,
      " ",
      props.companyName,
      " | All Rights Reserved",
    )
    : sql.concat("© ", sql`cast(current_year as string)`);

  return (
    <div
      sx={{
        pt: 8,
        px: 4,
        pb: 4,
        background: "var(--site-accent-soft)",
        borderTop: "1px solid",
        borderColor: "var(--site-border)",
      }}
    >
      <div
        sx={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
          gap: 8,
          maxWidth: "1000px",
          mx: "auto",
          mb: 8,
        }}
      >
        {columns?.map((col) => (
          <div>
            <Typography
              level="title-md"
              sx={{ mb: 2, color: "var(--site-text)" }}
            >
              {col.header}
            </Typography>
            {col.links.map((link) => (
              <div className="mb-2">
                <Link
                  href={link.href}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: link.icon ? 1 : 0,
                    color: "var(--site-text-body)",
                    textDecoration: "none",
                    "&:hover": { color: "var(--site-accent)" },
                  }}
                >
                  {link.icon && (
                    <MaterialIcon
                      icon={link.icon}
                      className="text-base align-middle"
                    />
                  )}
                  {link.label}
                </Link>
              </div>
            ))}
          </div>
        ))}

        {socialLinks && socialLinks.length > 0 && !hasColumns && (
          <div>
            <Typography
              level="title-md"
              sx={{ mb: 2, color: "var(--site-text)" }}
            >
              Connect
            </Typography>
            <FooterSocialLinks links={socialLinks} />
          </div>
        )}
      </div>

      {disclaimers && disclaimers.length > 0 && (
        <div
          sx={{
            maxWidth: "1000px",
            mx: "auto",
            mb: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {disclaimers.map((line) => (
            <Typography
              level="body-sm"
              sx={{ color: "var(--site-text-body)" }}
            >
              {line}
            </Typography>
          ))}
        </div>
      )}

      {(privacyPolicyLink || termsOfServiceLink) && (
        <>
          <Divider />
          <div
            sx={{
              maxWidth: "1000px",
              mx: "auto",
              py: 3,
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {privacyPolicyLink && (
              <Link
                href={privacyPolicyLink}
                sx={{
                  color: "var(--site-text-body)",
                  textDecoration: "none",
                  "&:hover": { color: "var(--site-accent)" },
                }}
              >
                Privacy Policy
              </Link>
            )}
            {termsOfServiceLink && (
              <Link
                href={termsOfServiceLink}
                sx={{
                  color: "var(--site-text-body)",
                  textDecoration: "none",
                  "&:hover": { color: "var(--site-accent)" },
                }}
              >
                Terms of Service
              </Link>
            )}
          </div>
        </>
      )}

      <Divider className="mb-4" />

      <div
        sx={{
          maxWidth: "1000px",
          mx: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Typography
          level="body-sm"
          sx={{ color: "var(--site-text-muted)" }}
          startDecorator={props.logo}
        >
          {bottomText ?? defaultBottomText}
        </Typography>

        {socialLinks && socialLinks.length > 0 && hasColumns && (
          <FooterSocialLinks links={socialLinks} />
        )}
      </div>
    </div>
  );
}
