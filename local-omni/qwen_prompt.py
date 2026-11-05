"""Beta-only Instruct template adapter; no transcript edits or token filtering.

Instruct uses the official plain assistant prefix. Do not add Qwen3 Thinking's
empty think delimiter: real audio/visual requests degenerated at that prefix.
Render historical assistants consistently, including tool-call rounds, so the
previous generation prefix remains a literal prefix of the next request.
"""

ASSISTANT_START = '    {%- elif message.role == "assistant" %}'
TOOLS_START = '    {%- if message.tool_calls %}'


def stable_template(template):
    if not isinstance(template, str) or template.count(ASSISTANT_START) != 1:
        raise ValueError('Unsupported Qwen Omni chat template; review before inference')
    start = template.index(ASSISTANT_START)
    end = template.find(TOOLS_START, start)
    if end < 0 or 'content.lstrip' not in template[start:end]:
        raise ValueError('Unexpected Qwen assistant template; no silent fallback')
    head = ASSISTANT_START + "\n        {{- '<|im_start|>assistant\\n' + content }}\n"
    return template[:start] + head + template[end:]
