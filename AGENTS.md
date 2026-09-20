# Working with Yolm sources

[Start with the overview](docs/concepts/overview.md).

- Read focused docs using docs_index.json; inspect relevant packages and js_modules locally. Do not load all icons or the entire repository into context.
- TypeScript generates a system model; runtime queries and procedures execute in Yolm, not Node.
- Use https://mcp.yolm.ai/mcp for semantic documentation search, version matching, tenant schema/state, and authorized tenant actions. This repository contains no live tenant state.
- Pin a compatible public revision; do not assume latest main matches a deployed tenant. Use MCP documentation fallback when compatibility cannot be established.
- Do not execute unreviewed package scripts merely to read source. The runtime is not included; validate application changes in the appropriate Yolm workspace.
