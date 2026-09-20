import { type AnyExpr, Sql, sql } from "../std/sql_utils";
import type { EndpointStatements } from "std/statements";

interface SoapScalarStatements {
  defScalar(name: string | Sql, expr: AnyExpr): void;
}

/**
 * SOAP 1.1 envelope XML namespace URI.
 *
 * @category Service
 */
export const SOAP11_NS = sql.lit`http://schemas.xmlsoap.org/soap/envelope/`;
/**
 * SOAP 1.2 envelope XML namespace URI.
 *
 * @category Service
 */
export const SOAP12_NS = sql.lit`http://www.w3.org/2003/05/soap-envelope`;
/**
 * HTTP `Content-Type` for SOAP 1.1 endpoint responses.
 *
 * @category Service
 */
export const SOAP11_RESPONSE_CONTENT_TYPE = sql.lit`text/xml`;
/**
 * HTTP `Content-Type` for SOAP 1.2 endpoint responses.
 *
 * @category Service
 */
export const SOAP12_RESPONSE_CONTENT_TYPE = sql
  .lit`application/soap+xml; charset=utf-8`;

/**
 * SOAP parameter extraction mode for {@link defineSoapParams}.
 *
 * @category Service
 */
export type SoapParamKind = "text" | "xml";

/**
 * Defines one scalar extracted from an inbound SOAP body.
 *
 * @category Service
 */
export interface SoapParamDefinition {
  /** Procedure scalar to define. */
  scalarName: string;
  /** XML element name to read. Defaults to `scalarName`. */
  tagName?: string | Sql;
  /** Extraction mode. `text` uses {@link soapParam}; `xml` uses {@link soapXmlParam}. */
  kind?: SoapParamKind;
}

/**
 * Result returned by {@link defineSoapDispatch}.
 *
 * @category Service
 */
export interface SoapDispatchRefs {
  /** SQL reference to the defined operation scalar. */
  operation: Sql;
  /** SQL reference to the detected SOAP 1.2 flag when `version` is `auto`. */
  isSoap12?: Sql;
  /** SQL expression for the response `Content-Type`. */
  contentType: Sql;
}

/**
 * Options for {@link defineSoapDispatch}.
 *
 * @category Service
 */
export interface SoapDispatchOptions {
  /** Raw SOAP request body expression. */
  body: Sql;
  /** Static operation names supported by the endpoint. */
  operations: readonly string[];
  /** Procedure scalar name for the detected operation. Defaults to `soap_operation`. */
  operationScalar?: string;
  /**
   * SOAP response version handling. Use `auto` for endpoints that accept
   * both SOAP 1.1 and SOAP 1.2.
   */
  version?: "1.1" | "1.2" | "auto";
  /** Procedure scalar name for the SOAP 1.2 flag when `version` is `auto`. */
  isSoap12Scalar?: string;
  /** Procedure scalar name for the response content type when `version` is `auto`. */
  contentTypeScalar?: string;
}

/**
 * Builds a SOAP 1.1 request-headers JSON array (a SQL fragment evaluating
 * to `[{name, value}, …]`) with `Content-Type: text/xml; charset=utf-8`
 * and the `SOAPAction` header carrying the action name (the SOAP 1.1
 * convention). Stash it in a scalar for project-specific helpers that
 * consume the JSON shape; for direct `s.request({headers: [...]})` build a
 * TS `RequestHeader[]` instead.
 *
 * @param action  SQL expression evaluating to the SOAPAction value.
 * @category Service
 */
export function soap11Headers(action: Sql = sql.lit`""`): Sql {
  return sql`json_build_array(
    json_build_object(
      'name',
      'Content-Type',
      'value',
      'text/xml; charset=utf-8'
    ),
    json_build_object(
      'name',
      'SOAPAction',
      'value',
      ${action}
    )
  )`;
}

