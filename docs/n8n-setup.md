# Running n8n workflows from AgentHub

AgentHub can connect to a real n8n instance, import a gallery template as a
workflow, run it through the correct execution mechanism, and show the actual
execution record n8n produced. Nothing is simulated: when a workflow cannot be
run, AgentHub says so and explains why.

## 1. Start n8n

```bash
npx n8n            # defaults to http://localhost:5678
```

## 2. Create an API key

In n8n open **Settings → n8n API → Create an API key** and copy it. This is the
key AgentHub uses for the public REST API (workflow import, activation,
execution lookup).

## 3. Configure AgentHub

Either copy `.env.example` to `.env.local` and fill in:

```
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=n8n_api_xxxxxxxxxxxxxxxx
```

or open the **Workflows** page in AgentHub and use the **Connection setup**
panel. Stored settings live in `db/n8n-config.json` (git-ignored) and the API
key is never sent back to the browser.

Then click **Test**. The status should read **Connected** with the n8n version.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `N8N_BASE_URL` | yes | Base URL of the n8n instance. |
| `N8N_API_KEY` | yes | n8n API key (server-side only). |
| `N8N_WEBHOOK_BASE_URL` | no | Public URL n8n registers webhooks under, if it differs from the base URL. |
| `N8N_TIMEOUT_MS` | no | Request timeout in ms (1000–60000, default 15000). |
| `N8N_ALLOWED_HOSTS` | no | Comma-separated host allowlist (SSRF guard). |
| `N8N_ALLOW_PRIVATE_HOSTS` | no | `false` forbids localhost/private hosts (for internet-facing deploys). |

## 4. Import and run a template

1. Expand a template in the **n8n Template Gallery**.
2. **Import to n8n** — creates the workflow in n8n (repeated imports reuse the
   same workflow instead of creating duplicates).
3. Configure any credentials the workflow needs in n8n, tick the confirmation
   checkbox, then **Activate**.
4. **Run Workflow** and watch the **Latest execution** panel. AgentHub reports
   the real execution id, status, mode, timings and any error from n8n.

## How each trigger type runs

n8n's public API has **no generic "run workflow now" endpoint**, so AgentHub
uses the mechanism that actually applies to each trigger:

| Trigger | What AgentHub does |
| --- | --- |
| **Webhook** | Activate, then HTTP-POST to the production webhook URL and read back the execution n8n created. |
| **Form** | Same as webhook, against the form trigger URL. |
| **Schedule** | Activate / deactivate only. n8n fires it on its schedule; the Run button does not force it. |
| **Event** (Gmail/Telegram/Slack/… triggers) | Activate / deactivate. Explain which event is required. |
| **Manual** | Not runnable through the public API. AgentHub opens the workflow in n8n instead of faking a run. |

## Notes and limitations

- AgentHub's **execution history** (`db/n8n-state.json`) is a convenience record;
  n8n remains the source of truth for execution data.
- Credentials are never stored by AgentHub. Workflows that reference credentials
  must have them configured inside n8n first.
- The integration targets the stable n8n **public API v1** and its documented
  endpoints (`/api/v1/workflows`, `/activate`, `/deactivate`, `/api/v1/executions`).
