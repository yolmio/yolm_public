import { sql } from "../../std/sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import type {
  DomStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import type { App, Block } from "std/system";
import type { Node } from "std/ui";

/** Conservatively normalizes one RFC Message-ID without fuzzy matching. */
export function normalizedInternetMessageId(value: Sql): Sql {
  const unwrapped = sql`nullif(trim(case
    when trim(${value}) like '<%>'
      then substring(trim(${value}) from 2 for length(trim(${value})) - 2)
    else trim(${value})
  end), '')`;
  return sql`case
    when ${unwrapped} is null or position('@' in ${unwrapped}) <= 1
      then null
    else substring(${unwrapped} from 1 for position('@' in ${unwrapped}) - 1)
      || '@' || lower(substring(${unwrapped} from position('@' in ${unwrapped}) + 1))
  end`;
}

/** Logical identity: RFC Message-ID when valid, immutable occurrence otherwise. */
export function emailIdentityKey(opts: {
  provider: string;
  accountId: Sql;
  providerMessageId: Sql;
  internetMessageId: Sql;
}): Sql {
  const internetMessageId = normalizedInternetMessageId(
    opts.internetMessageId,
  );
  return sql`case
    when ${internetMessageId} is not null then 'mid:' || ${internetMessageId}
    else 'occ:' || ${sql.lit(opts.provider)} || ':'
      || cast(${opts.accountId} as string)
      || ':' || ${opts.providerMessageId}
  end`;
}

export interface SendEmailOpts {
  accountId: Sql;
  /** Comma-separated recipient addresses. */
  to: Sql;
  /** Comma-separated Cc addresses. */
  cc?: Sql;
  /** Comma-separated Bcc addresses. */
  bcc?: Sql;
  subject: Sql;
  body: Sql;
  from: Sql;
  attachments?: {
    filename: Sql;
    content: Sql;
    contentType: Sql;
  }[];
  threadId?: Sql;
  isReply?: boolean;
  replyAll?: BooleanExpr;
  inReplyTo?: Sql;
  /** Gmail reply reference chain; falls back to inReplyTo when absent or empty. */
  references?: Sql;
  beforeEmailSent?: (
    s: EmailSentHookStatements,
    ctx: EmailSentHookContext,
  ) => void;
  afterEmailSent?: (
    s: EmailSentHookStatements,
    ctx: EmailSentHookContext,
  ) => void;
  onEmailSendError?: (
    s: EmailSentHookStatements,
    ctx: EmailSendErrorHookContext,
  ) => void;
}

export interface SendEmailFromServerOpts {
  accountId: Sql;
  /** Comma-separated recipient addresses. */
  to: Sql;
  /** Comma-separated Cc addresses. */
  cc?: Sql;
  /** Comma-separated Bcc addresses. */
  bcc?: Sql;
  subject: Sql;
  body: Sql;
  from: Sql;
  attachments?: {
    filename: Sql;
    content: Sql;
    contentType: Sql;
  }[];
  /**
   * Runtime attachment rows with `id`, `filename`, `content_type`,
   * `size_bytes`, and `blob`. The integration validates the bounded workload,
   * then loads each blob before constructing the provider request.
   */
  attachmentsQuery?: Sql;
  beforeEmailSent?: SendEmailOpts["beforeEmailSent"];
  afterEmailSent?: SendEmailOpts["afterEmailSent"];
  onEmailSendError?: SendEmailOpts["onEmailSendError"];
}

export interface ConnectedAccountEmailDeliveryLimits {
  /** Published provider ceiling for one-recipient send requests in a rolling minute. */
  maxMessagesPerMinute: number;
  /** Published provider ceiling for recipients attempted in a rolling 24 hours. */
  maxRecipientsPer24Hours: number;
}

/**
 * The narrow outbound capability consumed by connected-account delivery.
 * Provider blocks continue to own accounts, OAuth credentials, and the
 * provider request; the caller only stores the integration key and account ID.
 */
export interface ConnectedAccountEmailIntegration {
  integrationKey: string;
  integrationName: string;
  deliveryLimits: ConnectedAccountEmailDeliveryLimits;
  /**
   * Returns account_id, from_address, and mailbox_identity for active accounts
   * owned by userId. mailbox_identity must be a stable opaque string shared
   * across connections and aliases that consume the same provider mailbox
   * quota.
   */
  availableSendersQuery(userId: Sql): Sql;
  /** Resolves stable identity without requiring the account to remain active. */
  mailboxIdentityQuery(accountId: AnyExpr): Sql;
  /** Returns the owning sys_user_id when background delivery needs user context. */
  accountOwnerQuery?: (accountId: AnyExpr) => Sql;
  sendEmailFromServer<T extends IServerBaseStatements>(
    s: T,
    opts: SendEmailFromServerOpts,
  ): void;
}

export type EmailSentHookStatements =
  | DomStatements
  | IServerBaseStatements
  | UiServerStatements;

export interface EmailSentHookContext {
  provider: "gmail" | "outlook_email";
  accountId: Sql;
  /** Comma-separated recipient addresses. */
  to: Sql;
  cc?: Sql;
  bcc?: Sql;
  subject: Sql;
  body: Sql;
  from?: Sql;
  threadId?: Sql;
  isReply?: boolean;
  inReplyTo?: Sql;
  references?: Sql;
  attachments?: {
    filename: Sql;
    content: Sql;
    contentType: Sql;
  }[];
}

export interface EmailSendErrorHookContext extends EmailSentHookContext {
  errorMessage: Sql;
  /** False only when no provider request began or the provider explicitly rejected it. */
  deliveryMayHaveOccurred?: BooleanExpr;
}

export interface MarkAsReadOpts {
  emailId: Sql;
  accountId: NumericExpr;
}

export interface DeleteAccountOpts {
  accountId: NumericExpr;
}

export interface EmailIntegration
  extends Block, ConnectedAccountEmailIntegration {
  /**
       Send an email through this account
       */
  sendEmail<T extends DomStatements>(s: T, opts: SendEmailOpts): void;

  /**
       Mark an email as read
       */
  markAsRead<T extends IServerBaseStatements>(s: T, opts: MarkAsReadOpts): void;

  /**
       Add OAuth redirect endpoint for this integration
       */
  addOauthRedirect(app: App): void;

  /**
       Navigate to OAuth consent screen
       */
  navigateToOauth(s: DomStatements): void;

  integrationName: string;
  icon: (props: { sx?: Style }) => Node;
  accountDisplay: Node;
  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteAccountOpts,
  ): void;
  accountTable: string;
  emailTable: string;
  isActiveAccount: BooleanExpr;
  adminStatus: Node;
  emailsPage: (props: { where: Sql; path: string }) => Node;
  // sentEmailsPage: (props: { where: Sql }) => Node;
  emailsList: (props: { where: Sql }) => Node;
  bodyFieldNode: Node;
}

export type EmailIntegrationConstructor = new (
  ...args: any[]
) => EmailIntegration;
