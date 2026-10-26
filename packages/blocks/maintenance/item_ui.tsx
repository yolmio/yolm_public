import { CommentsTimeline } from "blocks/comments";
import { locationPaths } from "blocks/locations/queries";
import { MaintenanceBlock } from "./index";
import { ReportComposer } from "./reporting_ui";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { ImageGallery } from "components/image_gallery";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { MultiSelectDropdown } from "components/multi_select_dropdown";
import { QueryCombobox } from "components/query_combobox";
import { Select } from "components/select";
import { NumericInput } from "components/numeric_input";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { DocumentTitle, Each, type Node, Show, useQueryParams } from "std/ui";

const authorName = (user: Sql) =>
  sql`(select coalesce(person.display_name, person.email, 'Team member')
    from db.sys_users app_user
    left join db.workforce_people person
      on person.id = app_user.workforce_person_id
    where app_user.id = ${user})`;

export function MaintenanceItemsPage(
  props: { defaultAssigneeFilter?: Sql; additionalItems?: Sql } = {},
) {
  const reviewEnabled = system.block(MaintenanceBlock).opts.closeOutReview ??
    false;
  const reviewCase = reviewEnabled
    ? sql`when filter_open = 'review' then 'awaiting_review'`
    : sql``;
  return (
    <Data
      local
      noRefetch
      queryParams={{
        filter_open: {
          default: sql.lit`true`,
          type: { type: "String", maxLength: 10 },
        },
        search_text: {
          default: sql.lit``,
          type: { type: "String", maxLength: 500 },
        },
        filter_location: {
          default: sql.lit``,
          type: { type: "String", maxLength: 40 },
        },
        filter_assignee: {
          default: props.defaultAssigneeFilter ?? sql.lit``,
          type: { type: "String", maxLength: 40 },
        },
        filter_submitter: {
          default: sql.lit``,
          type: { type: "String", maxLength: 40 },
        },
        filter_kind: {
          default: sql.lit``,
          type: { type: "String", maxLength: 30 },
        },
        page: { default: sql`1`, type: "BigInt" },
      }}
    >
      <div className="w-full max-w-5xl px-3 py-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Maintenance items</h1>
          <Button href="/maintenance/report" size="sm" startIcon="Add">
            Report a problem
          </Button>
        </div>
        <Data
          procedure={(s) => {
            s.defTable("filter_locations", locationPaths());
            s.defTable(
              "filter_people",
              sql`select app_user.id,
                coalesce(person.display_name, person.email, 'Team member') as name
                from db.sys_users app_user
                left join db.workforce_people person
                  on person.id = app_user.workforce_person_id
                where not app_user.disabled
                order by name, app_user.id`,
            );
          }}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
            <Input
              placeholder="Search titles or #123..."
              size="sm"
              className="min-w-56 flex-1"
              value={sql`search_text`}
              startDecorator={<MaterialIcon icon="Search" />}
              onInput={(s) => {
                s.setQueryParam("search_text", sql`target_value`);
                s.setQueryParam("page", sql`1`);
              }}
            />
            <QueryCombobox
              size="sm"
              className="w-full sm:w-56"
              placeholder="Location"
              initialInputText={sql`coalesce((select path from filter_locations
                where id = try_cast(filter_location as bigint)), '')`}
              populateResultTable={(s, query, results) =>
                s.modify(sql`insert into ${results}
                  select id, path as label,
                    row_number() over (order by path, id) - 1 as index
                  from filter_locations
                  where ${query} = '' or lower(path) like '%' || lower(${query}) || '%'
                  order by path, id limit 50`)}
              resultTableInferQuery={sql`select id, path as label,
                0 as index from filter_locations`}
              onSelect={(s, result) => {
                s.setQueryParam("filter_location", sql`${result}.id`);
                s.setQueryParam("page", sql`1`);
              }}
              onClear={(s) => {
                s.setQueryParam("filter_location", sql.lit``);
                s.setQueryParam("page", sql`1`);
              }}
              onBlur={() => {}}
            />
            <Select
              size="sm"
              aria-label="Assignee"
              value={sql`filter_assignee`}
              onInput={(s) => {
                s.setQueryParam("filter_assignee", sql`target_value`);
                s.setQueryParam("page", sql`1`);
              }}
              sx={{ minWidth: "145px" }}
            >
              <Select.Option value="all">All assignees</Select.Option>
              <Select.Option value="me">Me</Select.Option>
              <Each table="filter_people" recordName="person">
                <Select.Option value={sql`person.id`}>
                  {sql`person.name`}
                </Select.Option>
              </Each>
            </Select>
            <Select
              size="sm"
              aria-label="Submitted by"
              value={sql`filter_submitter`}
              onInput={(s) => {
                s.setQueryParam("filter_submitter", sql`target_value`);
                s.setQueryParam("page", sql`1`);
              }}
              sx={{ minWidth: "145px" }}
            >
              <Select.Option value="">Submitted by</Select.Option>
              <Select.Option value="me">Me</Select.Option>
              <Each table="filter_people" recordName="submitter">
                <Select.Option value={sql`submitter.id`}>
                  {sql`submitter.name`}
                </Select.Option>
              </Each>
            </Select>
            <Select
              size="sm"
              aria-label="Type"
              value={sql`filter_kind`}
              onInput={(s) => {
                s.setQueryParam("filter_kind", sql`target_value`);
                s.setQueryParam("page", sql`1`);
              }}
              sx={{ minWidth: "115px" }}
            >
              <Select.Option value="">Type</Select.Option>
              <Select.Option value="reported_problem">Report</Select.Option>
              <Select.Option value="preventive_maintenance">
                Scheduled
              </Select.Option>
              {props.additionalItems && (
                <Select.Option value="work_order">Work order</Select.Option>
              )}
            </Select>
          </div>
          <Data
            debounce={{ wait: 300 }}
            watch={[
              sql`filter_open`,
              sql`search_text`,
              sql`filter_location`,
              sql`filter_assignee`,
              sql`filter_submitter`,
              sql`filter_kind`,
              sql`page`,
            ]}
            procedure={(s) => {
              if (props.additionalItems) {
                s.defTable("additional_items", props.additionalItems);
              }
              s.defTable(
                "filtered_items",
                sql`select item.id, item.status
                  from db.maintenance_items item
                  where (filter_kind = '' or cast(item.kind as string) = filter_kind)
                    and (filter_submitter = ''
                      or (filter_submitter = 'me' and item.created_by_user_id = current_user)
                      or item.created_by_user_id = try_cast(filter_submitter as bigint))
                    and (filter_assignee in ('', 'all') or exists(
                      select 1 from db.maintenance_item_assignees assignee
                      where assignee.maintenance_item_id = item.id
                        and assignee.sys_user_id = case
                          when filter_assignee = 'me' then current_user
                          else try_cast(filter_assignee as bigint) end))
                    and (filter_location = '' or exists(
                      select 1 from db.maintenance_item_targets target
                      left join db.equipment equipment
                        on equipment.id = target.equipment_id
                      join filter_locations location
                        on location.id = coalesce(target.location_id, equipment.location_id)
                      where target.maintenance_item_id = item.id
                        and (location.id = try_cast(filter_location as bigint)
                          or strpos(location.ancestor_ids,
                            '|' || filter_location || '|') > 0)))
                    and (trim(search_text) = ''
                      or (left(trim(search_text), 1) = '#'
                        and item.id + 1 = try_cast(substring(trim(search_text), 2) as bigint))
                      or (left(trim(search_text), 1) <> '#'
                        and lower(item.title) like '%' || lower(trim(search_text)) || '%'))`,
              );
              s.defScalar(
                "open_count",
                props.additionalItems
                  ? sql`(select count(*) from filtered_items where status = 'open')
                    + (select count(*) from additional_items where status = 'open')`
                  : sql`(select count(*) from filtered_items where status = 'open')`,
              );
              s.defScalar(
                "review_count",
                reviewEnabled
                  ? sql`(select count(*) from filtered_items where status = 'awaiting_review')`
                  : sql`0`,
              );
              s.defScalar(
                "closed_count",
                props.additionalItems
                  ? sql`(select count(*) from filtered_items where status = 'completed')
                    + (select count(*) from additional_items where status = 'completed')`
                  : sql`(select count(*) from filtered_items where status = 'completed')`,
              );
              const sharedItems =
                sql`select item.id, cast(item.status as string) as status, item.title,
                  item.created_at,
                  (select coalesce(person.display_name, person.email, 'Team member')
                    from db.sys_users app_user
                    left join db.workforce_people person
                      on person.id = app_user.workforce_person_id
                    where app_user.id = item.created_by_user_id) as author_name,
                  (select coalesce(equipment.display_name, location.name)
                    from db.maintenance_item_targets target
                    left join db.equipment equipment
                      on equipment.id = target.equipment_id
                    left join db.locations location
                      on location.id = target.location_id
                    where target.maintenance_item_id = item.id
                    order by target.id limit 1) as target_name,
                  (select count(*) from db.maintenance_item_targets target
                    where target.maintenance_item_id = item.id) as target_count,
                  (select min(target.due_on) from db.maintenance_item_targets target
                    where target.maintenance_item_id = item.id) as due_on,
                  (select string_agg(coalesce(person.display_name, person.email), ', '
                    order by coalesce(person.display_name, person.email))
                    from db.maintenance_item_assignees assignee
                    join db.sys_users app_user on app_user.id = assignee.sys_user_id
                    left join db.workforce_people person
                      on person.id = app_user.workforce_person_id
                    where assignee.maintenance_item_id = item.id) as assignees,
                  (select count(*) from db.comments comment
                    join db.comment_threads thread
                      on thread.id = comment.comment_thread_id
                    where thread.maintenance_item_id = item.id) as comment_count,
                  (select count(*) from db.comment_attachments attachment
                    join db.comments comment on comment.id = attachment.comment_id
                    join db.comment_threads thread
                      on thread.id = comment.comment_thread_id
                    where thread.maintenance_item_id = item.id) as attachment_count,
                  '/maintenance/items/' || cast(item.id as string) as href,
                  '#' || cast(item.id + 1 as string) as reference,
                  case when item.kind = 'preventive_maintenance'
                    then 'Scheduled' else 'Report' end as kind_label
                  from db.maintenance_items item
                  join filtered_items filtered on filtered.id = item.id
                  where item.status = case when filter_open = 'true' then 'open'
${reviewCase}                    else 'completed' end`;
              s.defTable(
                "items",
                sql`with combined as (
                  ${sharedItems}
                  ${
                  props.additionalItems
                    ? sql`union all select * from additional_items
                      where status = case when filter_open = 'true' then 'open'
${reviewCase}                    else 'completed' end`
                    : sql``
                }
                ) select * from combined
                  order by created_at desc, id desc
                  limit 50 offset (greatest(page, 1) - 1) * 50`,
              );
            }}
          >
            <div className="flex items-center gap-4 rounded-t-md border border-divider bg-neutral-50 px-4 py-2">
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0"
                onClick={(s) => {
                  s.setQueryParam("filter_open", sql.lit`true`);
                  s.setQueryParam("page", sql`1`);
                }}
              >
                <MaterialIcon icon="AdjustOutlined" />
                <span
                  className="text-sm font-semibold"
                  dynamicClassNames={[{
                    condition: sql`filter_open <> 'true'`,
                    classNames: "text-secondary",
                  }]}
                >
                  {sql`open_count`} Open
                </span>
              </button>
              {system.block(MaintenanceBlock).opts.closeOutReview && (
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0"
                  onClick={(s) => {
                    s.setQueryParam("filter_open", sql.lit`review`);
                    s.setQueryParam("page", sql`1`);
                  }}
                >
                  <MaterialIcon icon="HourglassTop" />
                  <span
                    className="text-sm font-semibold"
                    dynamicClassNames={[{
                      condition: sql`filter_open <> 'review'`,
                      classNames: "text-secondary",
                    }]}
                  >
                    {sql`review_count`} To review
                  </span>
                </button>
              )}
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0"
                onClick={(s) => {
                  s.setQueryParam("filter_open", sql.lit`false`);
                  s.setQueryParam("page", sql`1`);
                }}
              >
                <MaterialIcon icon="CheckCircle" />
                <span
                  className="text-sm font-semibold"
                  dynamicClassNames={[{
                    condition: sql`filter_open <> 'false'`,
                    classNames: "text-secondary",
                  }]}
                >
                  {sql`closed_count`} Closed
                </span>
              </button>
            </div>
            <Show
              when={sql`exists(select 1 from items)`}
              fallback={
                <div className="rounded-b-md border border-t-0 border-divider py-12 text-center text-secondary">
                  <MaterialIcon icon="CheckCircleOutline" />
                  <p className="mt-2 text-sm">No maintenance items found</p>
                </div>
              }
            >
              <div className="overflow-hidden rounded-b-md border border-t-0 border-divider">
                <Each table="items" recordName="item">
                  <a
                    href={sql`item.href`}
                    className="flex items-start gap-3 border-b border-divider px-4 py-3 text-inherit no-underline transition-colors last:border-b-0 hover:bg-neutral-50"
                  >
                    <div className="pt-0.5">
                      <Show when={sql`item.status = 'open'`}>
                        <MaterialIcon icon="AdjustOutlined" />
                      </Show>
                      {reviewEnabled && (
                        <Show when={sql`item.status = 'awaiting_review'`}>
                          <MaterialIcon icon="HourglassTop" />
                        </Show>
                      )}
                      <Show when={sql`item.status = 'completed'`}>
                        <MaterialIcon icon="CheckCircle" />
                      </Show>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {sql`item.title`}
                        </span>
                        <Chip size="sm" variant="outlined" color="neutral">
                          {sql`item.kind_label`}
                        </Chip>
                      </div>
                      <p className="mt-0.5 text-xs text-secondary">
                        {sql`item.reference || ' opened by ' ||
                          coalesce(item.author_name, 'System')`}
                        <Show when={sql`item.target_name is not null`}>
                          <span>
                            {sql`' · ' || item.target_name || case
                              when item.target_count > 1
                                then ' +' || cast(item.target_count - 1 as string)
                              else '' end`}
                          </span>
                        </Show>
                        <Show when={sql`item.due_on is not null`}>
                          <span>
                            {sql`' · Due ' || format.date(item.due_on, '%b %-d')`}
                          </span>
                        </Show>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-secondary">
                      <Show when={sql`item.comment_count > 0`}>
                        <span className="flex items-center gap-1">
                          <MaterialIcon icon="ChatBubbleOutline" />
                          {sql`item.comment_count`}
                        </span>
                      </Show>
                      <Show when={sql`item.attachment_count > 0`}>
                        <span className="flex items-center gap-1">
                          <MaterialIcon icon="AttachFile" />
                          {sql`item.attachment_count`}
                        </span>
                      </Show>
                      <Show when={sql`item.assignees is not null`}>
                        <span className="hidden max-w-40 truncate sm:block">
                          {sql`item.assignees`}
                        </span>
                      </Show>
                    </div>
                  </a>
                </Each>
              </div>
            </Show>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                disabled={sql`page <= 1`}
                onClick={(s) =>
                  s.setQueryParam("page", sql`greatest(page - 1, 1)`)}
              >
                Previous
              </Button>
              <span className="text-xs text-secondary">
                Page {sql`greatest(page, 1)`}
              </span>
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                disabled={sql`greatest(page, 1) * 50 >= case when filter_open = 'true'
                  then open_count else closed_count end`}
                onClick={(s) =>
                  s.setQueryParam("page", sql`greatest(page, 1) + 1`)}
              >
                Next
              </Button>
            </div>
          </Data>
        </Data>
      </div>
    </Data>
  );
}

