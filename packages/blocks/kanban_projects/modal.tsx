import { Alert } from "components/alert";
import { Button } from "components/button";
import { Chip, ChipDelete } from "components/chip";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { LexicalRichTextDisplay } from "components/lexical/components/lexical_editor";
import { TableRecordSelect } from "components/table_record_select";
import { Typography } from "components/typography";
import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
} from "std/ictx";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { Data } from "std/data";
import { Each, Show, useICtx } from "std/ui";
import { KanbanProjectsBlock } from "./kanban_projects_block";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";

export function KanbanCardModal() {
  const block = system.block(KanbanProjectsBlock);
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  return (
    <ModalDialog
      bindScalar="show_modal"
      sx={{
        width: "90%",
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("modal_refresh_key", 0);
        }}
      >
        <Data
          procedure={(s) => {
            s.defScalar("description_edit_mode", false);
            s.defScalar("new_comment", {
              expr: sql`lexical_rich_text_to_html('')`,
              allowNoRead: true,
            });
            s.defScalar("comment_saving", {
              expr: false,
              allowNoRead: true,
            });
            s.defScalar("modal_error", { type: "String" });
            s.defScalar("edit_card_title", false);

            // Fetch card details
            s.defRecord(
              "selected_card",
              sql`select * from ${currentTable.identWithDb} where id = ${currentRecordId}`,
            );
            s.defScalar("update_card_title", sql`selected_card.title`);
            s.defScalar("error_update_card_title", { type: "String" });

            // Fetch column details
            s.defRecord(
              "selected_card_column",
              sql`select * from ${block.columnTableIdent} where id = selected_card.kanban_column_id`,
            );

            // Fetch assignees if block enabled
            if (block.assignable) {
              s.defTable(
                "selected_card_assignees",
                sql`
                  select
                    sca.id,
                    sca.sys_user_id,
                    su.acronym_virtual as user_acronym,
                    su.display_name_virtual as user_display_name
                  from kanban_card_assignees sca
                  auto join sys_users su
                  where sca.kanban_card_id = selected_card.id
                `,
              );
            }

            // Fetch comments if block enabled
            if (block.comments) {
              s.defTable(
                "selected_card_comments",
                sql`
                  select
                    scc.id,
                    scc.sys_user_id,
                    scc.comment,
                    scc.created_at,
                    su.display_name_virtual as user_display_name
                  from kanban_card_comments scc
                  auto join sys_users su
                  where scc.kanban_card_id = selected_card.id
                  order by scc.created_at desc
                `,
              );
            }
          }}
          watch={[sql`modal_refresh_key`]}
        >
          <div
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "3fr 1fr" },
              gap: 2,
              pb: 2,
            }}
          >
            <div
              sx={{
                gridColumnSpan: { xs: 1, md: 2 },
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div className="ml-8">
                <div className="flex items-center gap-2">
                  <Show when={sql`not edit_card_title`}>
                    <Typography level="h3">
                      {sql`selected_card.title`}
                    </Typography>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      onClick={(s) => {
                        s.setScalar("edit_card_title", true);
                        s.setScalar(
                          "update_card_title",
                          sql`selected_card.title`,
                        );
                      }}
                      aria-label="Edit"
                      icon="Edit"
                    />
                  </Show>
                  <Show when={sql`edit_card_title`}>
                    <div
                      onClickAway={(s) => s.setScalar("edit_card_title", false)}
                      className="flex items-center break-words"
                    >
                      <Input
                        placeholder="Card Title"
                        value={sql`update_card_title`}
                        onInput={(s) =>
                          s.setScalar("update_card_title", sql`target_value`)}
                        onKeyDown={(s) => {
                          s.if(sql`event.key = 'Enter'`, (s) => {
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                s.modify(sql`update kanban_cards
                                    set title = update_card_title
                                    where id = selected_card.id
                                  `);
                                s.commitTransaction();
                                s.increment("modal_refresh_key");
                                triggerRefetch(s);
                                s.setScalar("edit_card_title", false);
                              },
                              catch: (s) => {
                                s.setScalar(
                                  "error_update_card_title",
                                  sql.lit`Failed to update card title`,
                                );
                              },
                            });
                          });
                        }}
                        yolmFocusKey
                        endDecorator={
                          <IconButton
                            size="sm"
                            variant="solid"
                            color="primary"
                            onClick={(s) => {
                              s.tryServer({
                                body: (s) => {
                                  s.startTransaction();
                                  s.modify(sql`update kanban_cards
                                    set title = update_card_title
                                    where id = selected_card.id
                                  `);
                                  s.commitTransaction();
                                  s.increment("modal_refresh_key");
                                  triggerRefetch(s);
                                  s.setScalar("edit_card_title", false);
                                },
                                catch: (s) => {
                                  s.setScalar(
                                    "error_update_card_title",
                                    sql.lit`Failed to update card title`,
                                  );
                                },
                              });
                            }}
                            aria-label="Save"
                            icon="Save"
                          />
                        }
                      />
                    </div>
                  </Show>
                </div>
                <Show when={sql`error_update_card_title != ''`}>
                  <Alert color="danger" size="sm">
                    {sql`error_update_card_title`}
                  </Alert>
                </Show>
                <Typography level="body-sm" className="mt-1">
                  in list{" "}
                  <Typography
                    level="body-sm"
                    component="span"
                    inline
                    className="font-medium underline"
                  >
                    {sql`selected_card_column.name`}
                  </Typography>
                </Typography>
              </div>
              <IconButton
                variant="plain"
                color="neutral"
                onClick={(s) => {
                  s.setScalar("show_modal", false);
                }}
                aria-label="Close"
                icon="Close"
              />
            </div>
            <div className="flex flex-col gap-2">
              {block.assignable && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <Typography level="title-lg" startIcon="Person">
                      Members
                    </Typography>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-6">
                    <Show
                      when={sql`exists(select 1 from selected_card_assignees)`}
                      fallback={
                        <Chip size="sm" variant="soft" color="neutral">
                          No members
                        </Chip>
                      }
                    >
                      <Each
                        table="selected_card_assignees"
                        recordName="assignee_record"
                      >
                        <Chip
                          size="sm"
                          color="neutral"
                          variant="soft"
                          startDecorator={
                            <Typography level="body-sm">
                              {sql`assignee_record.user_acronym`}
                            </Typography>
                          }
                          endDecorator={
                            <ChipDelete
                              variant="plain"
                              color="neutral"
                              aria-label="Remove assignee"
                              onClick={(s) => {
                                s.tryServer({
                                  body: (s) => {
                                    s.startTransaction();
                                    s.modify(
                                      sql`delete from kanban_card_assignees where id = ${sql`assignee_record.id`}`,
                                    );
                                    s.increment("modal_refresh_key");
                                    triggerRefetch(s);
                                    s.commitTransaction();
                                  },
                                  catch: (s) => {
                                    s.setScalar(
                                      "modal_error",
                                      sql.lit`Failed to remove assignee`,
                                    );
                                  },
                                });
                              }}
                            />
                          }
                        >
                          {sql`assignee_record.user_display_name`}
                        </Chip>
                      </Each>
                    </Show>
                    <Data
                      local
                      procedure={(s) =>
                        s.defScalar("show_assignee_select", false)}
                    >
                      <Show when={sql`not show_assignee_select`}>
                        <IconButton
                          size="sm"
                          variant="soft"
                          color="neutral"
                          aria-label="Add member"
                          icon="Add"
                          onClick={(s) =>
                            s.setScalar("show_assignee_select", true)}
                        />
                      </Show>
                      <Show when={sql`show_assignee_select`}>
                        <div sx={{ minWidth: "200px" }}>
                          <TableRecordSelect
                            tableName="sys_users"
                            size="sm"
                            placeholder="Search members..."
                            value={sql`try_cast(null as bigint)`}
                            immediateFocus
                            disableOnClear
                            onSelectValue={(s, value) => {
                              s.returnIf(sql`${value} is null`);
                              s.tryServer({
                                body: (s) => {
                                  s.startTransaction();
                                  s.modify(
                                    sql`insert into kanban_card_assignees (kanban_card_id, sys_user_id)
                                       values (${currentRecordId}, ${value})`,
                                  );
                                  s.increment("modal_refresh_key");
                                  triggerRefetch(s);
                                  s.commitTransaction();
                                  s.setScalar("show_assignee_select", false); // Close select on success
                                },
                                catch: (s) => {
                                  s.setScalar(
                                    "modal_error",
                                    sql.lit`Failed to add assignee`,
                                  );
                                },
                              });
                            }}
                            onBlur={(s) =>
                              s.setScalar("show_assignee_select", false)}
                          />
                        </div>
                      </Show>
                    </Data>
                  </div>
                </>
              )}

              <div className="flex items-center justify-between gap-2">
                <Typography level="title-lg" startIcon="DescriptionOutlined">
                  Description
                </Typography>
                <Show when={sql`not description_edit_mode`}>
                  <Button
                    variant="soft"
                    color="neutral"
                    size="sm"
                    onClick={(s) => {
                      s.setScalar("description_edit_mode", true);
                    }}
                    className="ml-4"
                  >
                    Edit
                  </Button>
                </Show>
              </div>
              <div className="ml-9 mt-2">
                <Show
                  when={sql`selected_card.description is null and not description_edit_mode`}
                >
                  <Typography level="body-sm" sx={{ color: "text-tertiary" }}>
                    No description
                  </Typography>
                </Show>
                <Show when={sql`description_edit_mode`}>
                  <Data
                    local
                    procedure={(s) =>
                      s.defScalar(
                        "description_editor_value",
                        sql`coalesce(selected_card.description, lexical_simple_paragraph(''))`,
                      )}
                  >
                    <RichTextSimpleEditor
                      id={sql.lit`description-editor`}
                      value={sql`description_editor_value`}
                      onChange={(s, value) => {
                        s.setScalar("description_editor_value", value);
                      }}
                      sx={{ minHeight: "100px", mb: 1 }}
                    />
                    <div className="flex gap-2">
                      <Button
                        color="primary"
                        size="sm"
                        onClick={(s) => {
                          s.tryServer({
                            body: (s) => {
                              s.startTransaction();
                              s.modify(sql`update ${currentTable.identWithDb}
                                  set description = description_editor_value
                                  where id = ${currentRecordId}
                                `);
                              s.setScalar("description_edit_mode", false);
                              s.increment("modal_refresh_key");
                              triggerRefetch(s);
                              s.commitTransaction();
                            },
                            catch: (s) => {
                              s.setScalar(
                                "modal_error",
                                sql.lit`Failed to save description`,
                              );
                            },
                          });
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        variant="plain"
                        color="neutral"
                        size="sm"
                        onClick={(s) =>
                          s.setScalar("description_edit_mode", false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Data>
                </Show>
                <Show when={sql`not description_edit_mode`}>
                  <LexicalRichTextDisplay
                    value={sql`selected_card.description`}
                  />
                </Show>
              </div>
            </div>

            {block.comments && (
              <div>
                <div className="flex items-center gap-2">
                  <MaterialIcon icon="ListAlt" className="text-2xl" />
                  <Typography level="title-lg">Activity</Typography>
                </div>
                <div className="ml-9 mt-2">
                  <div className="flex gap-2 mb-4">
                    <MaterialIcon icon="Person" className="mt-2" />
                    <div className="grow">
                      <RichTextSimpleEditor
                        id={sql.lit`new-comment-editor`}
                        value={sql`new_comment`}
                        onChange={(s, value) =>
                          s.setScalar("new_comment", value)}
                        sx={{ minHeight: "60px", mb: 1 }}
                      />
                      <Button
                        size="sm"
                        color="primary"
                        loading={sql`comment_saving`}
                        onClick={(s) => {
                          s.returnIf(sql`comment_saving`);
                          s.setScalar("comment_saving", true);
                          s.tryServer({
                            body: (s) => {
                              s.startTransaction();
                              s.modify(
                                sql`insert into kanban_card_comments (kanban_card_id, sys_user_id, comment)
                                     values (${currentRecordId}, current_user, new_comment)`,
                              );
                              s.setScalar(
                                "new_comment",
                                sql`lexical_simple_paragraph('')`,
                              ); // Clear editor
                              s.increment("modal_refresh_key"); // Refresh comments
                              triggerRefetch(s); // Refresh underlying page/kanban
                              s.commitTransaction();
                            },
                            catch: (s) => {
                              s.setScalar(
                                "modal_error",
                                sql.lit`Failed to save comment`,
                              );
                            },
                            finally: (s) =>
                              s.setScalar("comment_saving", false),
                          });
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <Each
                    table="selected_card_comments"
                    recordName="comment_record"
                  >
                    <div className="flex gap-2 mb-4">
                      <MaterialIcon icon="Person" className="mt-1" />{" "}
                      <div className="grow">
                        <Typography level="body-sm" className="font-medium">
                          {sql`comment_record.user_display_name`}{" "}
                          <Typography
                            component="span"
                            level="body-xs"
                            sx={{ color: "text-tertiary" }}
                          >
                            {sql`format.date(comment_record.created_at, '%b %d')`}
                          </Typography>
                        </Typography>
                        <LexicalRichTextDisplay
                          value={sql`comment_record.comment`}
                        />
                      </div>
                    </div>
                  </Each>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <div>
                <Typography level="title-md" className="mb-2">
                  Actions
                </Typography>
                <div className="flex flex-col gap-2">
                  <DeleteRecordButton
                    startIcon="Delete"
                    variant="soft"
                    color="neutral"
                    size="sm"
                    className="justify-start"
                  >
                    Delete
                  </DeleteRecordButton>
                </div>
              </div>
            </div>
          </div>
          <Show when={sql`modal_error is not null`}>
            <Alert color="danger" size="sm" className="mt-4">
              {sql`modal_error`}
            </Alert>
          </Show>
        </Data>
      </Data>
    </ModalDialog>
  );
}
