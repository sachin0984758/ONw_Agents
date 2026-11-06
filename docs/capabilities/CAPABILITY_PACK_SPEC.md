# Capability pack manifest and lifecycle

Manifest schema is implemented in `src/lib/agent-hub/capabilities/types.ts` and
validated by `validateCapabilityManifest`.

Fields: stable lowercase `id`, semantic `version`, `name`, `description`,
`category`, task `keywords`, `capabilities`, existing `skills`, validated
existing `tools`, `templates`, `components`, dependencies with optional flags,
platforms, compatible Session agent IDs, model requirements, declared
permissions, license, and source provenance.

```json
{
  "id": "local-example",
  "version": "1.0.0",
  "name": "Local Example",
  "description": "A metadata-only pack that references existing AgentHub resources.",
  "category": "development",
  "keywords": ["inspect", "repository"],
  "capabilities": ["workspace-search"],
  "skills": [],
  "tools": ["workspace_info", "search"],
  "templates": [],
  "components": [],
  "dependencies": [],
  "platforms": ["any"],
  "compatibleAgents": ["research"],
  "modelRequirements": ["chat"],
  "requiredPermissions": ["selected-workspace-read"],
  "license": null,
  "source": { "kind": "local" }
}
```

The API accepts `install`, `enable`, `disable`, `assign`, `uninstall`, and
`import` actions. Imported metadata is disabled by default. The UI currently
manages the six built-in packs; local import is available through the API only.
Unsupported tools and agents, malformed IDs/versions, self-dependencies,
unsupported platforms, and non-HTTPS registry provenance are rejected. Tool and
permission declarations are descriptive only; the existing runtime is the
authority for actual access.

## Current routing

Only enabled packs assigned to the parsed slash agent are considered. A pack is
added to the prompt only when at least one declared keyword matches the request.
The prompt includes its capabilities, existing tool names, and existing resource
IDs. Skills remain loaded through the existing Skills Library activation tool;
component source remains in the current UI component marketplace. No resources
are copied into a parallel registry.