function ItemAttachments(props: { commentId: Sql }) {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "item_attachments",
          sql`select attachment.*,
            sum(case when attachment.content_type in
              ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
              then 1 else 0 end)
              over (order by attachment.created_at, attachment.id) - 1
              as image_index
            from db.comment_attachments attachment
            where attachment.comment_id = ${props.commentId}
            order by attachment.created_at, attachment.id`,
        );
      }}
    >
      <ImageGallery
        count={sql`(select count(*) from item_attachments where content_type in
          ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))`}
        getImageSource={(index) =>
          sql`'/api/comment-attachments/' ||
            (select public_id from item_attachments
              where image_index = ${index} limit 1)`}
        alt="Maintenance attachment"
      >
        <div className="mt-2 flex flex-wrap gap-2">
          <Each table="item_attachments" recordName="attachment">
            <Show
              when={sql`attachment.content_type in
                ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`}
            >
              <button
                type="button"
                className="overflow-hidden rounded-lg border border-divider"
                onClick={(s) =>
                  ImageGallery.open(s, sql`attachment.image_index`)}
              >
                <img
                  src={sql`'/api/comment-attachments/' || attachment.public_id`}
                  alt={sql`attachment.name`}
                  className="h-28 w-28 object-cover"
                />
              </button>
            </Show>
            <Show
              when={sql`attachment.content_type in
                ('video/mp4', 'video/webm', 'video/quicktime')`}
            >
              <video
                controls
                playsInline
                src={sql`'/api/comment-attachments/' || attachment.public_id`}
                className="max-h-52 max-w-full rounded-lg"
              />
            </Show>
          </Each>
        </div>
      </ImageGallery>
    </Data>
  );
}

