# Use a model for a stage or workflow design

If you already pay for ChatGPT or Claude, you can use the official chat or a personally signed-in CLI to provide Folio with an edit. Start with the [subscription-to-video walkthrough](subscriptions.md). The API options below are for producers who want Folio to call a provider directly.

Folio includes an optional HTTP client for Anthropic, Google and OpenAI. Choose the provider in the command and the model in the stage’s `owner.model` or the workflow designer’s `writer.model`. Running that command sends the selected prompt and material to the provider’s API and can incur charges on your account.

| Command argument | API | Credential environment variable |
| --- | --- | --- |
| `anthropic` | Messages, API version `2026-10-21`. [Messages reference](https://platform.claude.com/docs/en/api/messages/create) | `ANTHROPIC_API_KEY` |
| `google` | Gemini `generateContent`. Supply a bare model ID. [Generation reference](https://ai.google.dev/api/generate-content) | `GEMINI_API_KEY` or `GOOGLE_API_KEY`. If both are set, the bridge follows Google’s precedence and uses `GOOGLE_API_KEY`. [Key configuration](https://ai.google.dev/gemini-api/docs/api-key) |
| `openai` | Responses. Requests set `store: false`. [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create) | `OPENAI_API_KEY`. [API quickstart](https://developers.openai.com/api/docs/quickstart) |

Provide credentials through the environment of the calling process. For an Anthropic key that spans workspaces, set `ANTHROPIC_WORKSPACE_ID` to select the workspace. [Anthropic authentication headers](https://platform.claude.com/docs/en/api/overview#authentication) The client puts the credential in an HTTP header. The workflow and writer files contain only the selected provider, model and command settings.

## Use a model to write a shot

This stage example assumes your workflow lives two directories below the checkout root, such as `examples/my-project/workflow.json`. Adjust the command paths to suit your project. Replace `your-model-id` with a text model available to your account.

```json
{
  "id": "narration",
  "purpose": "Explain what the interviewee observed in the room.",
  "inputs": { "note": "observation.txt" },
  "owner": {
    "type": "agent",
    "model": "your-model-id",
    "command": ["node", "../../tools/workflow/text-agent.mjs"],
    "settings": {
      "command": ["node", "../../tools/workflow/model.mjs", "anthropic"],
      "instruction": "Draft two spoken sentences supported by the note.",
      "roles": ["note"],
      "format": "text"
    }
  },
  "outputs": { "script": { "path": "narration.txt", "validate": "text" } },
  "approval": true
}
```

The text adapter reads only the named material roles and sends their contents to the model client with the task and editorial intent. Set `includeBrand: true` to add the applicable brand document. Select `format: "json"` for a JSON artifact. The adapter validates the returned value before writing it. [Workflow guide](workflows.md)

## Use a model to propose the workflow

The same executable accepts the designer’s writer protocol. For a `writer.json` two directories below the checkout root, a configuration can look like this.

```json
{
  "model": "your-model-id",
  "command": ["node", "../../tools/workflow/model.mjs", "google", "--max-output-tokens", "4096"],
  "timeoutMs": 120000
}
```

Pass this file to `workflow design --writer`. The writer receives the project brief, available asset IDs, operator interfaces and the writer settings. The bridge requires one JSON object. The designer validates its proposed graph and bindings before saving a workflow. [Workflow design](workflow-design.md)

## Limits and failures

The executable accepts one JSON request on standard input. Standard output contains the final text or valid JSON. The provider and model are explicit. To pin a model in the command, use `--model ID`. The bridge rejects a disagreement with the model in the request. The literal `--model {model}` also reads the request’s model ID.

The default output limit is 4,096 tokens and the request timeout is 90 seconds. Change them with `--max-output-tokens` and `--timeout-ms`. Keep the designer’s outer `timeoutMs` longer than the request timeout. A run sends one request. A provider refusal, filter, incomplete response, token limit, HTTP failure or invalid JSON produces a nonzero exit. Error messages carry the HTTP status or a recognized termination reason. The bridge leaves raw response bodies and credentials out of diagnostics. [Anthropic stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) · [Google candidate finish reasons](https://ai.google.dev/api/generate-content#candidate)

Local tests inject provider responses and exercise both command protocols. Run `node --test tests/model-providers.test.mjs` to check the bridge without API credentials or network access.
