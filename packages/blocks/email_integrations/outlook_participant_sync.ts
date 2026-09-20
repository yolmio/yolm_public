import type { BooleanExpr, Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";

export interface OutlookParticipantSyncConfig {
  /** Normalized addresses exposed as `address` with their `client_id`. */
  participants: Sql;
  defaultSince: Sql;
}

interface OutlookParticipantSyncHandlers {
  syncPage<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: Sql;
      credentialId: Sql;
      normalizedAddress: Sql;
      windowStart: Sql;
      windowEnd: Sql;
      continuationUrl: Sql;
      nextPageLinkScalar: string;
      resultCountScalar: string;
      writeFence: BooleanExpr;
    },
  ): void;
  markReauthRequired<T extends IServerBaseStatements>(
    s: T,
    opts: { accountId: Sql; credentialId: Sql; errorMessage: Sql },
  ): void;
}

export function defineOutlookParticipantSyncSchema() {
  system.enum_({
    name: "outlook_contact_email_sync_status",
    values: [
      { name: "pending", displayName: "Pending" },
      { name: "running", displayName: "Running" },
      { name: "completed", displayName: "Completed" },
      { name: "failed", displayName: "Failed" },
    ],
  });

  system.db.table("outlook_contact_email_sync_jobs", (table) => {
    table.sampleData({ skipSampleData: true });
    table.autoCompact();
    table.fk("user_outlook_emails_accounts").notNull().onDelete("Cascade");
    table.string("contact_email", 500).notNull().collation("Binary");
    table.date("requested_since").notNull();
    table.date("window_start").notNull();
    table.date("window_end").notNull();
    table.string("continuation_url", 10000);
    table.smallUint("provider_result_count").notNull().default(sql`0`);
    table.enum("status", "outlook_contact_email_sync_status").notNull()
      .default(sql.lit`pending`);
    table.smallUint("attempt_count").notNull().default(sql`0`);
    table.timestampUtc("next_attempt_at").notNull().default(sql`now()`);
    table.string("last_error", 5000);
    table.string("claim_id", 100);
    table.timestampUtc("enqueued_at").notNull().default(sql`now()`);
    table.timestampUtc("started_at");
    table.unique(["user_outlook_emails_account_id", "contact_email"]);
  });
}

export function enqueueOutlookParticipantSync<
  T extends IServerBaseStatements,
>(
  s: T,
  opts: {
    participants: Sql;
    since: Sql;
    accountWhere?: BooleanExpr;
  },
) {
  const accountWhere = opts.accountWhere ?? sql`true`;
  s.modify(sql`
    update db.outlook_contact_email_sync_jobs job
    set status = 'pending'::enums.outlook_contact_email_sync_status,
        requested_since = ${opts.since},
        window_start = greatest(
          ${opts.since},
          date.add(day, -29, current_date)
        ),
        window_end = date.add(day, 1, current_date),
        continuation_url = null,
        provider_result_count = 0,
        attempt_count = 0,
        claim_id = null,
        started_at = null,
        next_attempt_at = now(),
        enqueued_at = now(),
        last_error = null
    where (
        cast(job.status as string) != 'running'
        or job.started_at is null
        or job.started_at <= date.add(hour, -1, now())
      )
      and exists (
        select 1
        from db.user_outlook_emails_accounts account
        where account.id = job.user_outlook_emails_account_id
          and account.status = 'active'
          and account.credential_id is not null
          and (${accountWhere})
      )
      and exists (
        select 1
        from (${opts.participants}) participant
        where participant.address = job.contact_email
      )
  `);
  s.modify(sql`
    insert into db.outlook_contact_email_sync_jobs (
      user_outlook_emails_account_id,
      contact_email,
      requested_since,
      window_start,
      window_end,
      status,
      enqueued_at,
      next_attempt_at
    )
    select
      account.id,
      participant.address,
      ${opts.since},
      greatest(${opts.since}, date.add(day, -29, current_date)),
      date.add(day, 1, current_date),
      'pending'::enums.outlook_contact_email_sync_status,
      now(),
      now()
    from db.user_outlook_emails_accounts account
    cross join (${opts.participants}) participant
    where account.status = 'active'
      and account.credential_id is not null
      and (${accountWhere})
      and not exists (
        select 1
        from db.outlook_contact_email_sync_jobs existing
        where existing.user_outlook_emails_account_id = account.id
          and existing.contact_email = participant.address
      )
    on conflict (
      user_outlook_emails_account_id,
      contact_email
    ) do nothing
  `);
}