/**
 * Builds a SOAP 1.2 request-headers JSON array (a SQL fragment evaluating
 * to `[{name, value}, …]`). Stash it in a scalar with `s.defScalar(...)`
 * for use by project-specific integration helpers that consume the JSON
 * shape; for direct `s.request({headers: [...]})` usage, build a TS
 * `RequestHeader[]` instead.
 *
 * The Content-Type carries the action name inline (no separate
 * `SOAPAction` header — that's the SOAP 1.1 convention).
 *
 * @param action  SQL expression evaluating to the operation/action name.
 * @category Service
 */
export function soap12Headers(action: Sql): Sql {
  return sql`json_build_array(
    json_build_object(
      'name',
      'Content-Type',
      'value',
      'application/soap+xml; charset=utf-8; action="' || ${action} || '"'
    )
  )`;
}

/**
 * Wraps a SOAP 1.2 operation and its parameter object into a complete
 * Envelope/Body XML document ready to send as a request body.
 *
 * @param operation   Operation/action name (Sql evaluating to a string).
 * @param parameters  JSON object Sql expression containing the typed
 *                    operation parameters; rendered inside the `Body`.
 * @category Service
 */
export function soap12DocumentEnvelope(operation: Sql, parameters: Sql): Sql {
  return sql`'<?xml version="1.0" encoding="utf-8"?>' || json.to_xml(json_build_object(
    'soap12:Envelope',
    json_build_object(
      '@xmlns:soap12',
      'http://www.w3.org/2003/05/soap-envelope',
      '@xmlns:xsi',
      'http://www.w3.org/2001/XMLSchema-instance',
      'soap12:Body',
      json_build_object(
        ${operation},
        ${parameters}
      )
    )
  ))`;
}

/**
 * Builds a SOAP 1.1 document/literal-style response envelope.
 *
 * Wraps the result `value` as
 * `<{operation}Response xmlns="{operationNamespace}"><{operation}Result>{value}</{operation}Result></{operation}Response>`
 * inside a `soap:Envelope`. Use for SOAP 1.1 service handlers that
 * return XML payloads.
 *
 * @param operation           Operation name (Sql).
 * @param operationNamespace  XML namespace declared on the response element.
 * @param value               The result payload (Sql evaluating to JSON
 *                            shaped for `json.to_xml`).
 * @category Service
 */
export function soap11DocumentLiteralResponse(
  operation: Sql,
  operationNamespace: Sql,
  value: Sql,
): Sql {
  return sql`'<?xml version="1.0" encoding="utf-8"?>' || json.to_xml(json_build_object(
    'soap:Envelope',
    json_build_object(
      '@xmlns:soap',
      'http://schemas.xmlsoap.org/soap/envelope/',
      '@xmlns:xsi',
      'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd',
      'http://www.w3.org/2001/XMLSchema',
      'soap:Body',
      json_build_object(
        ${operation} || 'Response',
        json_build_object(
          '@xmlns',
          ${operationNamespace},
          ${operation} || 'Result',
          ${value}
        )
      )
    )
  ))`;
}

/**
 * WS-Addressing header options for {@link soap12DocumentLiteralResponse}.
 *
 * Matches the envelope shape emitted by WCF's `Soap12WSAddressing10`
 * binding: a `mustUnderstand` `Action` header (and a `RelatesTo` header
 * echoing the request `MessageID` when one was sent), both in the
 * `http://www.w3.org/2005/08/addressing` namespace.
 *
 * @category Service
 */
export interface Soap12WsAddressingOptions {
  /** SQL expression for the WS-Addressing `Action` URI. */
  action: Sql;
  /**
   * SQL expression for the inbound `MessageID`. Emitted as a `RelatesTo`
   * header when it evaluates to a non-empty value; omitted otherwise.
   */
  relatesTo?: Sql;
}

/**
 * SOAP 1.2 counterpart to {@link soap11DocumentLiteralResponse}. Wraps the
 * result `value` in a `{operation}Response`/`{operation}Result` element
 * inside a SOAP 1.2 envelope.
 *
 * Pass `wsAddressing` to additionally emit a WS-Addressing `soap:Header`
 * (opt-in; the envelope is unchanged when omitted).
 *
 * @category Service
 */
