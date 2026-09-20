import { AuthBlock } from "blocks/auth";
import { AccessCheck } from "blocks/auth/access_check";
import {
  canViewStaffAccess,
  isAccessAdministrator,
} from "blocks/auth/access_policy";
import type { StandardUserManagementProps } from "blocks/auth";
import { OutgoingWebhooksBlock } from "blocks/outgoing_webhooks";
import { TimeGreeting } from "components/greeting";
// import { staticWebhookManagementPage } from "pages/static_webhook_management";
import { Navbar } from "components/navbar";
import { PageHeader } from "components/page_header";
import { StatRow } from "components/stat_row";
import { Typography } from "components/typography";
import { DbManagementPage } from "pages/db_management";
import { StaticWebhookManagementPage } from "pages/static_webhook_management";
import { AuthLoginFailuresPage } from "pages/auth_login_failures";
import { sql } from "../std/sql_utils";
import { system } from "std/system";
import type { LogoGeneration } from "std/system";
import { Authorize, Route, Routes } from "std/ui";
import type { Node } from "std/ui";

/** Options for {@link adminApp}. */
interface AdminAppOpts {
  domain: string;
  /** Extra navbar links inserted after the core admin links (Database, Roles, Users, Auth Failures) and before any block-provided webhook links. */
  links?: string[];
  /** Additional routes rendered inside the app's `<Routes>`. */
  routes?: Node;
  /**
   * Permission required to access the app. Defaults to
   * `"can_access_admin_app"`.
   * With AuthBlock.accessPolicy, delegated operators may open user pages and
   * the configured sysadmin permission protects all other administrative routes.
   */
  requiredPermission?: string;
  /** Props forwarded to the standard user-management pages. */
  userManagement?: StandardUserManagementProps;
  /** Favicon / PWA logo generation forwarded to the app. */
  logoGeneration?: LogoGeneration;
}

/**
Defines an admin app for the system. This app will have a navbar,
pages for managing the database, users, roles, and any other admin pages.
That are provided by blocks (for example, outgoing webhooks).
You can add any other routes in the opts.routes parameter.
Each system should typically have an admin app and use this app component.

 @category App Component, initial
 */
export function adminApp(inputOpts: AdminAppOpts | string) {
  const opts = typeof inputOpts === "string"
    ? { domain: inputOpts }
    : inputOpts;
  const hasStaticWebhooks = system.staticWebhooks.length > 0;
  const policy = system.block(AuthBlock).opts.accessPolicy;
  const adminOnly = (children: Node) =>
    policy
      ? (
        <Authorize
          procedure={(s) => s.return(isAccessAdministrator())}
          unauthorized={
            <Typography>System administration is required.</Typography>
          }
        >
          {children}
        </Authorize>
      )
      : children;
  // Match the route group before authorizing; Routes cannot discover routes
  // hidden beneath an Authorize node.
  const AdminRoutes = ({ children }: { children: Node }) => (
    <Route path="*">
      {adminOnly(<Routes>{children}</Routes>)}
    </Route>
  );
  const hasOugoingWebhooks = Boolean(
    system.blockOptional(OutgoingWebhooksBlock),
  );

  const links = [
    { url: "/db-management", label: "Database" },
    "/roles",
    "/users",
    { url: "/auth-failures", label: "Auth Failures" },
    ...(opts.links ?? []),
    ...(hasStaticWebhooks
      ? [{ url: "/static-webhooks", label: "Static Webhooks" }]
      : []),
    ...(hasOugoingWebhooks
      ? [{ url: "/outgoing-webhooks", label: "Outgoing Webhooks" }]
      : []),
  ];

  return system.app({
    domain: opts.domain,
    logoGeneration: opts.logoGeneration,
    ui: (
      <AuthBlock.DefaultEmailOtpAuth
        requiredPermission={policy
          ? undefined
          : opts.requiredPermission ?? "can_access_admin_app"}
        validateUser={policy
          ? canViewStaffAccess(sql`sys_users.id`)
          : undefined}
        loginText="Sign in to the admin app"
      >
        <title>System Admin</title>
        <AccessCheck
          when={policy ? isAccessAdministrator() : sql.true}
          fallback={
            <Navbar color="primary" variant="solid" links={["/users"]} />
          }
        >
          <Navbar color="primary" variant="solid" links={links} />
        </AccessCheck>
        <Routes>
          <AuthBlock.StandardUserManagement {...opts.userManagement} />
          <AdminRoutes>
            <Route path="/">
              <div className="container grid grid-cols-12 gap-4 md:gap-8 p-4">
                <PageHeader>
                  <div>
                    <Typography level="h2">
                      <TimeGreeting />
                    </Typography>
                    <Typography level="body-lg" sx={{ maxWidth: 600 }}>
                      Welcome to the admin app. Here you can manage the
                      database, users, roles, and do any other administrative
                      actions.
                    </Typography>
                  </div>
                </PageHeader>
                <StatRow
                  stats={[
                    {
                      title: "Total Users",
                      value: sql`(select count(*) from sys_users)`,
                    },
                    {
                      title: "New Users in the last 30 days",
                      value:
                        sql`(select count(*) from sys_users where abs(date.diff(day, now(), sys_users.created_at)) < 30)`,
                    },
                    {
                      title: "Login Failures (24h)",
                      value:
                        sql`(select count(*) from auth_login_failures where attempted_at > date.add(hour, -24, now()))`,
                      color: "warning",
                    },
                  ]}
                />
              </div>
            </Route>
            <DbManagementPage />
            {hasStaticWebhooks && <StaticWebhookManagementPage />}
            {hasOugoingWebhooks && (
              <OutgoingWebhooksBlock.WebhookManagementPage path="/outgoing-webhooks" />
            )}
            <AuthLoginFailuresPage />
            {opts.routes}
          </AdminRoutes>
        </Routes>
      </AuthBlock.DefaultEmailOtpAuth>
    ),
  });
}