export function resetOutlookParticipantSyncForAccount<
  T extends IServerBaseStatements,
>(s: T, config: OutlookParticipantSyncConfig, accountId: Sql) {
  s.startTransaction();
  s.modify(sql`update db.outlook_contact_email_sync_jobs
    set requested_since = ${config.defaultSince},
        window_start = greatest(
          ${config.defaultSince},
          date.add(day, -29, current_date)
        ),
        window_end = date.add(day, 1, current_date),
        continuation_url = null,
        provider_result_count = 0,
        status = 'pending'::enums.outlook_contact_email_sync_status,
        attempt_count = 0,
        next_attempt_at = now(),
        last_error = null,
        claim_id = null,
        started_at = null,
        enqueued_at = now()
    where user_outlook_emails_account_id = ${accountId}`);
  s.commitTransaction();
}

export function registerOutlookParticipantSync(
  config: OutlookParticipantSyncConfig,
  handlers: OutlookParticipantSyncHandlers,
) {
  system.storedProcedure({
    name: "retry_client_email_sync",
    transaction: "caller",
    inputScalars: [{ name: "p_client_id", type: "BigInt" }],
    procedure: (s) => {
      enqueueOutlookParticipantSync(s, {
        participants: sql`
          select distinct participant.address
          from (${config.participants}) participant
          where participant.client_id = p_client_id
        `,
        since: config.defaultSince,
      });
    },
  });

  system.scheduledProc({
    name: "outlook_contact_email_sync_seed",
    schedule: "0 */5 * * * *",
    procedure: (s) => {
      s.startTransaction();
      s.modify(sql`
        delete from db.outlook_contact_email_sync_jobs job
        where not exists (
          select 1
          from (${config.participants}) participant
          where participant.address = job.contact_email
        )
      `);
      s.modify(sql`
        insert into db.outlook_contact_email_sync_jobs (
          user_outlook_emails_account_id,
          contact_email,
          requested_since,
          window_start,
          window_end,
          status,
          enqueued_at,
          next_attempt_at
        )
        select
          account.id,
          participant.address,
          ${config.defaultSince},
          greatest(
            ${config.defaultSince},
            date.add(day, -29, current_date)
          ),
          date.add(day, 1, current_date),
          'pending'::enums.outlook_contact_email_sync_status,
          now(),
          now()
        from db.user_outlook_emails_accounts account
        cross join (
          select distinct participant.address
          from (${config.participants}) participant
        ) participant
        where account.status = 'active'
          and account.credential_id is not null
          and not exists (
            select 1
            from db.outlook_contact_email_sync_jobs existing
            where existing.user_outlook_emails_account_id = account.id
              and existing.contact_email = participant.address
          )
      `);
      s.commitTransaction();
    },
  });

  system.addReactor({
    name: "outlook_contact_email_sync_job",
    query: sql`
      select job.id
      from db.outlook_contact_email_sync_jobs job
      join db.user_outlook_emails_accounts account
        on account.id = job.user_outlook_emails_account_id
      where (
          (
            cast(job.status as string) in ('pending', 'failed')
            and job.attempt_count < 5
          )
          or (
            cast(job.status as string) = 'running'
            and job.attempt_count <= 5
            and (
              job.started_at is null
              or job.started_at <= date.add(hour, -1, now())
            )
          )
        )
        and job.next_attempt_at <= now()
        and account.status = 'active'
        and account.credential_id is not null
      order by job.enqueued_at, job.id
    `,
    recordName: "contact_sync_job",
    maxConcurrent: 1,
    procedure: (s) => {
      s.defRecord(
        "current_contact_sync_job",
        sql`
          select
            job.*,
            job.contact_email as normalized_address,
            account.status as account_status,
            account.credential_id as account_credential_id
          from db.outlook_contact_email_sync_jobs job
          join db.user_outlook_emails_accounts account
            on account.id = job.user_outlook_emails_account_id
          where job.id = contact_sync_job.id
        `,
      );
      s.if(
        sql`current_contact_sync_job.id is not null
          and (
            (
              cast(current_contact_sync_job.status as string) in (
                'pending', 'failed'
              )
              and current_contact_sync_job.attempt_count < 5
            )
            or (
              cast(current_contact_sync_job.status as string) = 'running'
              and current_contact_sync_job.attempt_count <= 5
              and (
                current_contact_sync_job.started_at is null
                or current_contact_sync_job.started_at <=
                  date.add(hour, -1, now())
              )
            )
          )
        `,
        (s) => {
          s.if(
            sql`cast(current_contact_sync_job.account_status as string) != 'active'
              or current_contact_sync_job.account_credential_id is null`,
            (s) => s.return(),
            (s) => {
              s.defScalar(
                "contact_sync_claim_id",
                sql`cast(random.uuid() as string)`,
              );
              s.startTransaction();
              s.modify(sql`
                update db.outlook_contact_email_sync_jobs
                set status = 'running'::enums.outlook_contact_email_sync_status,
                    attempt_count = attempt_count + 1,
                    claim_id = contact_sync_claim_id,
                    started_at = now(),
                    last_error = null
                where id = current_contact_sync_job.id
                  and next_attempt_at <= now()
                  and exists (
                    select 1
                    from db.user_outlook_emails_accounts account
                    where account.id =
                      current_contact_sync_job.user_outlook_emails_account_id
                      and account.status = 'active'
                      and account.credential_id =
                        current_contact_sync_job.account_credential_id
                  )
                  and (
                    (
                      cast(status as string) in ('pending', 'failed')
                      and attempt_count < 5
                    )
                    or (
                      cast(status as string) = 'running'
                      and attempt_count <= 5
                      and (
                        started_at is null
                        or started_at <= date.add(hour, -1, now())
                      )
                    )
                  )
              `);
              s.commitTransaction();
              s.if(
                sql`not exists (
                  select 1
                  from db.outlook_contact_email_sync_jobs
                  where id = current_contact_sync_job.id
                    and status = 'running'::enums.outlook_contact_email_sync_status
                    and claim_id = contact_sync_claim_id
                )`,
                (s) => s.return(),
              );
              s.defScalar("contact_sync_next_page_link", {
                type: "String",
              });
              s.defScalar("contact_sync_page_result_count", {
                type: "BigInt",
              });
              s.try({
                body: (s) => {
                  handlers.syncPage(s, {
                    accountId:
                      sql`current_contact_sync_job.user_outlook_emails_account_id`,
                    credentialId:
                      sql`current_contact_sync_job.account_credential_id`,
                    normalizedAddress:
                      sql`current_contact_sync_job.normalized_address`,
                    windowStart: sql`current_contact_sync_job.window_start`,
                    windowEnd: sql`current_contact_sync_job.window_end`,
                    continuationUrl:
                      sql`current_contact_sync_job.continuation_url`,
                    nextPageLinkScalar: "contact_sync_next_page_link",
                    resultCountScalar: "contact_sync_page_result_count",
                    writeFence: sql`exists (
                      select 1
                      from db.outlook_contact_email_sync_jobs work
                      join db.user_outlook_emails_accounts account
                        on account.id = work.user_outlook_emails_account_id
                      where work.id = current_contact_sync_job.id
                        and work.status =
                          'running'::enums.outlook_contact_email_sync_status
                        and work.claim_id = contact_sync_claim_id
                        and account.status = 'active'
                        and account.credential_id =
                          current_contact_sync_job.account_credential_id
                    )`,
                  });
                  s.if(
                    sql`contact_sync_next_page_link is not null
                      and trim(contact_sync_next_page_link) != ''
                      and current_contact_sync_job.provider_result_count +
                        contact_sync_page_result_count >= 1000`,
                    (s) => {
                      s.startTransaction();
                      s.modify(sql`
                        update db.outlook_contact_email_sync_jobs
                        set status = case
                              when date.diff(
                                day,
                                current_contact_sync_job.window_start,
                                current_contact_sync_job.window_end
                              ) <= 1
                              then 'failed'::
                                enums.outlook_contact_email_sync_status
                              else 'pending'::
                                enums.outlook_contact_email_sync_status
                            end,
                            window_start = case
                              when date.diff(
                                day,
                                current_contact_sync_job.window_start,
                                current_contact_sync_job.window_end
                              ) <= 1
                              then current_contact_sync_job.window_start
                              else date.add(
                                day,
                                greatest(
                                  1,
                                  cast(date.diff(
                                    day,
                                    current_contact_sync_job.window_start,
                                    current_contact_sync_job.window_end
                                  ) / 2 as bigint)
                                ),
                                current_contact_sync_job.window_start
                              )
                            end,
                            continuation_url = null,
                            provider_result_count = 0,
                            attempt_count = case
                              when date.diff(
                                day,
                                current_contact_sync_job.window_start,
                                current_contact_sync_job.window_end
                              ) <= 1
                              then 5
                              else 0
                            end,
                            next_attempt_at = now(),
                            last_error = case
                              when date.diff(
                                day,
                                current_contact_sync_job.window_start,
                                current_contact_sync_job.window_end
                              ) <= 1
                              then 'Outlook returned at least 1000 messages for one contact in one day; choose a later start date.'
                              else null
                            end,
                            claim_id = null,
                            started_at = null
                        where id = current_contact_sync_job.id
                          and status =
                            'running'::enums.outlook_contact_email_sync_status
                          and claim_id = contact_sync_claim_id
                      `);
                      s.commitTransaction();
                      s.return();
                    },
                  );
                  s.startTransaction();
                  s.modify(sql`
                    update db.outlook_contact_email_sync_jobs
                    set
                      status = case
                        when (
                          contact_sync_next_page_link is null
                          or trim(contact_sync_next_page_link) = ''
                        ) and current_contact_sync_job.window_start <=
                          current_contact_sync_job.requested_since then
                          'completed'::enums.outlook_contact_email_sync_status
                        else 'pending'::enums.outlook_contact_email_sync_status
                      end,
                      window_start = case
                        when contact_sync_next_page_link is null
                          or trim(contact_sync_next_page_link) = ''
                        then greatest(
                          current_contact_sync_job.requested_since,
                          date.add(
                            day,
                            -30,
                            current_contact_sync_job.window_start
                          )
                        )
                        else current_contact_sync_job.window_start
                      end,
                      window_end = case
                        when contact_sync_next_page_link is null
                          or trim(contact_sync_next_page_link) = ''
                        then current_contact_sync_job.window_start
                        else current_contact_sync_job.window_end
                      end,
                      attempt_count = 0,
                      next_attempt_at = now(),
                      continuation_url = nullif(
                        trim(contact_sync_next_page_link),
                        ''
                      ),
                      provider_result_count = case
                        when contact_sync_next_page_link is null
                          or trim(contact_sync_next_page_link) = ''
                        then 0
                        else current_contact_sync_job.provider_result_count +
                          contact_sync_page_result_count
                      end,
                      last_error = null,
                      claim_id = null,
                      started_at = null
                    where id = current_contact_sync_job.id
                      and status =
                        'running'::enums.outlook_contact_email_sync_status
                      and claim_id = contact_sync_claim_id
                      and exists (
                        select 1
                        from db.user_outlook_emails_accounts account
                        where account.id =
                          current_contact_sync_job.user_outlook_emails_account_id
                          and account.status = 'active'
                          and account.credential_id =
                            current_contact_sync_job.account_credential_id
                      )
                  `);
                  s.commitTransaction();
                },
                errorName: "contact_sync_error",
                catch: (s) => {
                  s.rollbackIfInTransaction();
                  handlers.markReauthRequired(s, {
                    accountId:
                      sql`current_contact_sync_job.user_outlook_emails_account_id`,
                    credentialId:
                      sql`current_contact_sync_job.account_credential_id`,
                    errorMessage: sql`contact_sync_error.message`,
                  });
                  s.startTransaction();
                  s.modify(sql`
                    update db.outlook_contact_email_sync_jobs
                    set
                      status = 'failed'::enums.outlook_contact_email_sync_status,
                      continuation_url = case
                        when lower(coalesce(contact_sync_error.message, ''))
                          like '%errorexecutesearchstaledata%'
                          then null
                        else continuation_url
                      end,
                      last_error = left(
                        coalesce(contact_sync_error.message, 'Unknown error'),
                        5000
                      ),
                      next_attempt_at = date.add(hour, 1, now()),
                      claim_id = null
                    where id = current_contact_sync_job.id
                      and status =
                        'running'::enums.outlook_contact_email_sync_status
                      and claim_id = contact_sync_claim_id
                  `);
                  s.commitTransaction();
                },
              });
            },
          );
        },
      );
    },
  });
}
