import { system } from "std/system";
import type { Block } from "std/system";
import { sql } from "std/sql_utils";

/**
 * Solution block that provides the `managed_oauth_credentials` table —
 * the platform's internal OAuth credential store. Other blocks (e.g.
 * Gmail, Outlook, Zoom) read/write to this table to persist refresh
 * tokens, scopes, and credential health for managed providers.
 *
 * Add once in `core.tsx`:
 *
 * ```ts
 * system.addBlock(new OAuthCredentialsBlock());
 * ```
 */
export class OAuthCredentialsBlock implements Block {
  blockName = "OAuthCredentialsBlock";
  definedByBlock?: string;
  componentDependencies: string[] = [];
  description =
    "Provides the internal managed OAuth credential store used by platform-owned OAuth flows.";

  initialize() {
    system.enum_({
      name: "oauth_credential_status",
      values: ["active", "reauth_required"],
    });

    system.db.table("managed_oauth_credentials", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.string("provider", 100).notNull();
      table.string("provider_subject", 500);
      table.string("email", 500);
      table.string("refresh_token_encrypted", 5000).notNull();
      table.string("granted_scopes", 5000);
      table.enum("status", "oauth_credential_status").notNull().default(
        sql`'active'`,
      );
      table.timestampUtc("created_at").notNull();
      table.timestampUtc("updated_at").notNull();
    });

    // Internal APIs for platform-rewrite Rust code to interact with the database
    // These endpoints are not exposed publicly - only accessible via internal routing
    const api = system.api({
      prefix: "/api",
      domain: "internal-fake-domain.com",
    });

    // =============================================================================
    // Managed OAuth Credentials
    // =============================================================================

