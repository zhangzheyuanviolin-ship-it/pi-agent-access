"""One native KV owner. Exact append reuse; no fuzzy matching or hidden replay.

Only hashes of canonical incoming messages are retained outside the engine.
Any edit, branch, speech-mode change, error, or cancellation closes the owner.
The next request replays its complete supplied content in a fresh native session.
"""
import hashlib
import json
import re
import time


def message_hash(message):
    # Provider adapters may attach harmless bookkeeping outside role/content.
    value = {k: message[k] for k in ('role', 'content','tool_calls','tool_call_id','name') if k in message}
    if value.get('role')=='assistant':
        value['content']=value.get('content') or ''
        if value.get('tool_calls'):
            calls=[]
            for call in value['tool_calls']:
                function=dict(call['function'])
                if isinstance(function.get('arguments'),str):
                    function['arguments']=json.loads(function['arguments'])
                calls.append({**call,'function':function})
            value['tool_calls']=calls
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


DELIVERY_SUFFIX=re.compile(r'\n\n\[播放或下载语音\]\(/api/local-omni/audio/([0-9a-f]{32}\.wav)\)$')
def project_delivery_messages(messages,deliveries):
    """Append owned UI delivery metadata as its own turn, preserving native KV.

    The generated answer is already in native KV; the URI is added by Pi after
    generation. Split only an exact backend-owned suffix and matching answer
    hash. No text is discarded, history is untouched, and edits still replay.
    """
    result=[]
    for message in messages:
        row=dict(message);row.pop('_pi_delivery_meta',None)
        text=row.get('content');match=DELIVERY_SUFFIX.search(text)if row.get('role')=='assistant'and isinstance(text,str)else None
        if match and deliveries.get(match[1])==hashlib.sha256(text[:match.start()].encode()).hexdigest():
            result.append({**row,'content':text[:match.start()]})
            result.append({'role':'assistant','content':text[match.start():],'_pi_delivery_meta':True})
        else:result.append(row)
    return result


class MiniCPMSession:
    def __init__(self, port, connect=None, after_init=None):
        if connect is None:
            from websockets.sync.client import connect
        self.connect = connect
        self.after_init = after_init
        self.url = f'ws://127.0.0.1:{port}/backend'
        self.ws = None
        self.prefix = []
        self.kv_length = 0
        self.speech = False
        self.tool_key = None

    def close(self):
        ws, self.ws = self.ws, None
        self.prefix = []
        self.kv_length = 0
        if ws is not None:
            ws.close()

    def can_append(self, messages, speech, tool_key=None):
        return bool(self.ws is not None and speech == self.speech and self.prefix
                    and tool_key == self.tool_key
                    and len(messages) > len(self.prefix)
                    and all(m.get('role') in ('user','tool') or (m.get('role')=='assistant' and m.get('_pi_delivery_meta')is True) for m in messages[len(self.prefix):])
                    and [message_hash(m) for m in messages[:len(self.prefix)]] == self.prefix)

    def events(self, messages, normalize, speech=False, max_tokens=1024, cancel=None, tools=None, assistant_message=None):
        tool_key=json.dumps(tools,sort_keys=True,ensure_ascii=False) if tools else None
        reuse = self.can_append(messages, speech, tool_key)
        prefix_length=len(self.prefix)
        cached = self.kv_length if reuse else 0
        reason = 'exact_append' if reuse else ('prefix_or_mode_changed' if self.ws else 'cold')
        init_ms=0.0
        if not reuse:
            init_started=time.monotonic()
            self.close()
            self.ws = self.connect(self.url, proxy=None, open_timeout=10,
                                   max_size=64*1024*1024, close_timeout=10)
            self.speech = speech
            self.tool_key = tool_key
            self.ws.send(json.dumps({'type': 'session.init', 'payload': {
                'mode': 'turn_based', 'use_tts': True}}))
            created = json.loads(self.ws.recv(timeout=180))
            if created.get('type') != 'session.created':
                self.close()
                raise RuntimeError(str(created))
            try:
                if self.after_init:self.after_init()
            except Exception:
                self.close();raise
            init_ms=(time.monotonic()-init_started)*1000
        complete = False
        text = ''
        try:
            prepared = normalize(messages[prefix_length:] if reuse else messages)
            self.ws.send(json.dumps({'type': 'input.append', 'input': {
                'messages': prepared, 'streaming': True,
                'generation': {'max_new_tokens': max_tokens},
                'tts': {'enabled': speech}, 'omni_mode': True,
                'enable_thinking': False}}))
            deadline = time.monotonic() + 300
            while True:
                if cancel is not None and cancel.is_set():
                    return
                if time.monotonic() > deadline:
                    raise TimeoutError('MiniCPM produced no completion within the request deadline')
                try:
                    event = json.loads(self.ws.recv(timeout=.5))
                except TimeoutError:
                    continue
                if event.get('type') in ('error', 'session.closed'):
                    raise RuntimeError(str(event))
                if event.get('kind') == 'text':
                    text += event.get('text', '')
                if event.get('type') == 'response.done':
                    metrics = event.setdefault('metrics', {})
                    self.kv_length = metrics.get('kv_cache_length', 0)
                    metrics['prompt_tokens_details'] = {'cached_tokens': cached}
                    metrics['native_session_init_ms'] = init_ms
                    metrics['native_prefix_reused'] = reuse
                    metrics['native_prefix_reason'] = reason
                    reply=assistant_message(text) if assistant_message else {'role':'assistant','content':text}
                    event['assistant_message']=reply
                    self.prefix = [message_hash(m) for m in messages] + [message_hash(reply)]
                    complete = True
                yield event
                if complete:
                    break
        finally:
            if not complete:
                self.close()