export function soap12DocumentLiteralResponse(
  operation: Sql,
  operationNamespace: Sql,
  value: Sql,
  wsAddressing?: Soap12WsAddressingOptions,
): Sql {
  if (wsAddressing) {
    const relatesTo = wsAddressing.relatesTo ?? sql`null::string`;
    return sql`json.to_xml(json_build_object(
      'soap:Envelope',
      json_build_object(
        '@xmlns:soap',
        'http://www.w3.org/2003/05/soap-envelope',
        '@xmlns:xsi',
        'http://www.w3.org/2001/XMLSchema-instance',
        '@xmlns:xsd',
        'http://www.w3.org/2001/XMLSchema',
        'soap:Header',
        json_build_object(
          'Action',
          json_build_object(
            '@soap:mustUnderstand',
            '1',
            '@xmlns',
            'http://www.w3.org/2005/08/addressing',
            '#text',
            ${wsAddressing.action}
          )
        ) || case
          when nullif(${relatesTo}, '') is not null then json_build_object(
            'RelatesTo',
            json_build_object(
              '@xmlns',
              'http://www.w3.org/2005/08/addressing',
              '#text',
              ${relatesTo}
            )
          )
          else json_build_object()
        end,
        'soap:Body',
        json_build_object(
          ${operation} || 'Response',
          json_build_object(
            '@xmlns',
            ${operationNamespace},
            ${operation} || 'Result',
            ${value}
          )
        )
      )
    ))`;
  }
  return sql`json.to_xml(json_build_object(
    'soap:Envelope',
    json_build_object(
      '@xmlns:soap',
      'http://www.w3.org/2003/05/soap-envelope',
      '@xmlns:xsi',
      'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd',
      'http://www.w3.org/2001/XMLSchema',
      'soap:Body',
      json_build_object(
        ${operation} || 'Response',
        json_build_object(
          '@xmlns',
          ${operationNamespace},
          ${operation} || 'Result',
          ${value}
        )
      )
    )
  ))`;
}

/**
 * Detects SOAP 1.2 envelopes by looking for the SOAP 1.2 namespace in the
 * request body. Use this in compatibility endpoints that accept both SOAP 1.1
 * and SOAP 1.2 payloads.
 *
 * @category Service
 */
export function soapIs12(xmlBody: Sql): Sql {
  return sql`position('http://www.w3.org/2003/05/soap-envelope' in coalesce(${xmlBody}, '')) > 0`;
}

/**
 * Returns the response `Content-Type` for a SOAP version flag produced by
 * {@link soapIs12}.
 *
 * @category Service
 */
export function soapContentType(isSoap12: Sql): Sql {
  return sql`case
    when ${isSoap12} then 'application/soap+xml; charset=utf-8'
    else 'text/xml'
  end`;
}

/**
 * Defines the operation scalar and response content-type refs for an inbound
 * SOAP endpoint.
 *
 * This centralizes the common endpoint setup before branching on individual
 * operations. Use the returned `operation` in `s.if(...)` conditions and the
 * returned `contentType` with {@link returnSoapEndpointResponse}.
 *
 * @category Service
 */
export function defineSoapDispatch(
  s: SoapScalarStatements,
  opts: SoapDispatchOptions,
): SoapDispatchRefs {
  const operationScalar = opts.operationScalar ?? "soap_operation";
  const version = opts.version ?? "1.1";

  s.defScalar(operationScalar, soapOperation(opts.body, opts.operations));

  if (version === "auto") {
    const isSoap12Scalar = opts.isSoap12Scalar ??
      `${operationScalar}_is_soap12`;
    const contentTypeScalar = opts.contentTypeScalar ??
      `${operationScalar}_content_type`;
    const isSoap12Ref = sql.ref(isSoap12Scalar);

    s.defScalar(isSoap12Scalar, soapIs12(opts.body));
    s.defScalar(contentTypeScalar, soapContentType(isSoap12Ref));

    return {
      operation: sql.ref(operationScalar),
      isSoap12: isSoap12Ref,
      contentType: sql.ref(contentTypeScalar),
    };
  }

  return {
    operation: sql.ref(operationScalar),
    contentType: version === "1.2"
      ? SOAP12_RESPONSE_CONTENT_TYPE
      : SOAP11_RESPONSE_CONTENT_TYPE,
  };
}

