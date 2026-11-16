# Completeness declaration

This file lists every AI tool used to produce the submission, what each one
recorded, and where the limitation of its export lies. It is meant to be read
together with `ai/session-index.csv` and `ai/sessions/`.

## Tools used

| Tool | Role | Export |
| --- | --- | --- |
| WorkBuddy desktop agent (model `deepseek-v4.1-flash`) | Planning, architecture, all code generation, verification runs, documentation | Native JSONL transcript: `ai/sessions/S-001-workbuddy.jsonl` |
| Local shell (`bash`, `npm`, `node`, `git`) | Invoked by the agent as tool calls; every command and its output is inside the JSONL | Contained in the same JSONL |
| `agent-browser` | Attempted for a visual smoke test of the built UI; installation did not complete within the working window, so no screenshot was produced | N/A — no interaction occurred |

No other AI system was used. No inline autocomplete (Copilot, Cursor Tab and the
like) was active during this work, so there is nothing of that kind to disclose.
No human assistance was provided.

## What the native export contains

`ai/sessions/S-001-workbuddy.jsonl` is the tool's own transcript, not a
reconstruction. Each line is one event, in chronological order, including:

- user messages and full assistant messages,
- every tool call with its arguments,
- every tool result, including command output, build output and test output,
- timestamps.

It therefore contains the rejected and unsuccessful steps as well, in
particular:

- the failed `npm install` that was interrupted and left `better-sqlite3`
  without a native binding (`Could not locate the bindings file`),
- the `npm start` crash caused by a stale database handle, and its fix,
- the A5 assertion that failed only under the 100,000-row dataset, and its fix,
- the `agent-browser` command that failed because the CLI was not installed.

## Known export limitations

1. **Internal reasoning is not in the transcript.** The export contains the
   assistant's visible messages and its tool calls, which is what the tool
   records; it does not contain private chain-of-thought. Every decision is
   therefore also written down in `ai/decision-log.md` and `docs/decisions.md`,
   so the reasoning can be reviewed without relying on an unavailable artefact.
2. **One session, one file.** All work happened in a single agent session. There
   is no gap between AI activity and commits because the commits were made from
   inside that session.
3. **Cut-off.** The transcript was exported immediately before the final
   packaging commit, so it covers planning, implementation, verification and
   documentation, but not the last commit itself. The commit list in
   `ai/session-index.csv` is the authoritative record of what that session
   produced.
4. **Redaction.** The transcript was produced while a personal configuration
   block containing unrelated credentials (a GitHub token, two server
   passwords and their IPs) was in the session context. Those values were
   replaced with `[REDACTED: reason]` placeholders before this file entered the
   repository. Only the credential strings changed; no prompt, response, tool
   call or command was removed or reworded. The redaction was applied
   mechanically and re-checked by searching the resulting file for each original
   string.
5. **Language.** The repository is written in English throughout, with one
   deliberate exception: this transcript is a verbatim export, and the operator's
   own prompts were not in English. Translating or paraphrasing them would
   falsify the evidence, so they are preserved as sent.

## Section 6 — written answers

`written-answers.md` was written by the candidate alone, without AI assistance,
including without translation or language polishing, as required by the brief.
No AI tool read, drafted, outlined, summarised, rephrased or proofread it.

## Candidate sign-off

- [ ] I confirm the session export covers all AI work on this submission.
- [ ] I confirm no credentials or third-party private data remain in the
      submission.
- [ ] I confirm `written-answers.md` was produced without AI assistance.
