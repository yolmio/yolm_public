import type { IServerBaseStatements } from "std/statements";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { App } from "std/system";

/**
 * Transport contract implemented by reusable Gmail and Postmark campaign
 * providers. Customer systems own the surrounding campaign workflow.
 */
export interface EmailCampaignProvider {
  name: string;

  sendEmail<T extends IServerBaseStatements>(
    s: T,
    params: {
      accountId: AnyExpr;
      to: Sql;
      cc?: Sql;
      bcc?: Sql;
      subject: Sql;
      body: Sql;
      previewText?: Sql;
      from: Sql;
      replyTo?: Sql;
      headers?: { name: Sql; value: Sql }[];
      responseScalar?: string;
    },
  ): void;

  checkResponses?<T extends IServerBaseStatements>(
    s: T,
    params: {
      accountId: AnyExpr;
      afterDate: Sql;
      threadIds: string;
      responsesTable: string;
      maxResults?: AnyExpr;
    },
  ): void;

  getOAuthUrl?(): Sql;
  addOauthRedirect?(app: App): void;
  getAccountStatus?(accountId: AnyExpr): Sql;
  refreshTokens?<T extends IServerBaseStatements>(
    s: T,
    accountId: AnyExpr,
  ): void;

  checkBounces?<T extends IServerBaseStatements>(
    s: T,
    params: {
      accountId: AnyExpr;
      afterDate: Sql;
      emailsTable: string;
      recipientsTable: string;
      attachmentsTable: string;
      maxResults?: AnyExpr;
    },
  ): void;
}