function soapParamTag(tagName: string | Sql): Sql {
  return typeof tagName === "string" ? sql.lit(tagName) : tagName;
}

/**
 * Defines SOAP request parameter scalars from a body expression.
 *
 * Use `kind: "xml"` for parameters that contain escaped XML payloads;
 * otherwise parameters are read as plain text.
 *
 * @category Service
 */
export function defineSoapParams(
  s: SoapScalarStatements,
  body: Sql,
  params: readonly SoapParamDefinition[],
): void {
  for (const param of params) {
    const tagName = soapParamTag(param.tagName ?? param.scalarName);
    s.defScalar(
      param.scalarName,
      param.kind === "xml"
        ? soapXmlParam(body, tagName)
        : soapParam(body, tagName),
    );
  }
}

/**
 * Sets the SOAP response `Content-Type` header and returns the response body.
 *
 * @category Service
 */
export function returnSoapEndpointResponse(
  s: EndpointStatements,
  contentType: Sql,
  response: Sql,
): void {
  s.setHeader(sql.lit`Content-Type`, contentType);
  s.return(response);
}

/**
 * Builds either a SOAP 1.1 or SOAP 1.2 document/literal response based on a
 * runtime version flag.
 *
 * `wsAddressing` (opt-in) applies to the SOAP 1.2 branch only; the SOAP 1.1
 * envelope never carries WS-Addressing headers.
 *
 * @category Service
 */
export function soapVersionedDocumentLiteralResponse(
  isSoap12: Sql,
  operation: Sql,
  operationNamespace: Sql,
  value: Sql,
  wsAddressing?: Soap12WsAddressingOptions,
): Sql {
  return sql`case
    when ${isSoap12} then ${
    soap12DocumentLiteralResponse(
      operation,
      operationNamespace,
      value,
      wsAddressing,
    )
  }
    else ${soap11DocumentLiteralResponse(operation, operationNamespace, value)}
  end`;
}

/**
 * Builds a SOAP 1.1 `Fault` envelope with a `soap:Sender` fault code and
 * the given fault string (defaulting to a generic message when null). Use
 * to report request-processing errors from a SOAP 1.1 handler.
 *
 * @category Service
 */
export function soap11FaultResponse(message: Sql): Sql {
  return sql`'<?xml version="1.0" encoding="utf-8"?>' || json.to_xml(json_build_object(
    'soap:Envelope',
    json_build_object(
      '@xmlns:soap',
      'http://schemas.xmlsoap.org/soap/envelope/',
      'soap:Body',
      json_build_object(
        'soap:Fault',
        json_build_object(
          'faultcode',
          'soap:Sender',
          'faultstring',
          coalesce(${message}, 'Server was unable to process request.')
        )
      )
    )
  ))`;
}

/**
 * SOAP 1.2 counterpart to {@link soap11FaultResponse}: builds a SOAP 1.2
 * `Fault` envelope with a `soap:Sender` code and the given reason text
 * (defaulting to a generic message when null).
 *
 * @category Service
 */
export function soap12FaultResponse(message: Sql): Sql {
  return sql`json.to_xml(json_build_object(
    'soap:Envelope',
    json_build_object(
      '@xmlns:soap',
      'http://www.w3.org/2003/05/soap-envelope',
      'soap:Body',
      json_build_object(
        'soap:Fault',
        json_build_object(
          'soap:Code',
          json_build_object('soap:Value', 'soap:Sender'),
          'soap:Reason',
          json_build_object(
            'soap:Text',
            json_build_object(
              '@xml:lang',
              'en',
              '#text',
              coalesce(${message}, 'Server was unable to process request.')
            )
          )
        )
      )
    )
  ))`;
}

/**
 * Builds either a SOAP 1.1 or SOAP 1.2 fault response based on a runtime
 * version flag.
 *
 * @category Service
 */