function ItemAssignees(props: { itemId: Sql; canManage: Sql }) {
  const maintenance = system.block(MaintenanceBlock);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("assignee_refresh", 0);
        s.defScalar("selected_maintenance_item_id", props.itemId);
      }}
    >
      <Data
        watch={[sql`assignee_refresh`]}
        procedure={(s) => {
          s.defTable(
            "assignee_options",
            sql`select app_user.id,
              coalesce(person.display_name, person.email, 'User') as name,
              person.email as description,
              exists(select 1 from db.maintenance_item_assignees assignee
                where assignee.maintenance_item_id = selected_maintenance_item_id
                  and assignee.sys_user_id = app_user.id) as is_selected
              from db.sys_users app_user
              left join db.workforce_people person
                on person.id = app_user.workforce_person_id
              where ${maintenance.canAccess(sql`app_user.id`)}
              order by name`,
          );
        }}
      >
        <p className="mb-1 text-xs font-semibold text-secondary">Assignees</p>
        <Show when={sql`not ${props.canManage}`}>
          <p className="text-sm text-secondary">
            {sql`coalesce((select string_agg(name, ', ' order by name)
              from assignee_options where is_selected), 'Unassigned')`}
          </p>
        </Show>
        <Show when={props.canManage}>
          <MultiSelectDropdown
            placeholder="Unassigned"
            searchPlaceholder="Find a person"
            watch={[sql`assignee_refresh`]}
            selectedItemsQuery={sql`(select string_agg(name, ', ' order by name)
            from assignee_options where is_selected)`}
            availableItemsQuery={sql`select * from assignee_options`}
            onToggleItem={() => ({
              onSelected: (s) => {
                s.tryServer({
                  body: (s) => {
                    s.startTransaction();
                    s.callStoredProcedure("maintenance_set_item_assignees", {
                      inputScalars: {
                        p_item_id: sql`selected_maintenance_item_id`,
                        p_user_ids:
                          sql`(select coalesce(json_array_agg(user_id),
                          json_build_array()) from
                          (select sys_user_id as user_id
                            from db.maintenance_item_assignees
                            where maintenance_item_id = selected_maintenance_item_id
                            union select item.id) chosen)`,
                        p_actor_user_id: sql`current_user`,
                      },
                    });
                    s.commitTransaction();
                  },
                  finally: (s) => {
                    s.increment("assignee_refresh");
                    s.refetch();
                  },
                });
              },
              onDeselected: (s) => {
                s.tryServer({
                  body: (s) => {
                    s.startTransaction();
                    s.callStoredProcedure("maintenance_set_item_assignees", {
                      inputScalars: {
                        p_item_id: sql`selected_maintenance_item_id`,
                        p_user_ids:
                          sql`(select coalesce(json_array_agg(sys_user_id),
                          json_build_array()) from
                          db.maintenance_item_assignees
                          where maintenance_item_id = selected_maintenance_item_id
                            and sys_user_id <> item.id)`,
                        p_actor_user_id: sql`current_user`,
                      },
                    });
                    s.commitTransaction();
                  },
                  finally: (s) => {
                    s.increment("assignee_refresh");
                    s.refetch();
                  },
                });
              },
            })}
          />
        </Show>
      </Data>
    </Data>
  );
}

