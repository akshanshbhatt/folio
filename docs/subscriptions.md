# Make a video with your ChatGPT or Claude subscription

You can make your first Folio video with the chat account you already use. In this walkthrough, ChatGPT or Claude edits a short interview. You decide whether to keep the edit. Folio uses the original recording to render a waveform video, time the captions and draw the cover on your computer. The walkthrough uses an original sample recording and requires no API key.

| How you like to work | Where to start |
| --- | --- |
| I want to describe the video and have an assistant operate Folio | [Open Folio in Codex or Claude Code](#let-your-assistant-operate-folio) |
| I already use ChatGPT or Claude in my browser | [Send a brief and bring the answer back](#get-a-story-edit) |
| I prefer one terminal command for the AI step | [Run the same brief through a signed-in CLI](#use-a-personal-cli-instead-of-the-browser) |
| I want Folio to call models on a schedule | [Configure an API-backed stage](#choose-how-to-run-the-next-production) |

## Install Folio once

Install Git, Node.js 22 or newer, Python 3.9 or newer and FFmpeg with `ffprobe`, H.264 (libx264) and AAC support. The commands below use a macOS, Linux or WSL shell. Run them in one terminal so the folder variables carry through. If you already have the checkout, start at `cd folio` using its actual location.

```sh
git clone https://github.com/akshanshbhatt/folio.git
cd folio
npm ci
node --version
python3 --version
ffmpeg -version
ffprobe -version
```

## Let your assistant operate Folio

**ChatGPT.** Install the official Codex CLI. In the Folio directory, run `codex login`, choose **Sign in with ChatGPT**, then run `codex login status` and check for ChatGPT sign-in. Start the assistant with `codex`. You can also open the Folio checkout as a local project in Codex on desktop. Access and limits follow the signed-in plan and workspace. [Install Codex](https://developers.openai.com/codex/cli/) · [ChatGPT plan access](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) · [Authentication](https://developers.openai.com/codex/auth/)

**Claude.** Install the official Claude Code CLI. Run `claude auth login --claudeai`, complete the browser sign-in with the account that holds your subscription, then run `claude auth status --text`. Start `claude` in the Folio directory. Use `/status` to check the active account and provider. Anthropic lists Pro, Max and Ultra subscriptions and eligible organization seats. [Install Claude Code](https://code.claude.com/docs/en/setup) · [Authentication and plan eligibility](https://code.claude.com/docs/en/authentication)

Give either assistant this request:

> Use Folio to edit the bundled studio interview. Read docs/subscriptions.md and examples/studio-session/README.md. Use a fresh local working directory under release/ and a separate workflow state directory. Give the film a title. Keep the host’s question, both knocks, the silence and the guest’s reply. Use the original voices. Render the MP4, captions and cover, show me where to open them, and stop at the review stage. I’ll decide whether to approve the cut. Keep the source example intact.

When the agent shows the preview, you can ask it to try a different opening, replace the cover or package the version you approved. The next sections walk through what the agent does and let you make the same film from a browser chat.

## Prepare a fresh cut

From the Folio root, make a working directory. Each run gets its own workflow history. The public repository ignores `release/`. The command prints the folder you can open in Finder or your file manager.

```sh
mkdir -p release
cut=$(mktemp -d "$PWD/release/first-cut.XXXXXX")
mkdir "$cut/brief"
example=examples/studio-session
cat "$example/editorial/subscriber-brief.md" "$example/material/transcript.json" > "$cut/brief/story-packet.txt"
printf 'Working folder: %s\n' "$cut"
```

Use this shell function to keep every command on the same workflow and state directory. Run it in the same terminal from the Folio root. The first run prepares the interview evidence. Stage `story` should say `awaiting-input`.

```sh
session() {
  action=$1
  shift
  node src/cli.mjs workflow "$action" "$example/workflow.json" --state "$cut/state" "$@"
}
session run --stage story
```

## Get a story edit

1. Open your regular ChatGPT or Claude chat. Attach `brief/story-packet.txt` from the working folder, or paste its contents. Ask **“Follow this brief and return the story JSON.”** The packet contains the transcript, two sound marks and the requested output shape. This example keeps the audio, show guide and workflow history on your computer.
2. Read the answer as an editor. Did it choose a good title? Do the opening and closing lines identify the exchange you wanted? You can change the title yourself. Each beat’s `from` field must match a line in the transcript exactly, including punctuation. For this exercise, keep the `firstKnock` cover mark inside the chosen interval.
3. Save the response as **`story.json`** in the working folder printed above, alongside `brief/`. Download a JSON file if the chat offers one, or copy the JSON into a plain-text editor. The file starts with `{` and ends with `}`. Continue to [Render and review](#render-and-review).

If you want to hear the reference cut before using any plan allowance, use the following command in place of those three steps. You can submit your own edit later.

```sh
cp "$example/editorial/story.json" "$cut/story.json"
```

## Use a personal CLI instead of the browser

After signing in as above, choose **one** of the following commands. Run it yourself from the Folio root. It places the assistant's reply in the same `story.json` that the browser route uses. Review that file before rendering. The provider processes the prompt with your account. Local video encoding uses your machine.

**Codex with ChatGPT.** The CLI reads the brief from standard input and writes the final answer to standard output. It runs with read-only filesystem access for this writing task. Use the default text output so Folio receives the answer as one document. The command clears API-key environment overrides for this invocation. Confirm ChatGPT sign-in if you previously used an API account. [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/)

```sh
(cd "$cut/brief" && env -u CODEX_API_KEY -u OPENAI_API_KEY codex exec --ephemeral --sandbox read-only - < story-packet.txt) > "$cut/story.json"
```

**Claude Code with a Claude plan.** Run this in a shell where `/status` shows your Claude subscription. Print mode uses plain answer text, and this task needs no tools. The command drops common API credential overrides for this invocation. A configured gateway, cloud provider or managed account can also determine billing. Anthropic documents how personal plan sign-in counts toward plan limits and how Console keys use API billing. [Programmatic CLI](https://code.claude.com/docs/en/headless) · [Credential precedence](https://code.claude.com/docs/en/authentication) · [How print-mode usage is billed](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans)

```sh
(cd "$cut/brief" && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude -p --tools "" --output-format text --no-session-persistence < story-packet.txt) > "$cut/story.json"
```

## Render and review

```sh
python3 -m json.tool "$cut/story.json"
session override --stage story --file "$cut/story.json"
session run
session export --stage picture --dir "$cut/preview"
session export --stage thumbnail --dir "$cut/artwork"
```

Open **`preview/interview.mp4`**, **`preview/captions.vtt`** and **`artwork/cover.png`** in your working folder. The reference selection runs **7.1 seconds**. Listen for both knocks and the pause before the guest answers. Folio takes all the original audio between the chosen endpoints. The direction adapter turns those times into this example’s waveform animation. Open `preview/timeline.json` to see how the source times map to the cut.

If you change your mind, edit `story.json`, submit another `session override` and run `session run` again. Export to fresh preview directories for a side-by-side comparison. Once you accept the picture, sound, captions and cover, finish the delivery:

```sh
session approve --stage review
session run --stage delivery
session export --stage delivery --dir "$cut/delivery"
```

Open **`delivery/listening-session.zip`**. The audience-facing files inside are `cut.mp4`, `captions.vtt` and `cover.png`. The ZIP also contains editable story and direction, the source recording, brand file and production notes. For a real channel, share the audience-facing files with viewers and keep the editing package with your production team.

## Choose how to run the next production

- **An original animated episode.** Open the kitchen guide in your assistant. Ask it to start from your premise, keep the approved character drawings and change one camera cue. The example accepts a recorded voice take, renders individual shots, and lets you review a prop revision before adopting it. For your own show, create a private series and author its defaults there. [Animated production walkthrough](../examples/kitchen-series/README.md) · [Start your own series](series/start.md)
- **Several people or subscriptions.** You can have Claude research a claim, write the script yourself and ask ChatGPT to suggest a shot. Give each contributor the inputs and required output for their stage, then use `workflow override` to accept their file. For a series, `series inspect --role …` prepares the relevant story and brand context. [Workflow handoffs](workflows.md) · [Series commands](series/commands.md)
- **Scheduled or shared automation.** Folio’s built-in API adapter uses the provider key you configure per stage. Its requests count against the API organization’s credits or billing. Eligible OpenAI Pro and Business subscribers and eligible Claude Max, Ultra and Team subscribers can claim API credits under their providers’ current terms. Check the linked organization and available credit before scheduling jobs. Personal browser or CLI sign-in stays with the official provider client. [Configure an API-backed stage](models.md) · [OpenAI subscription credit eligibility](https://developers.openai.com/api/docs/guides/chatgpt-api-credits) · [Anthropic subscription credit eligibility](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans) · [Claude Code credential guidance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)

For an original production, open your private working project in your signed-in assistant and replace the brackets in this brief. A treatment or recording is enough to start.

> Make a [length and format] film about [idea] for [audience]. My starting materials are [recording, original drawings, research notes or premise]. I want to do [writing, narration or another stage] myself. Take a first pass at [the other stages]. The recurring visual or sound choices are [defaults]. For this episode, depart from them by [one exception]. Show me the rough cut, subtitle file, cover and scene directions. Leave the final approval to me.

## If something stops

| What you see | How to continue |
| --- | --- |
| `codex` or `claude` is missing, or your workspace doesn’t grant CLI access | Use the browser route with the same packet, or install the official client and confirm your workspace access. |
| The provider reports a plan limit or printed prose around the JSON | Check the CLI exit result and open `story.json`. Wait for your allowance, finish the edit yourself, or use the bundled reference edit. Remove any surrounding Markdown and validate the JSON before submitting. |
| Direction fails after a valid JSON submission | Inspect the failed stage’s `stderr.log` under the attempt directory printed by Folio. Check verbatim transcript lines, distinct beat IDs, valid select endpoints and the cover mark. Submit the corrected story and rerun. |
| `review` says `awaiting-approval` or export requests a new directory | Review the preview, approve the revision you want to deliver, and choose an unused export path. |
