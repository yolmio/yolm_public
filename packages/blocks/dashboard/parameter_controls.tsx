import type { DomStatements } from "std/statements";
import { Data } from "std/data";
import { Each, Show, useUniqueId } from "std/ui";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Input } from "components/input";
import { Select } from "components/select";
import { Button } from "components/button";
import { DateRangeCalendars, DateRangeFilter } from "components/date_range";
import { Sheet } from "components/sheet";
import { QueryCombobox } from "components/query_combobox";
import type { DashboardBlock } from "./index";

export function ParameterControls(
  props: {
    block: DashboardBlock;
    declarations: Sql;
    scalar: string;
    onChange?: (s: DomStatements, values: Sql) => void;
  },
) {
  const inputId = sql.concat(
    useUniqueId(),
    "-",
    sql`input_parameter.value->>'name'`,
  );
  const values = sql.ref(props.scalar);
  const setValues = (s: DomStatements, next: Sql) => {
    s.setScalar(props.scalar, next);
    props.onChange?.(s, next);
  };
  const selected = sql`${values}->(input_parameter.value->>'name')`;
  return (
    <Data
      local
      watch={[props.declarations]}
      procedure={(s) =>
        s.defTable(
          "input_parameters",
          sql`select value from json.array_each(${props.declarations})`,
        )}
    >
      <div className="flex flex-wrap gap-4 items-start mb-5">
        <Each table="input_parameters" recordName="input_parameter">
          <div className="min-w-0 max-w-full space-y-1">
            <label className="block text-sm font-medium" htmlFor={inputId}>
              {sql`input_parameter.value->>'label'`}
            </label>
            <Show when={sql`input_parameter.value->>'type'='date_range'`}>
              <Data
                local
                procedure={(s) => {
                  s.defScalar("range_open", false);
                  s.defScalar("range_start", sql`null::date`);
                  s.defScalar("range_end", sql`null::date`);
                }}
              >
                <Button
                  id={inputId}
                  aria-haspopup="dialog"
                  aria-expanded={sql`range_open`}
                  aria-controls={sql.concat(inputId, "-range")}
                  variant="outlined"
                  color="neutral"
                  onClick={(s) => {
                    s.setScalar(
                      "range_start",
                      sql`try_cast(${selected}->>'start' as date)`,
                    );
                    s.setScalar(
                      "range_end",
                      sql`try_cast(${selected}->>'end' as date)`,
                    );
                    s.setScalar("range_open", true);
                  }}
                >
                  {sql`coalesce(format.date(try_cast(${selected}->>'start' as date),'%b %-d, %Y'),'Start') || ' – ' || coalesce(format.date(try_cast(${selected}->>'end' as date),'%b %-d, %Y'),'End')`}
                </Button>
                <Show when={sql`range_open`}>
                  <Sheet
                    id={sql.concat(inputId, "-range")}
                    role="dialog"
                    aria-label={sql`input_parameter.value->>'label'`}
                    popover="auto"
                    yolmPopoverShowing={sql`range_open`}
                    variant="outlined"
                    floating={{
                      anchorEl: inputId,
                      placement: sql.lit`bottom-start`,
                      strategy: sql.lit`fixed`,
                      offset: { mainAxis: 6, crossAxis: 0 },
                      shift: { mainAxis: true, crossAxis: true },
                      flip: { mainAxis: true, crossAxis: false },
                    }}
                    sx={{
                      width: "min(600px, calc(100vw - 32px))",
                      maxHeight: "calc(100dvh - 32px)",
                      overflow: "auto",
                      m: 0,
                      p: 2,
                      borderRadius: "md",
                      boxShadow: "lg",
                      backgroundColor: "background.surface",
                      zIndex: 1300,
                    }}
                    onKeyDown={(s) =>
                      s.if(sql`event.key='Escape'`, (s) => {
                        s.setScalar("range_open", false);
                        s.event.preventDefault();
                      })}
                    onClickAway={(s) => s.setScalar("range_open", false)}
                    onToggleHide={(s) => s.setScalar("range_open", false)}
                  >
                    <div className="space-y-4">
                      <div sx={{ "& > div": { flexWrap: "wrap", gap: 2 } }}>
                        <DateRangeFilter
                          startDate={sql`range_start`}
                          endDate={sql`range_end`}
                          onStartDateChange={(s, value) =>
                            s.setScalar("range_start", value)}
                          onEndDateChange={(s, value) =>
                            s.setScalar("range_end", value)}
                        />
                      </div>
                      <DateRangeCalendars
                        startDate={sql`range_start`}
                        endDate={sql`range_end`}
                        sx={{ flexWrap: "wrap", justifyContent: "center" }}
                        onStartDateChange={(s, value) =>
                          s.setScalar("range_start", value)}
                        onEndDateChange={(s, value) =>
                          s.setScalar("range_end", value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="plain"
                          onClick={(s) => s.setScalar("range_open", false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          disabled={sql`range_start is null or range_end is null or range_start > range_end`}
                          onClick={(s) => {
                            setValues(
                              s,
                              sql`${values} || json_build_object(input_parameter.value->>'name',json_build_object('start',range_start,'end',range_end))`,
                            );
                            s.setScalar("range_open", false);
                          }}
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  </Sheet>
                </Show>
              </Data>
            </Show>
            <Show
              when={sql`input_parameter.value->>'type' in ('text','number','date')`}
            >
              {(["text", "number", "date"] as const).map((type) => (
                <Show
                  when={sql`input_parameter.value->>'type'=${sql.lit(type)}`}
                >
                  <Input
                    id={inputId}
                    type={type}
                    aria-label={sql`input_parameter.value->>'label'`}
                    value={sql`coalesce(${selected} #>> '{}','')`}
                    onChange={(s) =>
                      setValues(
                        s,
                        sql`${values} || json_build_object(input_parameter.value->>'name',nullif(target_value,''))`,
                      )}
                  />
                </Show>
              ))}
            </Show>
            <Show when={sql`input_parameter.value->>'type'='enum'`}>
              <Data
                local
                procedure={(s) =>
                  s.defTable(
                    "input_options",
                    sql`select value #>> '{}' as label from json.array_each(input_parameter.value->'options')`,
                  )}
              >
                <Select
                  id={inputId}
                  aria-label={sql`input_parameter.value->>'label'`}
                  value={sql`coalesce(${selected} #>> '{}','')`}
                  onChange={(s) =>
                    setValues(
                      s,
                      sql`${values} || json_build_object(input_parameter.value->>'name',nullif(target_value,''))`,
                    )}
                >
                  <Select.Option value="">Choose…</Select.Option>
                  <Each table="input_options" recordName="input_option">
                    <Select.Option value={sql`input_option.label`}>
                      {sql`input_option.label`}
                    </Select.Option>
                  </Each>
                </Select>
              </Data>
            </Show>
            {(props.block.opts.recordSources ?? []).map((source) => (
              <Show
                when={sql`input_parameter.value->>'type'='record' and input_parameter.value->>'source'=${
                  sql.lit(source.name)
                }`}
              >
                <Data
                  watch={[selected]}
                  procedure={(s) => {
                    s.defScalar(
                      "selected_record_label",
                      sql`(select label from (${source.query}) source_record where current_user is not null and coalesce((${source.permission}),false) and id=try_cast(${selected} #>> '{}' as bigint))`,
                    );
                  }}
                >
                  <QueryCombobox
                    id={inputId}
                    className="w-64 max-w-full"
                    placeholder={sql`case when coalesce(try_cast(input_parameter.value->>'optional' as bool),false) then ${
                      sql.lit(`All ${source.label.toLowerCase()}`)
                    } else 'Choose…' end`}
                    initialInputText={sql`selected_record_label`}
                    populateResultTable={(s, query, resultTable) => {
                      s.modify(
                        sql`insert into ${resultTable} (id,label,index) select id,label,row_number() over(order by label,id) - 1 from (${source.query}) source_record where current_user is not null and coalesce((${source.permission}),false) and (coalesce(${query},'')='' or contains(lower(label),lower(${query}))) order by label,id limit 50`,
                      );
                    }}
                    onSelect={(s, result) =>
                      setValues(
                        s,
                        sql`${values} || json_build_object(input_parameter.value->>'name',${result}.id)`,
                      )}
                    onClear={(s) =>
                      setValues(
                        s,
                        sql`${values} || json_build_object(input_parameter.value->>'name',null)`,
                      )}
                    onBlur={() => {}}
                  />
                </Data>
              </Show>
            ))}
          </div>
        </Each>
      </div>
    </Data>
  );
}
