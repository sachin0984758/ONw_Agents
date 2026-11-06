# Licensing

## Project license

AgentHub Terminal is licensed under the **MIT License**. See [`../../LICENSE`](../../LICENSE).

MIT was chosen because:

- the project has no runtime dependencies;
- the direct and transitive development dependencies use permissive licenses
  compatible with MIT;
- the terminal implementation was written for this project rather than copied
  from the existing AgentHub web application;
- MIT is simple for both private and commercial use and includes the usual
  warranty disclaimer.

This is a project decision, not legal advice. A distributor should review the
final source tree and any third-party skills or MCP servers they add.

## Dependency review

As of version 0.1.0:

| Component | Role | License | Runtime? |
|-----------|------|---------|----------|
| Node.js 24 | runtime | MIT-style Node license | yes, supplied by the user |
| TypeScript | typechecker/compiler API (not shipped) | Apache-2.0 | no |
| `@types/node` | development types | MIT | no |
| `undici-types` | transitive type dependency of `@types/node` | MIT | no |

There are **zero npm runtime dependencies**. `package-lock.json` is committed for
reproducible CI installs.

## Relationship to the existing AgentHub application

This repository is a sibling project, not a copy of the AgentHub web application.
It communicates with the existing application over the documented HTTP
compatibility endpoint for repository-wide skill scans. That endpoint and the
web application retain their own licensing and notices.

If code is later copied between the two projects, record the source, author, and
license here before distribution.

## Skills and MCP servers

Installed skills and configured MCP servers are third-party material. Their
licenses and trustworthiness are the user's responsibility. AgentHub Terminal
does not download a declared license, verify a publisher signature, or relicense
third-party content.

## Contributing

By contributing, you agree that your contribution is licensed under the MIT
License and that you have the right to submit it. Do not add dependencies or
copied code without updating this document and the dependency manifest.
