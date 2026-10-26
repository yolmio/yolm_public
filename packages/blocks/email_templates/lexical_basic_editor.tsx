import { assertEmailTemplateEditable } from "./editing";
import { FormFieldWithVariables } from "./variable_menu";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { EmailTemplatesBlock } from "./index";
import { sql } from "../../std/sql_utils";
import type { NumericExpr } from "../../std/sql_utils";
import { flexGrowStyles } from "std/style_utils";
import { useBlockOptional } from "std/system";
import { Show, useOptionalICtx } from "std/ui";
import { SidebarPresenceICtxKey } from "std/ictx";
import { Sidebar } from "components/sidebar";
import { Data } from "std/data";
import { Form, useFieldHelper } from "std/form";
import { LexicalBasicEmailEditor } from "components/lexical/components/lexical_editor";

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
          assertEmailTemplateEditable(
            s,
            sql`coalesce(${props.recordId}::bigint, saved_template_id)`,
          );
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
                <Form.ErrorAlert mode="all" />
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
                    <FormFieldWithVariables>
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

  const variables = useBlockOptional(EmailTemplatesBlock)
    ?.getRecipientVariables() ?? {};

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
