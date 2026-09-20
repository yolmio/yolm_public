import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent } from "components/card";
import { Chip } from "components/chip";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { Conditional, Each, Show } from "std/ui";
import { Form } from "std/form";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { ModalDialog } from "components/modal";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import { Data } from "std/data";
import { Snackbar } from "components/snackbar";
export function ApiKeyManager() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("show_new_key", false);
        s.defScalar("refresh_key", 0);
        s.defScalar("error", sql.lit``);
        s.defScalar("show_new_key_dialog", false);
        s.defScalar("last_record_id", { type: "BigUint" });
        s.defScalar("success_message", { type: "String" });
      }}
    >
      <div className="container mx-auto max-w-6xl p-6">
        <div className="mb-8">
          <Typography level="h1">API Keys</Typography>
          <Typography level="body-md" sx={{ color: "text-secondary", mt: 1 }}>
            Manage your API keys for external integrations. Keys are shown only
            once when created.
          </Typography>
        </div>
        <div className="flex justify-end mt-4 mb-4">
          <Button
            onClick={(s) => s.setScalar("show_new_key_dialog", sql`true`)}
          >
            Create New API Key <MaterialIcon icon="Add" />
          </Button>
        </div>

        <ModalDialog
          open={sql`show_new_key_dialog`}
          onClose={(s) => s.setScalar("show_new_key_dialog", sql`false`)}
          maxWidth="xs"
        >
          <Conditional
            when={sql`show_new_key and last_record_id is not null`}
            then={
              <>
                <Alert
                  color="success"
                  variant="soft"
                  sx={{ mb: 4 }}
                  startDecorator={<MaterialIcon icon="Key" />}
                >
                  <Data
                    procedure={(s) => {
                      s.defRecord(
                        "key_info",
                        sql`select key_value from api_keys where id = last_record_id`,
                      );
                    }}
                  >
                    <div>
                      <Typography level="title-md" sx={{ mb: 2 }}>
                        API Key Created Successfully
                      </Typography>
                      <div
                        className="flex items-center gap-2 p-3 rounded"
                        style={{
                          backgroundColor: "var(--palette-background-surface)",
                        }}
                      >
                        <code className="flex-1 font-mono text-sm break-all select-all">
                          {sql`key_info.key_value`}
                        </code>
                        <IconButton
                          size="sm"
                          variant="plain"
                          onClick={(s) => {
                            s.defScalar("decrypted_key", {
                              type: "String",
                            });
                            s.server((s) => {
                              s.setScalar(
                                "decrypted_key",
                                sql`crypto.decrypt(key_info.key_value, 'api_key_encryption')`,
                              );
                            });
                            s.clipboard.writeText(sql`decrypted_key`);
                            s.setScalar(
                              "success_message",
                              sql.lit`API key copied to clipboard`,
                            );
                          }}
                        >
                          <MaterialIcon icon="ContentCopy" />
                        </IconButton>
                      </div>
                    </div>
                  </Data>
                </Alert>
                <div className="flex justify-end gap-3 mt-4">
                  <Button
                    sx={{ mt: 3 }}
                    onClick={(s) => {
                      s.setScalar("show_new_key", sql`false`);
                      s.setScalar("last_record_id", sql.null);
                      s.setScalar("show_new_key_dialog", false);
                      s.increment("refresh_key");
                    }}
                  >
                    Done
                  </Button>
                </div>
              </>
            }
            else={
              <>
                <div className="p-6">
                  <Typography level="title-lg">
                    Create New API Key
                  </Typography>
                  <Form
                    defaultFieldComponent={LabelOnLeftFormField}
                    afterTransactionCommit={(s) => {
                      s.setScalar(
                        "last_record_id",
                        sql`last_record_id(api_keys)`,
                      );
                    }}
                    afterSubmitClientSuccess={(s) => {
                      s.increment("refresh_key");
                      s.setScalar("show_new_key", true);
                    }}
                  >
                    <Form.Insert table="api_keys">
                      <Form.Field field="name" />
                      <Form.ErrorAlert />
                      <div className="flex justify-end gap-3 mt-4">
                        <Form.SubmitButton>
                          Create API Key
                        </Form.SubmitButton>
                      </div>
                    </Form.Insert>
                  </Form>
                </div>
              </>
            }
          />
        </ModalDialog>

        {/* Error alert */}
        <Show when={sql`error != ''`}>
          <Alert color="danger" variant="soft" sx={{ mb: 4 }}>
            {sql`error`}
          </Alert>
        </Show>
        <Card variant="outlined">
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <Typography level="title-lg">Your API Keys</Typography>
              <Data
                watch={[sql`refresh_key`]}
                procedure={(s) => {
                  s.defScalar(
                    "count",
                    sql`(select count(*) from api_keys)`,
                  );
                }}
              >
                <Chip variant="soft" color="neutral" size="sm">
                  {sql`count || ' active key' || case when count != 1 then 's' else '' end`}
                </Chip>
              </Data>
            </div>

            <Data
              watch={[sql`refresh_key`]}
              procedure={(s) => {
                s.defTable(
                  "api_keys_list",
                  sql`select * from db.api_keys order by created_at desc`,
                );
              }}
            >
              <Show
                when={sql`(select count(*) from api_keys_list) = 0`}
              >
                <div className="text-center py-12">
                  <MaterialIcon
                    icon="VpnKey"
                    sx={{ fontSize: 48, color: "text-tertiary", mb: 2 }}
                  />
                  <Typography
                    level="body-md"
                    sx={{ color: "text-secondary" }}
                  >
                    No API keys yet. Create your first key above.
                  </Typography>
                </div>
              </Show>
              <Each table="api_keys_list" recordName="key">
                <div className="flex items-center justify-between p-4 border">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      {sql`key.name`}
                      <Conditional
                        when={sql`key.active`}
                        then={
                          <Chip size="sm" variant="soft" color="success">
                            Active
                          </Chip>
                        }
                        else={
                          <Chip size="sm" variant="soft" color="danger">
                            Deactivated
                          </Chip>
                        }
                      />
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>
                        Created: {sql`key.created_at`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Conditional
                      when={sql`key.active`}
                      then={
                        <>
                          <Button
                            variant="outlined"
                            color="primary"
                            size="sm"
                            startIcon="ContentCopy"
                            onClick={(s) => {
                              s.defScalar("decrypted_key", {
                                type: "String",
                              });
                              s.server((s) => {
                                s.setScalar(
                                  "decrypted_key",
                                  sql`crypto.decrypt(key.key_value, 'api_key_encryption')`,
                                );
                              });
                              s.clipboard.writeText(sql`decrypted_key`);
                              s.setScalar(
                                "success_message",
                                sql.lit`API key copied to clipboard`,
                              );
                            }}
                          >
                            Copy
                          </Button>
                          <Button
                            variant="outlined"
                            color="danger"
                            size="sm"
                            onClick={(s) => {
                              s.tryServer({
                                body: (s) => {
                                  s.startTransaction();
                                  s.modify(sql`
                                    update api_keys
                                    set active = false
                                    where id = key.id
                                  `);
                                  s.commitTransaction();
                                  s.increment("refresh_key");
                                },
                                errorName: "deactivate_error",
                                catch: (s) => {
                                  s.setScalar(
                                    "ui.error",
                                    sql`'Failed to deactivate key: ' || deactivate_error.message`,
                                  );
                                },
                              });
                            }}
                          >
                            Revoke
                          </Button>
                        </>
                      }
                      else={
                        <Button
                          variant="outlined"
                          color="success"
                          size="sm"
                          onClick={(s) => {
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                s.modify(sql`
                                    update api_keys
                                    set active = true
                                    where id = key.id
                                  `);
                                s.commitTransaction();
                                s.increment("refresh_key");
                              },
                              errorName: "activate_error",
                              catch: (s) => {
                                s.setScalar(
                                  "ui.error",
                                  sql`'Failed to activate key: ' || activate_error.message`,
                                );
                              },
                            });
                          }}
                        >
                          Activate
                        </Button>
                      }
                    />
                    <DeleteRecordIconButton
                      table="api_keys"
                      recordId={sql`key.id`}
                      variant="plain"
                      color="danger"
                      aria-label="Delete API Key"
                      afterSubmitClient={(s) => s.increment("refresh_key")}
                    />
                  </div>
                </div>
              </Each>
            </Data>
          </CardContent>
        </Card>
      </div>
      <Show when={sql`success_message is not null`}>
        <Snackbar
          color="success"
          startIcon="CheckCircle"
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          onMount={(s) => {
            s.sleep(10000);
            s.setScalar("success_message", sql.null);
          }}
        >
          {sql`success_message`}
        </Snackbar>
      </Show>
    </Data>
  );
}