function ItemMediaUpdate(props: { itemId: Sql }) {
  const maintenance = system.block(MaintenanceBlock);
  useQueryParams([{
    name: "draft_client_id",
    type: { type: "String", maxLength: 36 },
  }]);
  return (
    <Data
      local
      noRefetch
      procedure={(s) =>
        s.defScalar("media_update_open", sql`draft_client_id is not null`)}
    >
      <Button
        size="sm"
        variant="plain"
        startIcon="Videocam"
        onClick={(s) => s.setScalar("media_update_open", true)}
      >
        Photo or video
      </Button>
      <ModalDialog
        open={sql`media_update_open`}
        maxWidth="sm"
        onClose={(s) => s.setScalar("media_update_open", false)}
      >
        <div className="p-4">
          <div className="mb-2 flex justify-end">
            <Button
              size="sm"
              variant="plain"
              onClick={(s) => s.setScalar("media_update_open", false)}
            >
              Done
            </Button>
          </div>
          <Show when={sql`media_update_open`}>
            <ReportComposer
              mobile
              issueId={props.itemId}
              options={{
                reportPermission: maintenance.opts.reportPermission,
                managePermission: maintenance.opts.managePermission,
                reportHref: (id) => sql`'/maintenance/items/' || (${id})`,
              }}
            />
          </Show>
        </div>
      </ModalDialog>
    </Data>
  );
}

