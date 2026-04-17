---
name: gemini-search
description: Delegate web searches to Gemini CLI when fresh, grounded, or broad web information is needed. Gemini's grounded search returns well-summarized results; use it to offload search work and keep the main context clean. Triggers include requests for current news/prices/release notes/docs newer than the knowledge cutoff, broad multi-source synthesis, or when built-in WebSearch returns sparse results.
---

# Gemini Web Search Skill

Use Gemini as a search sidekick. Gemini's grounded search often returns
fresher, better-summarized web results than WebSearch for many topics.

## When to use

- Current events, prices, release notes, or docs newer than the knowledge cutoff.
- Broad multi-source synthesis on a topic.
- WebSearch returned sparse or off-topic results.
- Batching several related lookups — delegating keeps the main context clean.

## How to invoke

Run the helper script with the query as a single argument:

```bash
.claude/skills/gemini-search/search.sh "latest stable Node.js LTS version and release date"
```

The script prints Gemini's grounded answer to stdout. Read and synthesize the
result — do not paste raw output to the user verbatim.

## Tips

- Phrase the query as a clear natural-language question. Include year, version,
  or platform when relevant.
- For multiple independent lookups, call the script several times in parallel
  (multiple Bash tool calls in one message).
- If Gemini refuses or returns "I don't know", fall back to WebSearch.

## Requirements

The `gemini` CLI must be installed and authenticated. The script exits non-zero
if it is missing.