    api.post("/oauth/get-credential", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.defScalar(
          "input_credential_id",
          sql`try_cast(body->>'credential_id' as bigint)`,
        );

        s.if(sql`input_credential_id is null`, (s) => {
          s.setHttpStatus(400);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(
            sql`json_build_object('error', 'credential_id is required')`,
          );
        });

        s.defRecord(
          "cred",
          sql`
          select
            id,
            provider,
            provider_subject,
            email,
            refresh_token_encrypted,
            granted_scopes,
            status
          from managed_oauth_credentials
          where id = input_credential_id
          limit 1
        `,
        );

        s.if(sql`cred.id is null`, (s) => {
          s.setHttpStatus(200);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(sql`'null'`);
        });

        s.setHttpStatus(200);
        s.setHeader("content-type", sql.lit`application/json`);
        s.return(sql`json_build_object(
          'credential_id', cred.id,
          'provider', cred.provider,
          'provider_subject', cred.provider_subject,
          'email', cred.email,
          'refresh_token_encrypted', cred.refresh_token_encrypted,
          'granted_scopes', cred.granted_scopes,
          'status', cred.status
        )`);
      },
    });

    api.post("/oauth/create-credential", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.defScalar("input_provider", sql`body->>'provider'`);
        s.defScalar("input_provider_subject", sql`body->>'provider_subject'`);
        s.defScalar("input_email", sql`body->>'email'`);
        s.defScalar(
          "input_refresh_token_encrypted",
          sql`body->>'refresh_token_encrypted'`,
        );
        s.defScalar("input_granted_scopes", sql`body->>'granted_scopes'`);

        s.if(
          sql`input_provider is null or input_refresh_token_encrypted is null`,
          (s) => {
            s.setHttpStatus(400);
            s.setHeader("content-type", sql.lit`application/json`);
            s.return(
              sql`json_build_object('error', 'provider and refresh_token_encrypted are required')`,
            );
          },
        );

        s.startTransaction();
        s.modify(sql`
          insert into managed_oauth_credentials (
            provider, provider_subject, email,
            refresh_token_encrypted, granted_scopes,
            status, created_at, updated_at
          ) values (
            input_provider, input_provider_subject, input_email,
            input_refresh_token_encrypted, input_granted_scopes,
            'active', current_timestamp, current_timestamp
          )
        `);
        s.defScalar(
          "new_id",
          sql`last_record_id(managed_oauth_credentials)`,
        );
        s.commitTransaction();

        s.setHttpStatus(201);
        s.setHeader("content-type", sql.lit`application/json`);
        s.return(sql`json_build_object('credential_id', new_id)`);
      },
    });

    api.post("/oauth/update-credential", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.defScalar(
          "input_credential_id",
          sql`try_cast(body->>'credential_id' as bigint)`,
        );
        s.defScalar("input_provider_subject", sql`body->>'provider_subject'`);
        s.defScalar("input_email", sql`body->>'email'`);
        s.defScalar(
          "input_refresh_token_encrypted",
          sql`body->>'refresh_token_encrypted'`,
        );
        s.defScalar("input_granted_scopes", sql`body->>'granted_scopes'`);

        s.if(sql`input_credential_id is null`, (s) => {
          s.setHttpStatus(400);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(
            sql`json_build_object('error', 'credential_id is required')`,
          );
        });
        s.defScalar(
          "credential_exists",
          sql`(select id from managed_oauth_credentials where id = input_credential_id)`,
        );
        s.if(sql`credential_exists is null`, (s) => {
          s.setHttpStatus(404);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(sql`json_build_object('error', 'Credential not found')`);
        });

        s.startTransaction();
        s.modify(sql`
          update managed_oauth_credentials
          set
            provider_subject = input_provider_subject,
            email = input_email,
            refresh_token_encrypted = input_refresh_token_encrypted,
            granted_scopes = input_granted_scopes,
            status = 'active',
            updated_at = current_timestamp
          where id = input_credential_id
        `);
        s.commitTransaction();

        s.setHttpStatus(200);
        s.setHeader("content-type", sql.lit`application/json`);
        s.return(sql`json_build_object('status', 'ok')`);
      },
    });

    api.post("/oauth/delete-credential", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.defScalar(
          "input_credential_id",
          sql`try_cast(body->>'credential_id' as bigint)`,
        );

        s.if(sql`input_credential_id is null`, (s) => {
          s.setHttpStatus(400);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(
            sql`json_build_object('error', 'credential_id is required')`,
          );
        });
        s.defScalar(
          "credential_exists",
          sql`(select id from managed_oauth_credentials where id = input_credential_id)`,
        );
        s.if(sql`credential_exists is null`, (s) => {
          s.setHttpStatus(404);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(sql`json_build_object('error', 'Credential not found')`);
        });

        s.startTransaction();
        s.modify(
          sql`delete from managed_oauth_credentials where id = input_credential_id`,
        );
        s.commitTransaction();

        s.setHttpStatus(200);
        s.setHeader("content-type", sql.lit`application/json`);
        s.return(sql`json_build_object('status', 'ok')`);
      },
    });

    api.post("/oauth/mark-reauth", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.defScalar(
          "input_credential_id",
          sql`try_cast(body->>'credential_id' as bigint)`,
        );

        s.if(sql`input_credential_id is null`, (s) => {
          s.setHttpStatus(400);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(
            sql`json_build_object('error', 'credential_id is required')`,
          );
        });
        s.defScalar(
          "credential_exists",
          sql`(select id from managed_oauth_credentials where id = input_credential_id)`,
        );
        s.if(sql`credential_exists is null`, (s) => {
          s.setHttpStatus(404);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(sql`json_build_object('error', 'Credential not found')`);
        });

        s.startTransaction();
        s.modify(sql`
          update managed_oauth_credentials
          set status = 'reauth_required', updated_at = current_timestamp
          where id = input_credential_id
        `);
        s.commitTransaction();

        s.setHttpStatus(200);
        s.setHeader("content-type", sql.lit`application/json`);
        s.return(sql`json_build_object('status', 'ok')`);
      },
    });

    api.post("/oauth/update-refresh-token", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.defScalar(
          "input_credential_id",
          sql`try_cast(body->>'credential_id' as bigint)`,
        );
        s.defScalar(
          "input_refresh_token_encrypted",
          sql`body->>'refresh_token_encrypted'`,
        );

        s.if(
          sql`input_credential_id is null or input_refresh_token_encrypted is null`,
          (s) => {
            s.setHttpStatus(400);
            s.setHeader("content-type", sql.lit`application/json`);
            s.return(
              sql`json_build_object('error', 'credential_id and refresh_token_encrypted are required')`,
            );
          },
        );
        s.defScalar(
          "credential_exists",
          sql`(select id from managed_oauth_credentials where id = input_credential_id)`,
        );
        s.if(sql`credential_exists is null`, (s) => {
          s.setHttpStatus(404);
          s.setHeader("content-type", sql.lit`application/json`);
          s.return(sql`json_build_object('error', 'Credential not found')`);
        });

        s.startTransaction();
        s.modify(sql`
          update managed_oauth_credentials
          set
            refresh_token_encrypted = input_refresh_token_encrypted,
            updated_at = current_timestamp
          where id = input_credential_id
        `);
        s.commitTransaction();

        s.setHttpStatus(200);
        s.setHeader("content-type", sql.lit`application/json`);
        s.return(sql`json_build_object('status', 'ok')`);
      },
    });
  }
}