/** "45 min", "2 h", "1 h 30 min" from whole minutes. */
const durationText = (minutes: Sql) =>
  sql`case when ${minutes} < 60 then ${minutes} || ' min'
    when ${minutes} % 60 = 0 then (${minutes} / 60) || ' h'
    else (${minutes} / 60) || ' h ' || (${minutes} % 60) || ' min' end`;

// A preset chip stores "H:MM" in ui.close_duration; "Other" uses the hours
// and minutes text fields. Nothing chosen means not recorded.
const closeMinutes = sql`case
  when ui.close_custom and (
    (nullif(trim(ui.close_h), '') is not null and try_cast(trim(ui.close_h) as int) is null)
    or (nullif(trim(ui.close_m), '') is not null and try_cast(trim(ui.close_m) as int) is null))
    then -1
  when ui.close_custom then nullif(cast(
    coalesce(try_cast(nullif(trim(ui.close_h), '') as int), 0) * 60
    + coalesce(try_cast(nullif(trim(ui.close_m), '') as int), 0) as int), 0)
  when coalesce(ui.close_duration, '') = '' then cast(null as int)
  else cast(try_cast(split_part(ui.close_duration, ':', 1) as int) * 60
    + try_cast(split_part(ui.close_duration, ':', 2) as int) as int) end`;

const timePresets = [
  ["15 min", "0:15"],
  ["30 min", "0:30"],
  ["1 h", "1:00"],
  ["2 h", "2:00"],
  ["4 h", "4:00"],
] as const;

