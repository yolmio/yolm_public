import { Button } from "components/button";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Select } from "components/select";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { EmployeeTrainingCoursePage } from "../employee_portal_routes";
import type { TrainingBlock } from "../index.tsx";
import { adminCourseHref } from "./shared";

export function TrainingAdminCoursePreview(props: { block: TrainingBlock }) {
  return (
    <Data
      queryParams={{
        content_language: {
          default: sql.lit(props.block.opts.content.opts.defaultLanguage),
          type: "String",
        },
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("training_assignment_id", { type: "BigInt" });
          s.defScalar("preview_restart", 0);
          s.defScalar(
            "preview_language",
            sql`content_language`,
          );
        }}
      >
        <EmployeeTrainingCoursePage
          block={props.block}
          previewCourseId={sql`ui.course_id`}
          backHref={sql`${
            adminCourseHref(props.block, sql`ui.course_id`)
          } || '?content_language=' || preview_language`}
          backLabel="Back to editor"
          previewActions={
            <div className="flex flex-wrap items-end gap-3">
              <FormControl>
                <FormLabel>Preview language</FormLabel>
                <Select
                  aria-label="Preview language"
                  value={sql`preview_language`}
                  onInput={(s) =>
                    s.setScalar("preview_language", sql`target_value`)}
                >
                  {props.block.opts.content.opts.languages.map((language) => (
                    <Select.Option value={language.code}>
                      {language.name}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                startIcon="Replay"
                onClick={(s) => s.increment("preview_restart")}
              >
                Restart preview
              </Button>
            </div>
          }
        />
      </Data>
    </Data>
  );
}
