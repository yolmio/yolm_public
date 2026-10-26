import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { DataTable } from "components/data_table";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import { ModalDialog } from "components/modal";
import { QueryCombobox } from "components/query_combobox";
import { Select } from "components/select";
import { Snackbar } from "components/snackbar";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import type { TrainingBlockOpts } from "../types.ts";
import {
  audienceMatchesEmployeeSql,
  employeeName,
  personTable,
} from "../helpers";
import { EmptyState, PageShell } from "../shared";
import {
  adminSelectClass,
  AudienceMultiSelect,
  NotificationVariableInsertMenu,
  notificationVariableToken,
  PersonMultiSelect,
} from "./shared";

function notificationRuleEventsSql() {
  return sql`
    values
      ('assignment_created', 'Assignment created', 5),
      ('reminder', 'Reminder after assignment', 10),
      ('overdue', 'Overdue due date', 20)
  `;
}

export function TrainingAdminNotificationsPage(
  props: { block: TrainingBlock },
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_template_open", sql`false`);
        s.defScalar("add_template_name", sql.lit``);
        s.defScalar("add_template_subject", sql.lit``);
        s.defScalar("add_template_portal_body", sql.lit``);
        s.defScalar(
          "add_template_email_body",
          sql`lexical_simple_paragraph('')`,
        );
        s.defScalar("add_template_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("notification_rule_message", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("notification_rule_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("add_notification_event_code", sql.lit``);
        s.defScalar("add_notification_template_id", sql.lit``);
        s.defScalar("nudge_target_type", sql.lit`course`);
        s.defScalar("nudge_course_id", sql.lit``);
        s.defScalar("nudge_course_name", sql.lit``);
        s.defScalar("nudge_document_id", sql.lit``);
        s.defScalar("nudge_document_title", sql.lit``);
        s.defScalar("nudge_recipient_type", sql.lit`all`);
        s.defScalar("nudge_audience_ids", sql.lit``);
        s.defScalar("nudge_person_ids", sql.lit``);
        s.defScalar("nudge_template_id", sql.lit``);
        s.defScalar("nudge_message", sql.lit``);
        s.defScalar("nudge_result_message", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("nudge_error", {
          type: { type: "String", maxLength: 1000 },
        });
      }}
    >
      <PageShell
        title="Training notifications"
        subtitle="The messages people receive about their training, and the events that send them."
      >
        <NotificationTemplatesWorkspace block={props.block} />
      </PageShell>
    </Data>
  );
}