/** Time spent for a close-out: common durations in one tap, or hours and minutes. */
function TimeSpentPicker() {
  const chip = {
    "&[aria-pressed=true]": {
      borderColor: "primary.500",
      backgroundColor: "primary.50",
      color: "primary.700",
    },
  };
  return (
    <div
      role="group"
      aria-label="Time spent"
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="mr-1 text-xs font-medium text-secondary">
        Time spent
      </span>
      {timePresets.map(([label, value]) => (
        <button
          type="button"
          aria-pressed={sql`not ui.close_custom and ui.close_duration = ${
            sql.lit(value)
          }`}
          className="min-h-8 rounded-full border border-divider bg-surface px-3 text-xs font-medium"
          sx={chip}
          onClick={(s) => {
            s.setScalar("close_custom", sql.false);
            s.setScalar(
              "close_duration",
              sql`case when ui.close_duration = ${
                sql.lit(value)
              } then '' else ${sql.lit(value)} end`,
            );
          }}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={sql`ui.close_custom`}
        className="min-h-8 rounded-full border border-divider bg-surface px-3 text-xs font-medium"
        sx={chip}
        onClick={(s) => {
          s.setScalar("close_custom", sql`not ui.close_custom`);
          s.setScalar("close_duration", sql.lit``);
        }}
      >
        Other
      </button>
      <Show when={sql`ui.close_custom`}>
        <span className="flex items-center gap-1 text-xs text-secondary">
          <NumericInput
            size="sm"
            inputMode="numeric"
            className="w-14"
            aria-label="Hours"
            value={sql`ui.close_h`}
            onChange={(s, value) => s.setScalar("close_h", value)}
          />
          h
          <NumericInput
            size="sm"
            inputMode="numeric"
            className="w-14"
            aria-label="Minutes"
            value={sql`ui.close_m`}
            onChange={(s, value) => s.setScalar("close_m", value)}
          />
          min
        </span>
      </Show>
    </div>
  );
}

export function MaintenanceItemDetailPage(
  props: {
    itemId: Sql;
    back?: { href: Sql; label: string | Sql };
    /** Shown above the steps, e.g. details carried over from another system. */
    beforeSteps?: Node;
    /**
     Replaces the built-in close-out (time chips on the comment box) for
     people who may close the open item; `item` is in scope.
     */
    closeOut?: Node;
    /** Replaces the built-in Approve / Send back for managers reviewing. */
    review?: Node;
  },
) {
  const maintenance = system.block(MaintenanceBlock);
  const fieldCloseOut = maintenance.opts.fieldCloseOut ?? false;
  const closeOutReview = maintenance.opts.closeOutReview ?? false;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "item",
          sql`select item.*, program.instructions,
            program.name as program_name,
            (select min(target.due_on) from db.maintenance_item_targets target
              where target.maintenance_item_id = item.id) as due_on,
            (select count(*) from db.comments comment
              join db.comment_threads thread on thread.id = comment.comment_thread_id
              where thread.maintenance_item_id = item.id) as comment_count,
            exists(select 1 from db.maintenance_item_targets target
              where target.maintenance_item_id = item.id) as has_targets,
            ${maintenance.canManage(sql`current_user`)} as can_manage,
            ${
            fieldCloseOut
              ? maintenance.canClose(sql`item`, sql`current_user`)
              : sql`false`
          } as can_close,
            ${
            fieldCloseOut
              ? sql`(select sum(entry.minutes) from db.maintenance_item_time_entries entry
                  where entry.maintenance_item_id = item.id)`
              : sql`cast(null as bigint)`
          } as time_spent,
            ${authorName(sql`item.created_by_user_id`)} as author_name
            from db.maintenance_items item
            left join db.maintenance_programs program
              on program.id = item.maintenance_program_id
            where item.id = ${props.itemId}`,
        );
        s.defTable(
          "item_steps",
          sql`select trim(value) as step,
              row_number() over (order by ordinal) as step_number
            from string.split(coalesce(item.instructions, ''), chr(10))
            where trim(value) <> '' order by ordinal`,
        );
      }}
    >
      <DocumentTitle>
        {sql`'#' || (item.id + 1) || ' · ' || item.title`}
      </DocumentTitle>
      <Show
        when={sql`item.id is not null`}
        fallback={<p className="p-5">Maintenance item not found.</p>}
      >
        <div className="w-full max-w-6xl px-4 py-5 sm:px-6">
          <Button
            href={props.back?.href ?? "/maintenance/items"}
            backLink
            variant="plain"
            color="neutral"
            size="sm"
            startIcon="ArrowBack"
            className="mb-4"
          >
            {props.back?.label ?? "Maintenance"}
          </Button>
          <header className="mb-5 border-b border-divider pb-4">
            <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
              {sql`item.title`}
              <span className="ml-2 font-normal text-secondary">
                {sql`'#' || (item.id + 1)`}
              </span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-secondary">
              <Show when={sql`item.status = 'open'`}>
                <Chip size="sm" variant="soft" color="success">
                  <MaterialIcon icon="AdjustOutlined" className="text-sm" />
                  Open
                </Chip>
              </Show>
              {closeOutReview && (
                <Show when={sql`item.status = 'awaiting_review'`}>
                  <Chip size="sm" variant="soft" color="warning">
                    <MaterialIcon icon="HourglassTop" className="text-sm" />
                    Waiting for review
                  </Chip>
                </Show>
              )}
              <Show when={sql`item.status = 'completed'`}>
                <Chip size="sm" variant="soft" color="neutral">
                  <MaterialIcon icon="CheckCircle" className="text-sm" />
                  {sql`case when item.kind = 'preventive_maintenance'
                    then 'Completed' else 'Closed' end`}
                </Chip>
              </Show>
              <span>
                {sql`coalesce(item.author_name, 'System') || ' opened this item · ' ||
                  format.date(item.created_at, '%b %-d, %Y · %-I:%M %p')`}
              </span>
              <Show when={sql`item.comment_count > 0`}>
                <span>
                  {sql`cast(item.comment_count as string) || case when item.comment_count = 1 then ' comment' else ' comments' end`}
                </span>
              </Show>
              <Show
                when={sql`item.status <> 'open' and item.time_spent is not null`}
              >
                <span>
                  {sql`'Time spent ' || ${durationText(sql`item.time_spent`)}`}
                </span>
              </Show>
            </div>
          </header>
          <div className="flex flex-col gap-8 lg:flex-row">
            <main className="min-w-0 flex-1">
              {
                /* Local, so the chosen time survives refetches (e.g. after
              "I'll take it"). */
              }
              <Data
                local
                procedure={(s) => {
                  s.defScalar("close_duration", sql.lit``);
                  s.defScalar("close_custom", sql.false);
                  s.defScalar("close_h", sql.lit``);
                  s.defScalar("close_m", sql.lit``);
                }}
              >
                <CommentsTimeline
                  threadId={sql`(select id from db.comment_threads
                  where maintenance_item_id = item.id)`}
                  activityQuery={sql`select activity.*,
                  case when activity.activity_type = 'created'
                    then 0 else 2 end as timeline_order,
                  ${authorName(sql`activity.actor_user_id`)} as actor,
                  ${authorName(sql`activity.related_user_id`)} as related_name
                  from db.maintenance_item_activities activity
                  where activity.maintenance_item_id = item.id`}
                  activityContent={(row) => (
                    <span>
                      {sql`coalesce(${row}.actor, 'System') || ' ' ||
                      case ${row}.activity_type
                        when 'created' then 'created this item'
                        when 'assignee_added' then case
                          when ${row}.related_user_id = ${row}.actor_user_id
                            then 'took this item'
                          else 'assigned ' || coalesce(${row}.related_name, 'a teammate') end
                        when 'assignee_removed' then
                          'removed ' || coalesce(${row}.related_name, 'an assignee')
                        when 'target_linked' then 'linked this report to ' ||
                          coalesce(${row}.new_value, 'a target')
                        when 'target_condition_changed' then
                          'updated equipment condition'
                        when 'status_changed' then
                          case ${row}.new_value
                            when 'awaiting_review' then 'finished the work and sent it for review'
                            when 'completed' then ${
                        closeOutReview
                          ? sql`'approved the work and completed this item'`
                          : sql`'completed this item'`
                      }
                            else 'reopened this item' end
                        when 'returned' then 'sent this back to be finished'
                        else 'updated this item' end`}
                    </span>
                  )}
                  attachments={(id) => <ItemAttachments commentId={id} />}
                  composerActions={
                    <div className="flex flex-wrap items-center gap-2">
                      <ItemMediaUpdate itemId={props.itemId} />
                      {fieldCloseOut && !props.closeOut && (
                        <Show
                          when={sql`item.status = 'open' and item.can_close`}
                        >
                          <TimeSpentPicker />
                        </Show>
                      )}
                    </div>
                  }
                  beforeTimeline={
                    <>
                      {props.beforeSteps}
                      <Show
                        when={sql`item.kind = 'preventive_maintenance' and exists(select 1 from item_steps)`}
                      >
                        <div className="mb-5 rounded-lg border border-divider bg-surface p-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                            Steps
                          </p>
                          <ol className="flex flex-col gap-2">
                            <Each table="item_steps" recordName="item_step">
                              <li className="flex items-start gap-2 text-sm leading-relaxed">
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-secondary">
                                  {sql`item_step.step_number`}
                                </span>
                                <span>{sql`item_step.step`}</span>
                              </li>
                            </Each>
                          </ol>
                        </div>
                      </Show>
                      {props.closeOut && (
                        <Show
                          when={sql`item.status = 'open' and item.can_close`}
                        >
                          {props.closeOut}
                        </Show>
                      )}
                      {props.review && (
                        <Show
                          when={sql`item.status = 'awaiting_review' and item.can_manage`}
                        >
                          {props.review}
                        </Show>
                      )}
                    </>
                  }
                  actions={fieldCloseOut
                    ? [
                      ...(props.closeOut ? [] : [{
                        label: "Close out",
                        primary: true,
                        visible: sql`item.status = 'open' and item.can_close`,
                        action: (s: UiServerStatements) =>
                          s.callStoredProcedure("maintenance_close_item", {
                            inputScalars: {
                              p_item_id: sql`item.id`,
                              p_time_entries:
                                sql`case when ${closeMinutes} is null
                              then '[]'::json
                              else json_build_array(json_build_object(
                                'userId', current_user, 'minutes', ${closeMinutes})) end`,
                              p_actor_user_id: sql`current_user`,
                            },
                          }),
                      }]),
                      ...(closeOutReview && !props.review
                        ? [{
                          label: "Approve",
                          primary: true,
                          visible:
                            sql`item.status = 'awaiting_review' and item.can_manage`,
                          action: (s: UiServerStatements) =>
                            s.callStoredProcedure("maintenance_review_item", {
                              inputScalars: {
                                p_item_id: sql`item.id`,
                                p_approve: sql`true`,
                                p_time_entries: sql`cast(null as json)`,
                                p_actor_user_id: sql`current_user`,
                              },
                            }),
                        }, {
                          label: "Send back",
                          visible:
                            sql`item.status = 'awaiting_review' and item.can_manage`,
                          action: (s: UiServerStatements) =>
                            s.callStoredProcedure("maintenance_review_item", {
                              inputScalars: {
                                p_item_id: sql`item.id`,
                                p_approve: sql`false`,
                                p_time_entries: sql`cast(null as json)`,
                                p_actor_user_id: sql`current_user`,
                              },
                            }),
                        }]
                        : []),
                      {
                        label: "Reopen item",
                        visible:
                          sql`item.status = 'completed' and item.can_manage`,
                        action: (s) =>
                          s.callStoredProcedure("maintenance_set_item_status", {
                            inputScalars: {
                              p_item_id: sql`item.id`,
                              p_status:
                                sql`'open'::enums.maintenance_item_status`,
                              p_actor_user_id: sql`current_user`,
                            },
                          }),
                      },
                    ]
                    : [{
                      label: sql`case when item.status = 'open'
                    then 'Complete item' else 'Reopen item' end`,
                      visible: sql`item.can_manage`,
                      action: (s) =>
                        s.callStoredProcedure("maintenance_set_item_status", {
                          inputScalars: {
                            p_item_id: sql`item.id`,
                            p_status:
                              sql`case when item.status = 'open' then 'completed'
                            else 'open' end::enums.maintenance_item_status`,
                            p_actor_user_id: sql`current_user`,
                          },
                        }),
                    }]}
                />
              </Data>
            </main>
            <aside className="w-full shrink-0 space-y-5 lg:w-64">
              <ItemAssignees
                itemId={props.itemId}
                canManage={sql`item.can_manage`}
              />
              <Data
                procedure={(s) =>
                  s.defTable(
                    "item_targets",
                    sql`select target.id, target.equipment_id, target.location_id,
                      target.due_on, target.condition,
                      equipment.display_name as equipment_name,
                      location.name as location_name
                      from db.maintenance_item_targets target
                      left join db.equipment equipment
                        on equipment.id = target.equipment_id
                      left join db.locations location
                        on location.id = target.location_id
                      where target.maintenance_item_id = item.id
                      order by target.id`,
                  )}
              >
                <p className="mb-2 text-xs font-semibold text-secondary">
                  Equipment and locations
                </p>
                <Each table="item_targets" recordName="target">
                  <div className="mb-2">
                    <a
                      className="text-sm font-medium text-primary-600"
                      href={sql`case when target.equipment_id is not null
                        then '/equipment/' || target.equipment_id
                        else '/locations/' || target.location_id end`}
                    >
                      {sql`coalesce(target.equipment_name, target.location_name)`}
                    </a>
                    <Show when={sql`target.due_on is not null`}>
                      <p className="text-xs text-secondary">
                        {sql`'Due ' || format.date(target.due_on, '%b %-d, %Y')`}
                      </p>
                    </Show>
                    <Show
                      when={sql`item.can_manage and item.status = 'open'
                      and target.equipment_id is not null`}
                    >
                      <Select
                        className="mt-1"
                        size="sm"
                        aria-label="Equipment condition"
                        placeholder="Not specified"
                        value={sql`cast(target.condition as string)`}
                        onChange={(s) => {
                          s.server((s) => {
                            s.startTransaction();
                            s.callStoredProcedure(
                              "maintenance_set_target_condition",
                              {
                                inputScalars: {
                                  p_target_id: sql`target.id`,
                                  p_condition:
                                    sql`try_cast(nullif(target_value, '') as enums.maintenance_target_condition)`,
                                  p_actor_user_id: sql`current_user`,
                                },
                              },
                            );
                            s.commitTransaction();
                          });
                          s.refetch();
                        }}
                      >
                        <Select.Option value="degraded">
                          Running with a problem
                        </Select.Option>
                        <Select.Option value="unavailable">
                          Stopped
                        </Select.Option>
                      </Select>
                    </Show>
                  </div>
                </Each>
              </Data>
              <Show
                when={sql`item.can_manage and item.kind = 'reported_problem'
                and item.status = 'open' and not item.has_targets`}
              >
                <Data
                  local
                  procedure={(s) => {
                    s.defScalar("link_equipment_id", {
                      type: "BigInt",
                      expr: sql`null`,
                    });
                    s.defScalar("link_location_id", {
                      type: "BigInt",
                      expr: sql`null`,
                    });
                  }}
                >
                  <Data
                    watch={[sql`link_equipment_id`, sql`link_location_id`]}
                    procedure={(s) => {
                      s.defScalar(
                        "selected_equipment_name",
                        sql`(select display_name from db.equipment where id = link_equipment_id)`,
                      );
                      s.defScalar(
                        "selected_location_name",
                        sql`(select name from db.locations where id = link_location_id)`,
                      );
                    }}
                  >
                    <div className="mt-5 border-t border-divider pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                        Link this report
                      </p>
                      <p className="mb-2 text-xs text-secondary">Equipment</p>
                      <QueryCombobox
                        placeholder="Search equipment"
                        initialInputText={sql`coalesce(selected_equipment_name, '')`}
                        populateResultTable={(s, query, results) =>
                          s.modify(sql`insert into ${results}
                          select id, display_name as label,
                            row_number() over (order by display_name) - 1 as index
                          from db.equipment
                          where display_name ilike '%' || ${query} || '%'
                          order by display_name limit 40`)}
                        resultTableInferQuery={sql`select cast(null as bigint) as id,
                        cast(null as string) as label, 0 as index where false`}
                        onSelect={(s, result) => {
                          s.setScalar("link_equipment_id", sql`${result}.id`);
                          s.setScalar("link_location_id", sql`null`);
                        }}
                        onClear={(s) =>
                          s.setScalar("link_equipment_id", sql`null`)}
                        onBlur={() => {}}
                      />
                      <p className="mt-3 mb-2 text-xs text-secondary">
                        Or location
                      </p>
                      <QueryCombobox
                        placeholder="Search locations"
                        initialInputText={sql`coalesce(selected_location_name, '')`}
                        populateResultTable={(s, query, results) =>
                          s.modify(sql`insert into ${results}
                          select id, name as label,
                            row_number() over (order by name) - 1 as index
                          from db.locations
                          where name ilike '%' || ${query} || '%'
                          order by name limit 40`)}
                        resultTableInferQuery={sql`select cast(null as bigint) as id,
                        cast(null as string) as label, 0 as index where false`}
                        onSelect={(s, result) => {
                          s.setScalar("link_location_id", sql`${result}.id`);
                          s.setScalar("link_equipment_id", sql`null`);
                        }}
                        onClear={(s) =>
                          s.setScalar("link_location_id", sql`null`)}
                        onBlur={() => {}}
                      />
                      <ActionButton
                        className="mt-3"
                        size="sm"
                        disabled={sql`link_equipment_id is null and link_location_id is null`}
                        errorDisplay="inline"
                        successMessage="Report linked"
                        refetch
                        action={(s) => {
                          s.startTransaction();
                          s.callStoredProcedure(
                            "maintenance_link_general_report",
                            {
                              inputScalars: {
                                p_item_id: sql`item.id`,
                                p_equipment_id: sql`link_equipment_id`,
                                p_location_id: sql`link_location_id`,
                                p_actor_user_id: sql`current_user`,
                              },
                            },
                          );
                          s.commitTransaction();
                        }}
                      >
                        Link report
                      </ActionButton>
                    </div>
                  </Data>
                </Data>
              </Show>
              <Show when={sql`item.maintenance_program_id is not null`}>
                <div>
                  <p className="mb-1 text-xs font-semibold text-secondary">
                    Program
                  </p>
                  <p className="text-sm">{sql`item.program_name`}</p>
                </div>
              </Show>
            </aside>
          </div>
        </div>
      </Show>
    </Data>
  );
}
