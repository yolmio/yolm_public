import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Match, Switch } from "std/ui";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";

export interface FileTypeIconKindSqlOpts {
  /** Version content type; null is treated as unknown. */
  contentType: Sql;
  /** Item or file name used for extension fallback. */
  fileName: Sql;
  /** When provided, rows whose kind is 'folder' classify as folders. */
  itemKind?: Sql;
}

const KIND_ICONS: Record<string, { icon: IconName; className: string }> = {
  folder: { icon: "Folder", className: "text-secondary" },
  pdf: { icon: "PictureAsPdf", className: "text-danger-500" },
  image: { icon: "Image", className: "text-warning-600" },
  spreadsheet: { icon: "TableChart", className: "text-success-600" },
  word: { icon: "Description", className: "text-primary-600" },
  doc: { icon: "Article", className: "text-primary-500" },
  link: { icon: "Link", className: "text-secondary" },
  email: { icon: "Mail", className: "text-secondary" },
  archive: { icon: "FolderZip", className: "text-secondary" },
  signed: { icon: "GppGood", className: "text-success-600" },
  cad: { icon: "ViewInAr", className: "text-secondary" },
};

const GENERIC_ICON: { icon: IconName; className: string } = {
  icon: "InsertDriveFile",
  className: "text-secondary",
};

/**
 * SQL `case` expression classifying a file into one of the icon kinds
 * rendered by {@link FileTypeIcon}. Content type wins; the filename extension
 * is the fallback because uploaded CAD, email, and archive files frequently
 * arrive as `application/octet-stream`.
 */
export function fileTypeIconKindSql(opts: FileTypeIconKindSqlOpts): Sql {
  const contentType = sql`lower(coalesce(${opts.contentType}, ''))`;
  const nameEndsWith = (extensions: string[]) =>
    extensions
      .map((extension) =>
        sql`lower(${opts.fileName}) like ${sql.lit(`%.${extension}`)}`
      )
      .reduce((a, b) => sql`${a} or ${b}`);
  const contentTypeIn = (types: string[]) =>
    sql`${contentType} in (${
      types.map((type) => sql.lit(type)).reduce((a, b) => sql`${a}, ${b}`)
    })`;
  return sql`case
    ${
    opts.itemKind ? sql`when ${opts.itemKind} = 'folder' then 'folder'` : sql``
  }
    when ${contentType} = 'application/pdf'
      or ${nameEndsWith(["pdf"])} then 'pdf'
    when ${contentType} like 'image/%'
      or ${
    nameEndsWith([
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "tif",
      "tiff",
      "heic",
      "svg",
    ])
  } then 'image'
    when ${
    contentTypeIn([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "text/csv",
    ])
  }
      or ${nameEndsWith(["xlsx", "xlsm", "xls", "csv"])} then 'spreadsheet'
    when ${
    contentTypeIn([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ])
  }
      or ${nameEndsWith(["docx", "doc"])} then 'word'
    when ${
    contentTypeIn(["application/vnd.yolm.document+json", "text/markdown"])
  }
      or ${nameEndsWith(["md"])} then 'doc'
    when ${contentType} = 'application/vnd.yolm.external-link' then 'link'
    when ${contentTypeIn(["message/rfc822", "application/vnd.ms-outlook"])}
      or ${nameEndsWith(["msg", "eml", "pst"])} then 'email'
    when ${
    contentTypeIn([
      "application/zip",
      "application/x-zip-compressed",
      "application/x-7z-compressed",
      "application/vnd.rar",
      "application/x-rar-compressed",
      "application/gzip",
    ])
  }
      or ${nameEndsWith(["zip", "7z", "rar", "gz"])} then 'archive'
    when ${
    contentTypeIn([
      "application/pkcs7-mime",
      "application/x-pkcs7-mime",
      "multipart/signed",
    ])
  }
      or ${nameEndsWith(["p7m"])} then 'signed'
    when ${
    nameEndsWith([
      "step",
      "stp",
      "dwg",
      "dxf",
      "igs",
      "iges",
      "stl",
      "sldprt",
      "sldasm",
      "ipt",
    ])
  } then 'cad'
    else 'generic'
  end`;
}

export interface FileTypeIconProps {
  /** A kind value produced by {@link fileTypeIconKindSql}. */
  kind: Sql | string;
  className?: string;
}

/** Colored file-type icon for one {@link fileTypeIconKindSql} kind. */
export function FileTypeIcon(props: FileTypeIconProps) {
  const kind = typeof props.kind === "string"
    ? sql.lit(props.kind)
    : props.kind;
  const iconClassName = (className: string) =>
    props.className ? `${props.className} ${className}` : className;
  return (
    <Switch>
      {Object.entries(KIND_ICONS).map(([kindName, entry]) => (
        <Match when={sql`${kind} = ${sql.lit(kindName)}`}>
          <MaterialIcon
            icon={entry.icon}
            className={iconClassName(entry.className)}
          />
        </Match>
      ))}
      <Match when={sql`true`}>
        <MaterialIcon
          icon={GENERIC_ICON.icon}
          className={iconClassName(GENERIC_ICON.className)}
        />
      </Match>
    </Switch>
  );
}
