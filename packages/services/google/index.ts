import { queryParamsString } from "std/services";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, JsonBuildValue, Sql } from "../../std/sql_utils";
import type { GenericServerStatementsFn, Oauth } from "std/statements";

export type GoogleAuthOptions = {
  type: "ServiceAccount";
  privateKey: Sql;
  clientEmail: Sql;
};

export interface GoogleOptions {
  auth: GoogleAuthOptions;
}

export interface GoogleInternalOptions extends GoogleOptions {}

export class Google {
  #opts: GoogleInternalOptions;
  spreadsheets: GoogleSpreadsheets;
  drive: GoogleDrive;

  constructor(opts: GoogleOptions) {
    this.#opts = opts;
    this.spreadsheets = new GoogleSpreadsheets(this.#opts);
    this.drive = new GoogleDrive(this.#opts);
  }
}

abstract class GoogleAuth {
  protected abstract scope: Sql;

  constructor(protected opts: GoogleInternalOptions) {}

  get oauth(): Oauth {
    if (this.opts.auth.type !== "ServiceAccount") {
      throw new Error(`Google auth type ${this.opts.auth.type} not supported`);
    }
    return {
      type: "ServiceAccount",
      privateKey: this.opts.auth.privateKey,
      tokenUri: sql.lit`https://oauth2.googleapis.com/token`,
      clientEmail: this.opts.auth.clientEmail,
      scope: this.scope,
    };
  }
}

/**
 Options for creating a Google Sheets spreadsheet.
 */
interface CreateSpreadsheetOptions {
  /**
       The title of the spreadsheet.
       */
  title: Sql;
  /**
       An array of sheet configurations. Each object in the array represents a sheet to be created.
       */
  sheets?: {
    /**
           The title of the sheet.
           */
    title: Sql;
  }[];
  /**
       The name of the scalar to store the new spreadsheet ID. Defaults to "spreadsheet_id" if not provided.
       */
  sheetIdScalar?: string;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

/**
 Options for appending values to a Google Sheets spreadsheet.
 */
interface AppendValuesOptions {
  /**
       The ID of the spreadsheet to update.
       */
  spreadsheetId: Sql;
  /**
       The A1 notation of the range to append data to.

       For example, Sheet1!A1:D5 represents the range from cell A1 to cell D5 in Sheet1.
       */
  range: Sql;
  /**
       The values to append to the spreadsheet.
       */
  values: JsonBuildValue[] | Sql;
  /**
       How the input data should be interpreted. Defaults to "RAW" if not provided.
       */
  valueInputOption?: Sql;
  /**
       How the input data should be inserted.
       */
  insertDataOption?: Sql;
  /**
       Whether to include the updated values in the response.
       */
  includeValuesInResponse?: BooleanExpr;
  /**
       How the values should be rendered in the response.
       */
  responseValueRenderOption?: Sql;
  /**
       How dates, times, and durations should be rendered in the response.
       */
  responseDateTimeRenderOption?: Sql;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

/**
 Options for retrieving values from a Google Sheets spreadsheet.
 */
interface GetValuesOptions {
  /**
       The ID of the spreadsheet to retrieve data from.
       */
  spreadsheetId: Sql;
  /**
       The A1 notation of the range to retrieve values from.
       */
  range: Sql;
  /**
       The major dimension that results should use. Defaults to "ROWS" if not provided.
       */
  majorDimension?: Sql;
  /**
       How values should be represented in the output.

       Can BE "FORMATTED_VALUE", "UNFORMATTED_VALUE", or "FORMULA". Defaults to "FORMATTED_VALUE" if not provided.
       */
  valueRenderOption?: Sql;
  /**
       How dates, times, and durations should be represented in the output.
       */
  dateTimeRenderOption?: Sql;
  /**
       The name of the scalar to store the retrieved values. Defaults to "sheet_values" if not provided.
       */
  valuesScalar?: string;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

export class GoogleSpreadsheets extends GoogleAuth {
  protected scope = sql.lit`https://www.googleapis.com/auth/spreadsheets`;

  values: GoogleSpreadsheetsValues;

  constructor(opts: GoogleInternalOptions) {
    super(opts);
    this.values = new GoogleSpreadsheetsValues(this.opts);
  }

  /**
       Creates a new Google Sheets spreadsheet.
       @param opts - The options for creating a spreadsheet.
       @returns A function that generates the statements for creating a spreadsheet.
       */
  create(opts: CreateSpreadsheetOptions): GenericServerStatementsFn {
    const sheetIdScalar = opts.sheetIdScalar ?? "spreadsheet_id";
    return (s) => {
      s.defScalar(sheetIdScalar, { type: "String" });
      s.block((s) => {
        s.request({
          uri: sql.lit`https://sheets.googleapis.com/v4/spreadsheets`,
          method: "POST",
          optIn: opts.optIn,
          json: {
            properties: {
              title: opts.title,
            },
            sheets: opts.sheets
              ? opts.sheets.map((sheet) => ({
                properties: { title: sheet.title },
              }))
              : undefined,
          },
          oauth: this.oauth,
          receiveJson: "response_body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from create spreadsheet call:' || response.status`,
          );
        });
        s.setScalar(sheetIdScalar, sql`response_body->>'spreadsheetId'`);
      });
    };
  }
}

export class GoogleSpreadsheetsValues extends GoogleAuth {
  protected scope = sql.lit`https://www.googleapis.com/auth/spreadsheets`;

  /**
       Appends values to a Google Sheets spreadsheet.
       @param opts - The options for appending values.
       @returns A function that generates the statements for appending values.
       */
  append(opts: AppendValuesOptions): GenericServerStatementsFn {
    return (s) => {
      s.block((s) => {
        const queryParams = {
          valueInputOption: opts.valueInputOption ?? sql.lit`RAW`,
          insertDataOption: opts.insertDataOption,
          includeValuesInResponse: opts.includeValuesInResponse,
          responseValueRenderOption: opts.responseValueRenderOption,
          responseDateTimeRenderOption: opts.responseDateTimeRenderOption,
        };
        s.request({
          uri: sql.concat(
            sql.lit`https://sheets.googleapis.com/v4/spreadsheets/`,
            opts.spreadsheetId,
            sql.lit`/values/`,
            opts.range,
            sql.lit`:append?`,
            queryParamsString(queryParams),
          ),
          method: "POST",
          optIn: opts.optIn,
          json: { values: opts.values },
          oauth: this.oauth,
          receiveJson: "response_body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from append values call:' || response.status`,
          );
        });
      });
    };
  }

  /**
       Retrieves values from a Google Sheets spreadsheet.
       @param opts - The options for getting values.
       @returns A function that generates the statements for getting values.
       */
  get(opts: GetValuesOptions): GenericServerStatementsFn {
    const valuesScalar = opts.valuesScalar ?? "sheet_values";
    return (s) => {
      s.defScalar(valuesScalar, {
        type: "Json",
      });
      s.block((s) => {
        const queryParams = {
          majorDimension: opts.majorDimension,
          valueRenderOption: opts.valueRenderOption,
          dateTimeRenderOption: opts.dateTimeRenderOption,
        };

        s.request({
          uri: sql.concat(
            sql.lit`https://sheets.googleapis.com/v4/spreadsheets/`,
            opts.spreadsheetId,
            sql.lit`/values/`,
            opts.range,
            sql.lit`?`,
            queryParamsString(queryParams),
          ),
          optIn: opts.optIn,
          oauth: this.oauth,
          receiveJson: "response_body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from get values call:' || response.status`,
          );
        });
        s.setScalar(valuesScalar, sql`response_body->'values'`);
      });
    };
  }
}

export class GoogleDrive {
  files: GoogleDriveFiles;

  constructor(private opts: GoogleInternalOptions) {
    this.files = new GoogleDriveFiles(this.opts);
  }
}

export class GoogleDriveFiles extends GoogleAuth {
  protected scope = sql.lit`https://www.googleapis.com/auth/drive`;

  permissions: GoogleDriveFilesPermissions;

  constructor(opts: GoogleInternalOptions) {
    super(opts);
    this.permissions = new GoogleDriveFilesPermissions(this.opts);
  }

  patch(opts: {
    fileId: Sql;
    name?: Sql;
    description?: Sql;
    mimeType?: Sql;
    uploadType?: Sql;
    addParents?: Sql;
    keepRevisionForever?: BooleanExpr;
    ocrLanguage?: Sql;
    removeParents?: Sql;
    supportsAllDrives?: BooleanExpr;
    useContentAsIndexableText?: BooleanExpr;
    includePermissionsForView?: Sql;
    includeLabels?: Sql;
    /** Required in preview/local-dev when external services mode is opt-in */
    optIn?: BooleanExpr;
  }): GenericServerStatementsFn {
    return (s) => {
      s.block((s) => {
        const queryParams = {
          uploadType: opts.uploadType,
          addParents: opts.addParents,
          keepRevisionForever: opts.keepRevisionForever,
          ocrLanguage: opts.ocrLanguage,
          removeParents: opts.removeParents,
          supportsAllDrives: opts.supportsAllDrives,
          useContentAsIndexableText: opts.useContentAsIndexableText,
          includePermissionsForView: opts.includePermissionsForView,
          includeLabels: opts.includeLabels,
        };
        s.request({
          uri: sql.concat(
            sql.lit`https://www.googleapis.com/drive/v3/files/`,
            opts.fileId,
            sql.lit`?`,
            queryParamsString(queryParams),
          ),
          method: "PATCH",
          optIn: opts.optIn,
          ...(opts.name !== undefined || opts.description !== undefined ||
              opts.mimeType !== undefined
            ? {
              json: {
                name: opts.name,
                description: opts.description,
                mimeType: opts.mimeType,
              },
            }
            : {}),
          oauth: this.oauth,
          receiveJson: "response_body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from patch file call:' || response.status`,
          );
        });
      });
    };
  }
}

export class GoogleDriveFilesPermissions extends GoogleAuth {
  protected scope = sql.lit`https://www.googleapis.com/auth/drive.file`;