export function NotificationTemplatesWorkspace(
  props: { block: TrainingBlock },
) {
  return (
    <div className="flex flex-col gap-5">
      <Data
        procedure={(s) => {
          s.defTable(
            "notification_events",
            sql`
              select *
              from (${notificationRuleEventsSql()})
                as events(event_code, event_name, sort_order)
              order by sort_order
            `,
          );
          s.defTable(
            "notification_template_options",
            sql`
              select id, name
              from db.training_notification_templates
              where is_active
              order by name
            `,
          );
          s.defTable(
            "notification_rule_rows",
            sql`
              with events(event_code, event_name, sort_order) as (
                ${notificationRuleEventsSql()}
              )
              select r.id as rule_id, e.event_code, e.event_name,
                     r.training_notification_template_id as template_id,
                     t.name as template_name
              from db.training_notification_rules r
              join events e on e.event_code = r.event_code
              join db.training_notification_templates t
                on t.id = r.training_notification_template_id
              where r.is_active
              order by e.sort_order, t.name
            `,
          );
        }}
      >
        <Card variant="outlined">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
              <Typography level="title-lg" startIcon="Article">
                Message templates
              </Typography>
              <Button
                startIcon="AddAlert"
                onClick={(s) => s.setScalar("add_template_open", sql`true`)}
              >
                Add template
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              query={sql`
                select t.id, t.code, t.name,
                       t.email_subject,
                       t.portal_body,
                       case when t.is_active then 'Active' else 'Inactive' end as status
                from db.training_notification_templates t
                order by case when t.is_active then 0 else 1 end, t.name
              `}
              recordName="template"
              pageSize={8}
              searchable={[
                "name",
                "email_subject",
                "portal_body",
                "status",
              ]}
              columns={(b) => {
                b.column(
                  "Template",
                  ({ record }) => (
                    <span className="block min-w-0 whitespace-normal break-words">
                      {sql`${record}.name`}
                    </span>
                  ),
                  { width: "24%", field: "name" },
                );
                b.column(
                  "Preview",
                  ({ record }) => (
                    <span className="block min-w-0 whitespace-normal break-words">
                      {sql`coalesce(nullif(${record}.email_subject, ''), nullif(${record}.portal_body, ''), '-')`}
                    </span>
                  ),
                  { width: "38%", field: "email_subject" },
                );
                b.simpleColumn("status", "Status", { width: "10%" });
              }}
              actions={(b) => {
                b.custom(
                  "Toggle active",
                  { icon: "PublishedWithChanges" },
                  (s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.callStoredProcedure(
                          "training_toggle_notification_template",
                          { inputScalars: { p_template_id: sql`template.id` } },
                        );
                        s.commitTransaction();
                        s.refetch();
                      },
                    });
                  },
                );
              }}
            />
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <Typography level="title-lg" startIcon="Notifications">
              When to send
            </Typography>
          </CardHeader>
          <CardContent>
            <Typography level="body-sm" className="text-neutral-600">
              These rules apply to all training assignments. Each matching
              notification is sent to both the employee portal and email.
            </Typography>
            <Show when={sql`notification_rule_message is not null`}>
              <Snackbar
                color="success"
                variant="soft"
                startIcon="CheckCircle"
                anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
                onMount={(s) => {
                  s.sleep(2000);
                  s.setScalar("notification_rule_message", sql`null`);
                }}
              >
                {sql`notification_rule_message`}
              </Snackbar>
            </Show>
            <Show when={sql`notification_rule_error is not null`}>
              <Alert color="danger" startIcon="Error" className="mt-3">
                {sql`notification_rule_error`}
              </Alert>
            </Show>
            <div className="mt-4 rounded-md border border-divider bg-neutral-50 p-3">
              <Typography level="title-sm">Add rule</Typography>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 mt-3 items-end">
                <FormControl>
                  <FormLabel>Event</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`add_notification_event_code`}
                    onInput={(s) =>
                      s.setScalar(
                        "add_notification_event_code",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">Choose event</Select.Option>
                    <Each table="notification_events" recordName="event">
                      <Select.Option value={sql`event.event_code`}>
                        {sql`event.event_name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Template</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`add_notification_template_id`}
                    onInput={(s) =>
                      s.setScalar(
                        "add_notification_template_id",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">Choose template</Select.Option>
                    <Each
                      table="notification_template_options"
                      recordName="template"
                    >
                      <Select.Option value={sql`template.id`}>
                        {sql`template.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
                <Button
                  startIcon="AddAlert"
                  onClick={(s) => {
                    s.setScalar("notification_rule_error", sql`null`);
                    s.setScalar("notification_rule_message", sql`null`);
                    s.tryServer({
                      body: (s) => {
                        s.if(
                          sql`ui.add_notification_event_code = ''
                            or ui.add_notification_template_id = ''`,
                          (s) => {
                            s.setScalar(
                              "ui.notification_rule_error",
                              sql
                                .lit`Choose an event and template before adding a rule.`,
                            );
                            s.return();
                          },
                        );
                        s.startTransaction();
                        s.callStoredProcedure(
                          "training_save_notification_rule",
                          {
                            inputScalars: {
                              p_event_code: sql`ui.add_notification_event_code`,
                              p_template_id:
                                sql`ui.add_notification_template_id`,
                            },
                          },
                        );
                        s.commitTransaction();
                        s.setScalar(
                          "ui.add_notification_event_code",
                          sql.lit``,
                        );
                        s.setScalar(
                          "ui.add_notification_template_id",
                          sql.lit``,
                        );
                        s.setScalar(
                          "ui.notification_rule_message",
                          sql.lit`Notification rule saved.`,
                        );
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          "notification_rule_error",
                          sql.lit`Notification rule could not be saved.`,
                        );
                      },
                    });
                  }}
                >
                  Save rule
                </Button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Show
                when={sql`not exists (select 1 from notification_rule_rows)`}
              >
                <EmptyState
                  icon="NotificationsOff"
                  title="No global rules"
                  body="Add rules for assignment, reminder, or overdue notifications."
                />
              </Show>
              <Each table="notification_rule_rows" recordName="rule">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-md border border-divider bg-white p-3">
                  <div className="min-w-0">
                    <Typography level="title-sm">
                      {sql`rule.event_name`}
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      {sql`rule.template_name || ' · Portal and email'`}
                    </Typography>
                  </div>
                  <IconButton
                    icon="Delete"
                    aria-label="Remove notification rule"
                    variant="plain"
                    color="danger"
                    onClick={(s) => {
                      s.setScalar("notification_rule_error", sql`null`);
                      s.setScalar("notification_rule_message", sql`null`);
                      s.tryServer({
                        body: (s) => {
                          s.startTransaction();
                          s.modify(sql`
                            delete from db.training_notification_rules
                            where id = rule.rule_id
                          `);
                          s.commitTransaction();
                          s.setScalar(
                            "ui.notification_rule_message",
                            sql.lit`Notification rule removed.`,
                          );
                          s.refetch();
                        },
                        catch: (s) => {
                          s.setScalar(
                            "notification_rule_error",
                            sql.lit`Notification rule could not be removed.`,
                          );
                        },
                      });
                    }}
                  />
                </div>
              </Each>
            </div>
          </CardContent>
        </Card>

        <NudgePanel block={props.block} />

        <ModalDialog bindScalar="add_template_open" maxWidth="lg">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Typography level="title-lg" startIcon="AddAlert">
                Add Notification Template
              </Typography>
              <Typography level="body-sm" className="text-neutral-600 mt-1">
                Templates are global. Portal and email delivery are queued
                together for each notification.
              </Typography>
            </div>
            <IconButton
              icon="Close"
              aria-label="Close"
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("add_template_open", sql`false`)}
            />
          </div>
          <Show when={sql`add_template_error is not null`}>
            <Alert color="danger" startIcon="Error" className="mb-4">
              {sql`add_template_error`}
            </Alert>
          </Show>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormControl>
              <FormLabel>Name</FormLabel>
              <Input bindScalar="add_template_name" />
            </FormControl>
            <FormControl>
              <FormLabel>Email subject</FormLabel>
              <Input
                bindScalar="add_template_subject"
                endDecorator={
                  <NotificationVariableInsertMenu
                    variables={props.block.getNotificationTemplateVariables()}
                    variant="plain"
                    onClick={(s, key) => {
                      s.setScalar(
                        "add_template_subject",
                        sql.concat(
                          sql`add_template_subject`,
                          notificationVariableToken(key),
                        ),
                      );
                    }}
                  />
                }
              />
            </FormControl>
            <FormControl className="md:col-span-2">
              <FormLabel>Portal body</FormLabel>
              <Textarea
                bindScalar="add_template_portal_body"
                minRows={4}
                endDecorator={
                  <NotificationVariableInsertMenu
                    variables={props.block.getNotificationTemplateVariables()}
                    variant="plain"
                    onClick={(s, key) => {
                      s.setScalar(
                        "add_template_portal_body",
                        sql.concat(
                          sql`add_template_portal_body`,
                          notificationVariableToken(key),
                        ),
                      );
                    }}
                  />
                }
              />
            </FormControl>
            <FormControl className="md:col-span-2">
              <FormLabel>Email body</FormLabel>
              <RichTextSimpleEditor
                id={sql.lit`training-email-template-editor`}
                value={sql`add_template_email_body`}
                onChange={(s, value) => {
                  s.setScalar("add_template_email_body", value);
                }}
                showVariables
                variables={props.block.getNotificationTemplateVariables()}
                variableButtonLabel="Variables"
              />
            </FormControl>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("add_template_open", sql`false`)}
            >
              Cancel
            </Button>
            <Button
              startIcon="Save"
              onClick={(s) => {
                s.setScalar("add_template_error", sql`null`);
                s.tryServer({
                  body: (s) => {
                    s.defScalar(
                      "new_template_code",
                      sql`substring(
                        'training_' ||
                          lower(replace(trim(ui.add_template_name), ' ', '_'))
                        from 1 for 120
                      )`,
                    );
                    s.if(
                      sql`trim(ui.add_template_name) = ''
                        or trim(ui.add_template_subject) = ''
                        or trim(ui.add_template_portal_body) = ''`,
                      (s) => {
                        s.setScalar(
                          "ui.add_template_error",
                          sql
                            .lit`Name, email subject, and portal body are required.`,
                        );
                        s.return();
                      },
                    );
                    s.if(
                      sql`exists (
                        select 1
                        from db.training_notification_templates t
                        where t.code = new_template_code
                      )`,
                      (s) => {
                        s.setScalar(
                          "ui.add_template_error",
                          sql
                            .lit`A template with this name already exists. Edit it instead of creating a duplicate.`,
                        );
                        s.return();
                      },
                    );
                    s.startTransaction();
                    s.callStoredProcedure(
                      "training_create_notification_template",
                      {
                        inputScalars: {
                          p_code: sql`new_template_code`,
                          p_name: sql`ui.add_template_name`,
                          p_subject: sql`ui.add_template_subject`,
                          p_email_body: sql`ui.add_template_email_body`,
                          p_portal_body: sql`ui.add_template_portal_body`,
                        },
                      },
                    );
                    s.commitTransaction();
                    s.setScalar("ui.add_template_name", sql.lit``);
                    s.setScalar("ui.add_template_subject", sql.lit``);
                    s.setScalar("ui.add_template_portal_body", sql.lit``);
                    s.setScalar(
                      "ui.add_template_email_body",
                      sql`lexical_simple_paragraph('')`,
                    );
                    s.setScalar("ui.add_template_open", sql`false`);
                    s.refetch();
                  },
                  catch: (s) => {
                    s.setScalar(
                      "add_template_error",
                      sql
                        .lit`Template could not be created. Check for a duplicate code.`,
                    );
                  },
                });
              }}
            >
              Create template
            </Button>
          </div>
        </ModalDialog>
      </Data>
    </div>
  );
}

