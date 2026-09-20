import { Button } from "components/button";
import { MaterialIcon } from "components/material_icon";
import { PageHeader } from "components/page_header";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { Route, useSharedContext } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { SidebarItemsSharedContext } from "std/shared_contexts";
import { CrmBlock } from "../index";
import { PipelineBoard } from "./board";
import { PipelineItemDetailPage } from "./item_detail";
import { PipelineOverviewReport, PipelineTasksReport } from "./reports";
import { toDisplayName } from "../helpers";

interface PipelinePagesProps {
  basePath?: string;
  boardHeader?: (pipelineName: string) => Node;
  renderCardContents?: (itemRecord: string) => Node;
}

/**
 * Helper component that provides all the routes needed for pipeline management.
 *
 * Provides:
 * - /pipelines - Pipeline selection/dashboard
 * - /pipelines/{pipeline-name} - Pipeline board view
 * - /pipelines/{pipeline-name}/items/{id} - Pipeline item detail
 * - /pipelines/{pipeline-name}/reports - Pipeline reports
 *
 * @example
 * ```tsx
 * <AppRoutes>
 *   <CrmBlock.Pages />
 *   // ... other routes
 * </AppRoutes>
 * ```
 */
export function PipelinePages(props: PipelinePagesProps) {
  const block = system.block(CrmBlock);
  const basePath = props.basePath ?? "/pipelines";

  useSharedContext(SidebarItemsSharedContext).add({
    section: "Pipeline",
    icon: "ViewKanban",
    order: 10,
    items: block.pipelines.map((p) => ({
      label: p.displayName ?? toDisplayName(p.name),
      href: `${basePath}/${p.name}`,
      icon: p.icon ?? "ViewKanban",
    })),
  });

  return (
    <>
      <Route path={basePath}>
        <PipelineDashboard basePath={basePath} />
      </Route>

      {block.pipelines.map((pipeline) => (
        <>
          <Route path={`${basePath}/${pipeline.name}`}>
            <div className="h-full overflow-y-auto">
              <PageHeader className="bg-surface">
                <div className="flex items-center gap-2">
                  {pipeline.icon && (
                    <MaterialIcon
                      icon={pipeline.icon}
                      className="text-2xl text-primary-500"
                    />
                  )}
                  <div>
                    <Typography level="h4">
                      {pipeline.displayName ?? toDisplayName(pipeline.name)}
                    </Typography>
                    {pipeline.description && (
                      <Typography level="body-sm" className="text-tertiary">
                        {pipeline.description}
                      </Typography>
                    )}
                  </div>
                </div>
                <PageHeader.Grow />
                <Button
                  variant="outlined"
                  color="neutral"
                  size="sm"
                  href={`${basePath}/${pipeline.name}/reports`}
                  startIcon="Assessment"
                >
                  Reports
                </Button>
              </PageHeader>
              <PipelineBoard
                pipelineName={pipeline.name}
                header={props.boardHeader?.(pipeline.name)}
                renderCardContents={props.renderCardContents}
                onItemClick={(s, itemId) => {
                  s.navigate(
                    sql.concat(
                      sql.lit`${basePath}/${pipeline.name}/items/`,
                      itemId,
                    ),
                  );
                }}
              />
            </div>
          </Route>

          <PipelineItemDetailPage
            pipelineName={pipeline.name}
            path={`${basePath}/${pipeline.name}/items/{record_id:id}`}
          />

          <Route path={`${basePath}/${pipeline.name}/reports`}>
            <div className="container mx-auto p-6 max-w-6xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  {pipeline.icon && (
                    <MaterialIcon
                      icon={pipeline.icon}
                      className="text-2xl text-primary-500"
                    />
                  )}
                  <Typography level="h4">
                    {pipeline.displayName ?? toDisplayName(pipeline.name)}{" "}
                    Reports
                  </Typography>
                </div>
                <Button
                  variant="outlined"
                  color="neutral"
                  size="sm"
                  href={`${basePath}/${pipeline.name}`}
                  startIcon="ArrowBack"
                >
                  Back to Board
                </Button>
              </div>
              <div className="space-y-6">
                <PipelineOverviewReport pipelineName={pipeline.name} />
                <PipelineTasksReport pipelineName={pipeline.name} />
              </div>
            </div>
          </Route>
        </>
      ))}
    </>
  );
}

interface PipelineDashboardProps {
  basePath: string;
}

function PipelineDashboard(props: PipelineDashboardProps) {
  const block = system.block(CrmBlock);
  const itemsTable = block.pipelineItemsTableName;

  return (
    <Data
      procedure={(s) => {
        block.pipelines.forEach((pipeline) => {
          s.defScalar(
            `${pipeline.name}_count`,
            sql`(select count(*) from db.${
              sql.ref(itemsTable)
            } where pipeline_name = ${sql.lit(pipeline.name)})`,
          );
        });
      }}
    >
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="flex items-center gap-2 mb-6">
          <MaterialIcon
            icon="ViewKanban"
            className="text-2xl text-primary-500"
          />
          <Typography level="h3">Pipelines</Typography>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {block.pipelines.map((pipeline) => (
            <a
              href={`${props.basePath}/${pipeline.name}`}
              className="block p-6 bg-surface rounded-xl border border-divider hover:border-primary-300 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-3 mb-4">
                {pipeline.icon && (
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor: pipeline.stages[0]?.color
                        ? `${pipeline.stages[0].color}20`
                        : "#3B82F620",
                    }}
                  >
                    <MaterialIcon
                      icon={pipeline.icon}
                      style={{ color: pipeline.stages[0]?.color ?? "#3B82F6" }}
                    />
                  </div>
                )}
                <div>
                  <Typography level="title-md">
                    {pipeline.displayName ?? toDisplayName(pipeline.name)}
                  </Typography>
                  {pipeline.description && (
                    <Typography level="body-xs" className="text-tertiary mt-1">
                      {pipeline.description}
                    </Typography>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 mb-4">
                {pipeline.stages.slice(0, 4).map((stage, i) => (
                  <>
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: stage.color ?? "#6B7280" }}
                    />
                    {i < Math.min(pipeline.stages.length - 1, 3) && (
                      <div className="w-4 h-0.5 bg-neutral-200" />
                    )}
                  </>
                ))}
                {pipeline.stages.length > 4 && (
                  <Typography level="body-xs" className="text-tertiary ml-1">
                    +{pipeline.stages.length - 4} more
                  </Typography>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-tertiary">
                <span>
                  {sql`${sql.ref(pipeline.name + "_count")}`} items
                </span>
                <span>{pipeline.stages.length} stages</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </Data>
  );
}