  create(opts: {
    fileId: Sql;
    role: Sql;
    type: Sql;
    emailAddress?: Sql;
    domain?: Sql;
    allowFileDiscovery?: BooleanExpr;
    view?: Sql;
    transferOwnership?: BooleanExpr;
    moveToNewOwnersRoot?: BooleanExpr;
    supportsAllDrives?: BooleanExpr;
    useDomainAdminAccess?: BooleanExpr;
    /** Required in preview/local-dev when external services mode is opt-in */
    optIn?: BooleanExpr;
  }): GenericServerStatementsFn {
    return (s) => {
      s.block((s) => {
        const queryParams = {
          supportsAllDrives: opts.supportsAllDrives,
          useDomainAdminAccess: opts.useDomainAdminAccess,
        };

        s.request({
          uri: sql.concat(
            sql.lit`https://www.googleapis.com/drive/v3/files/`,
            opts.fileId,
            sql.lit`/permissions?`,
            queryParamsString(queryParams),
          ),
          method: "POST",
          optIn: opts.optIn,
          json: {
            role: opts.role,
            type: opts.type,
            emailAddress: opts.emailAddress,
            domain: opts.domain,
            allowFileDiscovery: opts.allowFileDiscovery,
            view: opts.view,
            transferOwnership: opts.transferOwnership,
            moveToNewOwnersRoot: opts.moveToNewOwnersRoot,
          },
          oauth: this.oauth,
          receiveJson: "response_body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from create permission call:' || response.status`,
          );
        });
      });
    };
  }
}
