"""Pure request normalization: no model imports, network, or filesystem reads."""
import base64, json, re, uuid

MODELS = {'minicpm': 'MiniCPM-o-4.5-F16', 'qwen': 'Qwen3-Omni-30B-A3B-Instruct-4bit'}

def tool_calls(text, tools):
    allowed = {t['function']['name'] for t in tools or [] if t.get('type') == 'function'}
    calls = []
    for match in re.finditer(r'<tool_call>\s*(.*?)\s*</tool_call>', text, re.S):
        value = json.loads(match[1])
        if value.get('name') not in allowed or not isinstance(value.get('arguments'), dict):
            raise ValueError('Model returned an undeclared function or invalid arguments')
        calls.append({'id': 'call_' + uuid.uuid4().hex, 'type': 'function', 'function': {
            'name': value['name'], 'arguments': json.dumps(value['arguments'], ensure_ascii=False)}})
    if text.count('<tool_call>') != len(calls) or text.count('</tool_call>') != len(calls):
        raise ValueError('Incomplete tool call; not a successful response')
    return re.sub(r'<tool_call>.*?</tool_call>', '', text, flags=re.S).strip(), calls

def minicpm_tool_messages(messages, tools):
    """Official tokenizer's tool header and role projection, without truncation."""
    header = ('# Tools\n\nYou may call one or more functions to assist with the user query.\n\n'
        'You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n'
        + '\n'.join(json.dumps(t,ensure_ascii=False,sort_keys=True) for t in tools or [])
        + '\n</tools>\n\nFor each function call, return a json object with function name and arguments '
        'within <tool_call></tool_call> XML tags:\n<tool_call>\n'
        '{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>')
    rows = [dict(m) for m in messages]
    if tools:
        if rows[0]['role'] == 'system':
            rows[0]['content'] += '\n\n' + header
        else:
            rows.insert(0, {'role':'system','content':header})
    for row in rows:
        if row['role'] == 'assistant' and row.get('tool_calls'):
            content = row.get('content') or ''
            for call in row['tool_calls']:
                f = call['function']
                args = f['arguments']
                if isinstance(args,str): args = json.loads(args)
                content += '\n<tool_call>\n' + json.dumps({'name':f['name'],'arguments':args},ensure_ascii=False) + '\n</tool_call>'
            row['content'] = content
        elif row['role'] == 'tool':
            row['role'] = 'user'
            row['content'] = '<tool_response>\n' + row['content'] + '\n</tool_response>'
    return rows

def data_payload(value, kind):
    if not isinstance(value, str) or not value.startswith('data:') or ';base64,' not in value:
        raise ValueError('Only inline media is accepted; remote URLs and local file paths are forbidden')
    header, encoded = value.split(';base64,', 1)
    mime = header[5:]
    allowed = {'image': {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'},
               'audio': {'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/flac': '.flac'},
               'video': {'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'}}
    suffix = allowed.get(kind, {}).get(mime)
    if suffix is None: raise ValueError('Unsupported media type')
    raw = base64.b64decode(encoded, validate=True)
    if not raw: raise ValueError('Empty media')
    return raw, suffix

def validate_request(body, model):
    if body.get('pi_media_error'): raise ValueError(str(body['pi_media_error']))
    if body.get('model') != model: raise ValueError('Wrong model')
    messages = body.get('messages')
    if not isinstance(messages, list) or not messages: raise ValueError('Messages are required')
    for message in messages:
        if not isinstance(message, dict) or message.get('role') not in {'system', 'user', 'assistant', 'tool'}:
            raise ValueError('Invalid message role')
        if not isinstance(message.get('content', ''), (str, list)) and not (message.get('role')=='assistant' and message.get('content') is None and message.get('tool_calls')):
            raise ValueError('Invalid message content')
    n = body.get('max_tokens', body.get('max_completion_tokens', 1024))
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= 32768:
        raise ValueError('Output token budget must be between 1 and 32768')
    return n
