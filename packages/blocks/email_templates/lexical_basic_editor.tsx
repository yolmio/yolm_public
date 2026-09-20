import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { Menu } from "components/menu";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { EmailTemplatesBlock } from "./index";
import { sql } from "../../std/sql_utils";
import type { NumericExpr } from "../../std/sql_utils";
import type { DomStatements } from "std/statements";
import { flexGrowStyles } from "std/style_utils";
import { useBlockOptional } from "std/system";
import type { Node } from "std/ui";
import { Show, useOptionalICtx, usePhase } from "std/ui";
import { SidebarPresenceICtxKey } from "std/ictx";
import { Sidebar } from "components/sidebar";
import { Data } from "std/data";
import { Form, useFieldHelper } from "std/form";
import type { Color } from "components/types";
import { LexicalBasicEmailEditor } from "components/lexical/components/lexical_editor";

// Component to wrap form fields with variable insertion capability
function FormFieldWithVariables(props: {
  children: Node;
  fieldName: string;
}) {
  if (usePhase() === "gather") {
    return props.children;
  }

  const fieldHelper = useFieldHelper();

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1">{props.children}</div>
      <VariableInsertMenu
        onClick={(s, key) => {
          const currentValue = fieldHelper.value || sql.lit``;
          s.if(sql`${currentValue} = '' or ${currentValue} is null`, (s) => {
            fieldHelper.setValue(s, sql.lit`{{${key}}}`);
          }).else((s) => {
            fieldHelper.setValue(
              s,
              sql.concat(currentValue, sql.lit` {{${key}}}`),
            );
          });
        }}
      />
    </div>
  );
}

// Component to insert variables into email templates
function VariableInsertMenu(props: {
  onClick?: (s: DomStatements, key: string) => void;
  variableType?: "recipient" | "link";
}) {
  let variables: Record<string, string> = {};

  try {
    const explicitVariables = props.variableType === "link"
      ? useBlockOptional(EmailTemplatesBlock)?.getLinkVariables()
      : useBlockOptional(EmailTemplatesBlock)?.getRecipientVariables();
    variables = explicitVariables ?? {};

    return (
      <Menu>
        <Menu.IconButton
          variant="outlined"
          color={"neutral" as Color}
          size="sm"
          aria-controls="email-variables-menu"
          aria-haspopup="true"
          icon="Code"
        />
        <Menu.Content className="max-h-[200px] overflow-auto">
          {Object.entries(variables).map(([key, description]) => (
            <Menu.Item
              onClick={(s) => {
                if (props.onClick) {
                  props.onClick(s, key);
                }
              }}
            >
              {sql.concat(
                sql.lit`{{${key}}} - `,
                sql.lit(description || key),
              )}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu>
    );
  } catch (_error) {
    // If variable lookup fails, show a basic set of variables.
    const defaultVariables = {
      email: "Recipient email address",
      name: "Recipient name",
    };

    return (
      <Menu>
        <Menu.IconButton
          variant="outlined"
          color={"neutral" as Color}
          size="sm"
          aria-controls="email-variables-menu"
          aria-haspopup="true"
          icon="Code"
        />
        <Menu.Content className="max-h-[200px] overflow-auto">
          {Object.entries(defaultVariables).map(([key, description]) => (
            <Menu.Item
              onClick={(s) => {
                if (props.onClick) {
                  props.onClick(s, key);
                }
              }}
            >
              {sql.concat(
                sql.lit`{{${key}}} - `,
                sql.lit(description),
              )}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu>
    );
  }
}

interface BasicEmailEditorProps {
  recordId: NumericExpr;
}

export function BasicEmailEditorLexical(props: BasicEmailEditorProps) {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("saved_template_id", {
          type: "BigUint",
        });
        s.defScalar("saved", false);
      }}
    >
      <Form
        defaultFieldComponent={LabelOnTopFormField}
        keepHistory
        beforeTransactionCommit={(s) => {
          s.setScalar(
            "saved_template_id",
            sql`coalesce(${props.recordId}, last_record_id(db.email_templates))`,
          );
          s.setScalar("saved", true);
        }}
        afterTransactionCommit={(s, ctx) => {
          s.if(sql`${props.recordId} is null`, (s) => {
            ctx.reset(s);
          });
        }}
      >
        <Form.Merge
          table="email_templates"
          where={sql`id = coalesce(${props.recordId}::bigint, saved_template_id)`}
          values={{
            type: sql.lit`basic`,
          }}
        >
          <div
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              p: 6,
              maxWidth: "1500px",
              mx: "auto",
            }}
          >
            <div className="w-full flex flex-col gap-6">
              <div
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  pb: 1,
                }}
              >
                {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
                <Typography level="h3">Email Template</Typography>
                <div sx={flexGrowStyles} />
                <Form.SubmitButton
                  startIcon="Save"
                  variant="solid"
                  color="primary"
                >
                  Save Changes
                </Form.SubmitButton>
              </div>

              <div className="flex flex-col gap-2">
                <Typography level="title-lg">Email Settings</Typography>
                <div
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 2,
                  }}
                >
                  <Form.Field field="name">
                    <LabelOnTopFormField label="Template Name" size="lg" />
                  </Form.Field>
                  <Form.Field field="subject">
                    <FormFieldWithVariables fieldName="subject">
                      <LabelOnTopFormField label="Subject Line" size="lg" />
                    </FormFieldWithVariables>
                  </Form.Field>
                </div>
                <Form.Field field="preview_text">
                  <LabelOnTopFormField
                    label="Preview Text"
                    size="lg"
                    placeholder="This text appears in email clients as a preview"
                  />
                </Form.Field>
              </div>

              <div className="flex flex-col gap-4">
                <Typography level="title-lg">Email Content</Typography>
                <Form.Field field="body">
                  <LexicalEditorField />
                </Form.Field>
              </div>
            </div>
          </div>

          <Show when={sql`saved`}>
            <Snackbar
              startIcon="CheckCircle"
              color="success"
              variant="soft"
              anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
              onMount={(s) => {
                s.sleep(3500);
                s.setScalar("saved", false);
              }}
            >
              Template Saved!
            </Snackbar>
          </Show>
        </Form.Merge>
      </Form>
    </Data>
  );
}

// Wrapper component for the Lexical editor field that integrates with Form.Field
function LexicalEditorField() {
  const fieldHelper = useFieldHelper();

  // Get variables from the email template block if available.
  let variables: Record<string, string> = {
    email: "Recipient email address",
    name: "Recipient name",
  };

  try {
    const explicitVariables = useBlockOptional(EmailTemplatesBlock)
      ?.getRecipientVariables();
    variables = explicitVariables ?? variables;
  } catch (_error) {
    // Use default variables
  }

  return (
    <LexicalBasicEmailEditor
      value={fieldHelper.value}
      onChangeDebounceMs={0}
      onChange={(s, content) => {
        fieldHelper.setValue(s, content);
      }}
      showVariables
      variables={variables}
    />
  );
}