function NudgePanel(props: { block: TrainingBlock }) {
  return (
    <Card variant="outlined">
      <CardHeader>
        <Typography level="title-lg" startIcon="Campaign">
          Send Nudge
        </Typography>
      </CardHeader>
      <CardContent>
        <Typography level="body-sm" className="text-neutral-600">
          Queue a one-off notification for people with open assignments for a
          selected course, program, or policy document.
        </Typography>
        <Show when={sql`nudge_result_message is not null`}>
          <Alert color="success" startIcon="CheckCircle" className="mt-3">
            {sql`nudge_result_message`}
          </Alert>
        </Show>
        <Show when={sql`nudge_error is not null`}>
          <Alert color="danger" startIcon="Error" className="mt-3">
            {sql`nudge_error`}
          </Alert>
        </Show>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormControl>
            <FormLabel>Training type</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`nudge_target_type`}
              onInput={(s) => {
                s.setScalar("nudge_target_type", sql`target_value`);
                s.setScalar("nudge_course_id", sql.lit``);
                s.setScalar("nudge_course_name", sql.lit``);
                s.setScalar("nudge_document_id", sql.lit``);
                s.setScalar("nudge_document_title", sql.lit``);
              }}
            >
              <Select.Option value="course">Course or program</Select.Option>
              <Select.Option value="document">Policy document</Select.Option>
            </Select>
          </FormControl>
          <Show when={sql`nudge_target_type = 'course'`}>
            <FormControl>
              <FormLabel>Course or program</FormLabel>
              <QueryCombobox
                placeholder="Search courses..."
                clearOnSelect={false}
                initialInputText={sql`nullif(nudge_course_name, '')`}
                populateResultTable={(s, query, resultTable) => {
                  s.modify(sql`
                    insert into ${resultTable}
                      select name as label, rank() over () - 1 as index, id
                      from db.training_courses
                      where is_active
                        and (
                          trim(${query}) = ''
                          or fuzzy_match(${query}, name)
                        )
                      order by
                        case when trim(${query}) = '' then 0 else 1 end,
                        fuzzy_rank_key(${query}, name),
                        name
                      limit 20
                  `);
                }}
                onSelect={(s, result) => {
                  s.setScalar("nudge_course_id", sql`${result}.id`);
                  s.setScalar("nudge_course_name", sql`${result}.label`);
                }}
                onClear={(s) => {
                  s.setScalar("nudge_course_id", sql.lit``);
                  s.setScalar("nudge_course_name", sql.lit``);
                }}
                onBlur={() => {}}
              />
            </FormControl>
          </Show>
          <Show when={sql`nudge_target_type = 'document'`}>
            <FormControl>
              <FormLabel>Policy document</FormLabel>
              <QueryCombobox
                placeholder="Search documents..."
                clearOnSelect={false}
                initialInputText={sql`nullif(nudge_document_title, '')`}
                populateResultTable={(s, query, resultTable) => {
                  s.modify(sql`
                    insert into ${resultTable}
                      select title as label, rank() over () - 1 as index, id
                      from db.training_content_documents document
                      where is_active
                        and ${
                    props.block.opts.content.canReadDocument(
                      sql`document.id`,
                      sql`current_user`,
                    )
                  }
                        and (
                          trim(${query}) = ''
                          or fuzzy_match(${query}, title)
                        )
                      order by
                        case when trim(${query}) = '' then 0 else 1 end,
                        fuzzy_rank_key(${query}, title),
                        title
                      limit 20
                  `);
                }}
                onSelect={(s, result) => {
                  s.setScalar("nudge_document_id", sql`${result}.id`);
                  s.setScalar("nudge_document_title", sql`${result}.label`);
                }}
                onClear={(s) => {
                  s.setScalar("nudge_document_id", sql.lit``);
                  s.setScalar("nudge_document_title", sql.lit``);
                }}
                onBlur={() => {}}
              />
            </FormControl>
          </Show>
          <FormControl>
            <FormLabel>Recipients</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`nudge_recipient_type`}
              onInput={(s) => {
                s.setScalar("nudge_recipient_type", sql`target_value`);
                s.setScalar("nudge_audience_ids", sql.lit``);
                s.setScalar("nudge_person_ids", sql.lit``);
              }}
            >
              <Select.Option value="all">All assigned people</Select.Option>
              <Select.Option value="audience">Dynamic audiences</Select.Option>
              <Select.Option value="people">Specific people</Select.Option>
            </Select>
          </FormControl>
          <Show when={sql`nudge_recipient_type = 'audience'`}>
            <FormControl>
              <FormLabel>Audiences</FormLabel>
              <AudienceMultiSelect
                selectedIdsScalar="nudge_audience_ids"
                placeholder="Choose audiences"
                availableItemsQuery={sql`select id, name, description
                  from db.training_audiences
                  where is_active
                  order by name`}
              />
            </FormControl>
          </Show>
          <Show when={sql`nudge_recipient_type = 'people'`}>
            <FormControl>
              <FormLabel>People</FormLabel>
              <PersonMultiSelect
                block={props.block}
                selectedIdsScalar="nudge_person_ids"
                searchPlaceholder="Search people..."
                availableItemsQuery={sql`
                  select e.id,
                         ${employeeName(props.block.opts, sql`e`)} as name,
                         null as description
                  from db.${sql.ref(personTable(props.block.opts))} e
                  order by name
                `}
              />
            </FormControl>
          </Show>
          <FormControl>
            <FormLabel>Template</FormLabel>
            <Select
              className={adminSelectClass}
              value={sql`nudge_template_id`}
              onInput={(s) =>
                s.setScalar("nudge_template_id", sql`target_value`)}
            >
              <Select.Option value="">Use custom message only</Select.Option>
              <Each
                table="notification_template_options"
                recordName="template"
              >
                <Select.Option value={sql`template.id`}>
                  {sql`template.name`}
                </Select.Option>
              </Each>
            </Select>
          </FormControl>
          <FormControl className="md:col-span-2">
            <FormLabel>Custom message</FormLabel>
            <Textarea
              bindScalar="nudge_message"
              minRows={3}
              placeholder="Optional when a template is selected"
              endDecorator={
                <NotificationVariableInsertMenu
                  variables={props.block.getNotificationTemplateVariables()}
                  variant="plain"
                  onClick={(s, key) => {
                    s.setScalar(
                      "nudge_message",
                      sql.concat(
                        sql`nudge_message`,
                        notificationVariableToken(key),
                      ),
                    );
                  }}
                />
              }
            />
          </FormControl>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            startIcon="Send"
            onClick={(s) => {
              s.setScalar("nudge_result_message", sql`null`);
              s.setScalar("nudge_error", sql`null`);
              s.tryServer({
                body: (s) => {
                  s.if(
                    sql`ui.nudge_target_type = 'course'
                      and ui.nudge_course_id = ''`,
                    (s) => {
                      s.setScalar(
                        "ui.nudge_error",
                        sql
                          .lit`Choose a course or program before sending a nudge.`,
                      );
                      s.return();
                    },
                  );
                  s.if(
                    sql`ui.nudge_target_type = 'document'
                      and ui.nudge_document_id = ''`,
                    (s) => {
                      s.setScalar(
                        "ui.nudge_error",
                        sql
                          .lit`Choose a policy document before sending a nudge.`,
                      );
                      s.return();
                    },
                  );
                  s.if(
                    sql`ui.nudge_template_id = ''
                      and trim(ui.nudge_message) = ''`,
                    (s) => {
                      s.setScalar(
                        "ui.nudge_error",
                        sql.lit`Choose a template or enter a custom message.`,
                      );
                      s.return();
                    },
                  );
                  s.if(
                    sql`ui.nudge_recipient_type = 'audience'
                      and nullif(ui.nudge_audience_ids, '') is null`,
                    (s) => {
                      s.setScalar(
                        "ui.nudge_error",
                        sql
                          .lit`Choose at least one audience before sending a nudge.`,
                      );
                      s.return();
                    },
                  );
                  s.if(
                    sql`ui.nudge_recipient_type = 'people'
                      and nullif(ui.nudge_person_ids, '') is null`,
                    (s) => {
                      s.setScalar(
                        "ui.nudge_error",
                        sql
                          .lit`Choose at least one person before sending a nudge.`,
                      );
                      s.return();
                    },
                  );
                  s.callStoredProcedure("training_nudge_assignments", {
                    inputScalars: {
                      p_target_type: sql`ui.nudge_target_type`,
                      p_course_id: sql`ui.nudge_course_id`,
                      p_document_id: sql`ui.nudge_document_id`,
                      p_recipient_type: sql`ui.nudge_recipient_type`,
                      p_person_ids: sql`ui.nudge_person_ids`,
                      p_audience_ids: sql`ui.nudge_audience_ids`,
                    },
                    outputTables: { nudge_assignments: "nudge_assignments" },
                  });
                  s.defScalar(
                    "nudge_assignment_count",
                    sql`(select count(*) from nudge_assignments)`,
                  );
                  s.if(sql`nudge_assignment_count = 0`, (s) => {
                    s.setScalar(
                      "ui.nudge_error",
                      sql.lit`No open assignments matched this nudge.`,
                    );
                    s.return();
                  });
                  s.startTransaction();
                  props.block.publishNudgeNotifications(s, {
                    assignmentsQuery:
                      sql`select assignment_id from nudge_assignments`,
                    message: sql`nullif(trim(ui.nudge_message), '')`,
                    templateId: sql`case
                      when trim(ui.nudge_message) = ''
                        then nullif(ui.nudge_template_id, '')::bigint
                      else null
                    end`,
                  });
                  s.commitTransaction();
                  s.setScalar("ui.nudge_message", sql.lit``);
                  s.setScalar("ui.nudge_template_id", sql.lit``);
                  s.setScalar("ui.nudge_audience_ids", sql.lit``);
                  s.setScalar("ui.nudge_person_ids", sql.lit``);
                  s.setScalar(
                    "ui.nudge_result_message",
                    sql`'Queued nudges for ' || nudge_assignment_count::string || ' assignment(s).'`,
                  );
                  s.refetch();
                },
                catch: (s) => {
                  s.setScalar(
                    "nudge_error",
                    sql.lit`Nudge notifications could not be queued.`,
                  );
                },
              });
            }}
          >
            Send nudge
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Notification page db work (the nudge recipient query matches audiences per
 * person). Every route that renders the page compiles its click handlers, so
 * these stored procedures keep the SQL out of every route.
 */