export function soapVersionedFaultResponse(
  isSoap12: Sql,
  message: Sql,
): Sql {
  return sql`case
    when ${isSoap12} then ${soap12FaultResponse(message)}
    else ${soap11FaultResponse(message)}
  end`;
}

/**
 * Builds a SOAP 1.1 RPC/encoded-style request envelope, declaring the
 * `soap`, `xsi`, `xsd`, and `soapenc` namespaces and an `encodingStyle`
 * attribute, with the operation parameters (a JSON object Sql) merged in
 * under a `q1`-namespaced operation element. Use for legacy services that
 * require the RPC/encoded binding rather than document/literal.
 *
 * @param operation           Operation/action name (Sql).
 * @param operationNamespace  XML namespace bound to the `q1` prefix.
 * @param parameters          JSON object Sql with the operation parameters.
 * @category Service
 */
export function soap11RpcEncodedEnvelope(
  operation: Sql,
  operationNamespace: Sql,
  parameters: Sql,
): Sql {
  return sql`'<?xml version="1.0" encoding="utf-8"?>' || json.to_xml(json_build_object(
    'soap:Envelope',
    json_build_object(
      '@xmlns:soap',
      'http://schemas.xmlsoap.org/soap/envelope/',
      '@xmlns:xsi',
      'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd',
      'http://www.w3.org/2001/XMLSchema',
      '@xmlns:soapenc',
      'http://schemas.xmlsoap.org/soap/encoding/',
      'soap:Body',
      json_build_object(
        '@soap:encodingStyle',
        'http://schemas.xmlsoap.org/soap/encoding/',
        ${operation},
        json_build_object('@xmlns:q1', ${operationNamespace}) || ${parameters}
      )
    )
  ))`;
}

/**
 * Decodes the five named XML entities (`&lt; &gt; &quot; &apos; &amp;`)
 * back to their literal characters. Use on text extracted from XML
 * payloads before doing further string processing.
 *
 * @category Service
 */
export function xmlDecodeText(value: Sql): Sql {
  return sql`replace(
    replace(
      replace(
        replace(
          replace(coalesce(${value}, ''), '&lt;', '<'),
          '&gt;',
          '>'
        ),
        '&quot;',
        '"'
      ),
      '&apos;',
      ''''
    ),
    '&amp;',
    '&'
  )`;
}

/**
 * Escapes the five XML metacharacters (`& < > " '`) so the value can be
 * safely interpolated into an XML element or attribute. Inverse of
 * {@link xmlDecodeText}.
 *
 * @category Service
 */
export function xmlEscape(value: Sql): Sql {
  return sql`replace(
    replace(
      replace(
        replace(
          replace(coalesce(${value}, ''), '&', '&amp;'),
          '<',
          '&lt;'
        ),
        '>',
        '&gt;'
      ),
      '"',
      '&quot;'
    ),
    '''',
    '&apos;'
  )`;
}

/**
 * Wraps the value in a `<![CDATA[…]]>` block, splitting any embedded
 * `]]>` sequences so the literal cannot be terminated prematurely. Use
 * when you need to embed arbitrary text (HTML, code) inside XML.
 *
 * @category Service
 */
export function xmlCdata(value: Sql): Sql {
  return sql`'<![CDATA[' || replace(coalesce(${value}, ''), ']]>', ']]]]><![CDATA[>') || ']]>'`;
}

/**
 * Extracts the inner text of the first `<tagName>…</tagName>` element
 * (with or without an XML namespace prefix) from an XML body. Returns
 * `NULL` when the tag is absent — wrap with `coalesce(..., '')` if you
 * need an empty-string default.
 *
 * Lightweight, regex-based (newlines are stripped before matching) —
 * fine for predictable SOAP responses but unsuitable for arbitrary XML.
 *
 * @category Service
 */
export function xmlTagText(xmlText: Sql, tagName: Sql): Sql {
  return sql`
    nullif(
      regex.replace(
        regex.replace_all(coalesce(${xmlText}, ''), '[\r\n]+', ''),
        '.*<([A-Za-z0-9_.-]+:)?' || ${tagName} || '[^>]*>(.*)</([A-Za-z0-9_.-]+:)?' || ${tagName} || '>.*',
        '$2'
      ),
      coalesce(${xmlText}, '')
    )
  `;
}

