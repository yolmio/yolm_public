# Yolm developer sources

[Yolm](https://yolm.ai) is an AI Business Platform that brings business applications, workflows, reporting, permissions, and AI together on one live database.

**Most code in this repository runs unchanged only on the Yolm AI Business Platform.** TypeScript/TSX defines systems; SQL and Yolm procedures execute on the platform. The compiler and runtime are not included here.

This repository contains:

- [Reusable code](packages/): UI components, business blocks, service integrations, and standard-library modules for learning, reference, vendoring, and reuse in Yolm systems, or adaptation elsewhere.
- [Browser JS modules](js_modules/): module sources, dependency manifests, and reviewed dependency links. See [module setup](js_modules/README.md).
- [Documentation](docs/): platform concepts, application development, APIs, and SQL. [Start with the overview](docs/concepts/overview.md).

Coding agents: see [AGENTS.md](AGENTS.md).

Yolm-authored content is licensed under [Apache-2.0](LICENSE). Third-party copyright and license notices remain applicable; see [NOTICE](NOTICE).