export function registerNotificationStoredProcedures(opts: TrainingBlockOpts) {
  system.storedProcedure({
    name: "training_toggle_notification_template",
    transaction: "caller",
    inputScalars: [{ name: "p_template_id", type: "BigInt" }],
    procedure: (s) => {
      s.modify(sql`
        update db.training_notification_templates
        set is_active = not is_active
        where id = p_template_id
      `);
    },
  });
  system.storedProcedure({
    name: "training_save_notification_rule",
    transaction: "caller",
    inputScalars: [
      { name: "p_event_code", type: "String" },
      { name: "p_template_id", type: "String" },
    ],
    procedure: (s) => {
      s.modify(sql`
        delete from db.training_notification_rules
        where event_code = p_event_code
      `);
      s.modify(sql`
        insert into db.training_notification_rules
          (event_code, training_notification_template_id)
        values
          (p_event_code,
           p_template_id::bigint)
      `);
    },
  });
  system.storedProcedure({
    name: "training_create_notification_template",
    transaction: "caller",
    inputScalars: [
      { name: "p_code", type: "String" },
      { name: "p_name", type: "String" },
      { name: "p_subject", type: "String" },
      { name: "p_email_body", type: "Json" },
      { name: "p_portal_body", type: "String" },
    ],
    procedure: (s) => {
      s.modify(sql`
        insert into db.training_notification_templates
          (code, name, email_subject, email_body, portal_body)
        values
          (p_code,
           trim(p_name),
           nullif(trim(p_subject), ''),
           p_email_body,
           trim(p_portal_body))
      `);
    },
  });
  system.storedProcedure({
    name: "training_nudge_assignments",
    transaction: "caller",
    inputScalars: [
      { name: "p_target_type", type: "String" },
      { name: "p_course_id", type: "String" },
      { name: "p_document_id", type: "String" },
      { name: "p_recipient_type", type: "String" },
      { name: "p_person_ids", type: "String" },
      { name: "p_audience_ids", type: "String" },
    ],
    outputTables: [
      {
        name: "nudge_assignments",
        fields: [
          { name: "assignment_id", type: "BigInt", notNull: true },
          { name: "person_id", type: "BigInt", notNull: true },
        ],
      },
    ],
    procedure: (s) => {
      s.modify(sql`
        insert into nudge_assignments (assignment_id, person_id)
                      select a.id as assignment_id, a.person_id
                      from db.training_assignments a
                      join db.${sql.ref(personTable(opts))} person
                        on person.id = a.person_id
                      where (
                          (
                            p_target_type = 'course'
                            and a.training_course_id =
                              nullif(p_course_id, '')::bigint
                          )
                          or (
                            p_target_type = 'document'
                            and a.document_id =
                              nullif(p_document_id, '')::bigint
                          )
                        )
                        and a.status in ('pending', 'in_progress')
                        and (a.training_course_id is not null or exists (
                          select 1 from db.training_employee_tasks task
                          where task.training_assignment_id = a.id
                            and task.status in ('assigned', 'in_progress')
                        ))
                        and (
                          p_recipient_type = 'all'
                          or (
                            p_recipient_type = 'people'
                            and exists (
                              select 1
                              from string.split(p_person_ids, ',') selected
                              where selected.value != ''
                                and person.id = selected.value::bigint
                            )
                          )
                          or (
                            p_recipient_type = 'audience'
                            and exists (
                            select 1
                            from string.split(p_audience_ids, ',') selected
                            join db.training_audiences audience
                              on audience.id = selected.value::bigint
                             and audience.is_active
                            where selected.value != ''
                              and ${
        audienceMatchesEmployeeSql(
          opts,
          sql`audience`,
          sql`person`,
        )
      }
                            )
                          )
                        )
      `);
    },
  });
}
