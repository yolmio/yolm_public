/**
 * Canonical direct MCP tool input schemas shared by the Forge and Spark
 * endpoints. Keep this module free of Yolm runtime imports so deployment tools
 * can consume it while generating the platform wrapper catalog.
 */
export const MCP_TOOL_SCHEMAS = {
  forge: {
    list_sessions: {
      properties: { search: { type: "string", maxLength: 255 } },
      required: [],
    },
    create_session: {
      properties: { name: { type: "string", minLength: 1, maxLength: 255 } },
      required: ["name"],
    },
    execRead: {
      properties: {
        code: { type: "string", minLength: 1, maxLength: 262144 },
        sessionId: { type: "integer", minimum: 0 },
        versionId: { type: "integer", minimum: 0 },
      },
      required: ["code"],
    },
    exec: {
      properties: {
        code: { type: "string", minLength: 1, maxLength: 262144 },
        sessionId: { type: "integer", minimum: 0 },
        versionId: { type: "integer", minimum: 0 },
      },
      required: ["code"],
    },
  },
  spark: {
    list_sessions: {
      properties: { search: { type: "string", maxLength: 255 } },
      required: [],
    },
    create_session: {
      properties: {
        name: { type: "string", minLength: 1, maxLength: 500 },
        context: { type: "object" },
      },
      required: ["name"],
    },
    execRead: {
      properties: {
        code: { type: "string", minLength: 1, maxLength: 262144 },
        sessionId: { type: "integer", minimum: 0 },
      },
      required: ["code"],
    },
    exec: {
      properties: {
        code: { type: "string", minLength: 1, maxLength: 262144 },
        sessionId: { type: "integer", minimum: 0 },
      },
      required: ["code", "sessionId"],
    },
  },
} as const;