/**
 * Normalizes legacy XML text bodies where callers sometimes submit a quoted
 * string instead of raw XML. The returned SQL expression trims one surrounding
 * quote pair when present and otherwise returns the body unchanged.
 *
 * @category Service
 */
export function xmlTextBodyPayload(xmlBody: Sql): Sql {
  return sql`case
    when left(trim(${xmlBody}), 1) = '"' then trim(both '"' from trim(${xmlBody}))
    else ${xmlBody}
  end`;
}

/**
 * Extracts an exact, non-namespaced element's inner text from a known XML
 * fragment using simple string splitting.
 *
 * This is intended for predictable legacy payloads like
 * `<Item><Id>123</Id></Item>`. For namespace-tolerant SOAP parsing, use
 * {@link xmlTagText} instead.
 *
 * @category Service
 */
export function xmlElementTextFromFragment(
  xmlFragment: Sql,
  tagName: Sql,
): Sql {
  return sql`nullif(
    split_part(
      split_part(coalesce(${xmlFragment}, ''), '<' || ${tagName} || '>', 2),
      '</' || ${tagName} || '>',
      1
    ),
    ''
  )`;
}

/**
 * Reads an exact XML element from a known fragment and compares it to `true`
 * after trimming and lowercasing.
 *
 * @category Service
 */
export function xmlElementBoolFromFragment(
  xmlFragment: Sql,
  tagName: Sql,
): Sql {
  return sql`lower(trim(coalesce(${
    xmlElementTextFromFragment(xmlFragment, tagName)
  }, ''))) = 'true'`;
}

/**
 * Detects which operation a SOAP request is invoking by scanning its body
 * for any of the candidate operation names (with or without namespace
 * prefix). Returns the matched name or an empty string.
 *
 * Use in a SOAP service handler to dispatch on the operation before
 * parsing the parameters with {@link soapParam} / {@link soapXmlParam}.
 *
 * @param xmlBody          Raw request body (Sql).
 * @param operationNames   Static list of operation names this endpoint
 *                         supports.
 * @category Service
 */
export function soapOperation(
  xmlBody: Sql,
  operationNames: readonly string[],
): Sql {
  const body = operationNames
    .map((operationName) => {
      const unprefixed = sql.lit(`<${operationName}`).toSQL();
      const prefixed = sql.lit(`:${operationName}`).toSQL();
      const result = sql.lit(operationName).toSQL();
      return `when position(${unprefixed} in ${xmlBody.toSQL()}) > 0 or position(${prefixed} in ${xmlBody.toSQL()}) > 0 then ${result}`;
    })
    .join("\n");

  return new Sql(`case\n${body}\nelse ''\nend`);
}

/**
 * Reads a plain-text SOAP parameter — equivalent to {@link xmlTagText}.
 * Use when the parameter value is already plain text (numbers, IDs).
 *
 * @category Service
 */
export function soapParam(xmlBody: Sql, tagName: Sql): Sql {
  return xmlTagText(xmlBody, tagName);
}

/**
 * Reads a SOAP parameter and decodes its XML entities. Use when the
 * parameter value contains user-facing text that may include `&amp;`,
 * `&quot;`, etc.
 *
 * @category Service
 */
export function soapXmlParam(xmlBody: Sql, tagName: Sql): Sql {
  return xmlDecodeText(xmlTagText(xmlBody, tagName));
}

/**
 * Reads a namespace-tolerant SOAP element via {@link xmlTagText} and
 * compares its trimmed, lowercased text to `true`. Use to pull a boolean
 * result out of a SOAP response body.
 *
 * @category Service
 */
export function soapBoolResult(xmlText: Sql, tagName: Sql): Sql {
  return sql`lower(trim(coalesce(${
    xmlTagText(xmlText, tagName)
  }, ''))) = 'true'`;
}
