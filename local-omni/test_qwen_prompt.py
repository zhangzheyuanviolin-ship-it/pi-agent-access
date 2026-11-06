import threading
import types
import unittest
from unittest.mock import patch, Mock
from qwen_prompt import stable_template


class QwenPromptTest(unittest.TestCase):
    def test_runtime_uses_instruct_default_without_thinking_disable_marker(self):
        from omni_runtime import QwenOmniRuntime
        r=QwenOmniRuntime.__new__(QwenOmniRuntime)
        template='    {%- elif message.role == "assistant" %}content.lstrip\n    {%- if message.tool_calls %}'
        r.processor=types.SimpleNamespace(chat_template=template,apply_chat_template=Mock(return_value='plain assistant'))
        r.model=types.SimpleNamespace(language_model=types.SimpleNamespace())
        with patch.dict('sys.modules',{'mlx_vlm.utils':types.SimpleNamespace(prepare_inputs=lambda *a,**kw:{})}):
            formatted,_=r._prepare('hello')
        self.assertEqual(formatted,'plain assistant')
        self.assertNotIn('enable_thinking',r.processor.apply_chat_template.call_args.kwargs)

    def test_unknown_template_is_rejected(self):
        for template in [None, '', 'old template']:
            with self.assertRaises(ValueError):
                stable_template(template)

    def test_old_assistant_delimiters_and_new_generation_prefix_match(self):
        from jinja2 import Environment
        template = '''{%- for message in messages %}
{%- set content = message.content %}
{%- if message.role == "user" %}{{ '<|im_start|>user\n' + content + '<|im_end|>\n' }}
    {%- elif message.role == "assistant" %}
        {{ content.lstrip('\n') }}
    {%- if message.tool_calls %}{{ 'tool branch preserved' }}{%- endif %}
{{- '<|im_end|>\n' }}{%- endif %}{%- endfor %}
{%- if add_generation_prompt %}{{ '<|im_start|>assistant\n' }}{%- endif %}'''
        render = Environment().from_string(stable_template(template)).render
        first = [{'role': 'user', 'content': 'original'}]
        prefix = ''
        old = render(messages=first, add_generation_prompt=True) + prefix
        answer = prefix + 'exact answer'
        later = first + [{'role': 'assistant', 'content': answer}, {'role': 'user', 'content': 'next'}]
        new = render(messages=later, add_generation_prompt=True) + prefix
        self.assertTrue(new.startswith(old + 'exact answer<|im_end|>\n'))
        self.assertEqual(later[1]['content'], answer)
        self.assertNotIn('<think>',new)

    def test_no_early_whitespace_or_hidden_transcript_prefix(self):
        from omni_runtime import QwenOmniRuntime
        r = QwenOmniRuntime.__new__(QwenOmniRuntime)
        r.lock = threading.Lock();r.media_signature='same';r.prompt_cache=object()
        r._media_identity=lambda *a:'same'
        r._prepare=lambda *a:('prompt',{})
        entered=[]
        def generate(*a, **kw):
            entered.append(True)
            yield types.SimpleNamespace(text='',prompt_tokens=10,generation_tokens=1,cached_tokens=0)
            yield types.SimpleNamespace(text='answer',prompt_tokens=10,generation_tokens=2,cached_tokens=0)
        core=types.SimpleNamespace(random=types.SimpleNamespace(seed=lambda s:None))
        modules={'mlx':types.SimpleNamespace(core=core),'mlx.core':core,
                 'mlx_vlm':types.SimpleNamespace(stream_generate=generate),
                 'mlx_vlm.generate':types.SimpleNamespace(PromptCacheState=object)}
        r.model=object();r.processor=object()
        with patch.dict('sys.modules', modules):
            events=r.text_events(audio=['recording'])
            first=next(events)
            self.assertTrue(entered)
            self.assertEqual(first['text'],'answer')
            rest=list(events)
        self.assertEqual([e['type']for e in rest],['done'])

    def test_native_speech_tool_delimiters_survive_and_never_enter_talker(self):
        from omni_runtime import QwenOmniRuntime
        r=QwenOmniRuntime.__new__(QwenOmniRuntime)
        r.lock=threading.Lock();r.speech_media=None;r.speech_cache=object()
        r.speech_usage={'prompt_tokens':20};r._prepare=lambda *a:('',{})
        reached=[];closed=[]
        def generate(**kw):
            try:
                yield 'text',[100,101,151645]
                reached.append('talker')
                yield 'audio',None
            finally:closed.append(True)
        def decode(tokens,skip_special_tokens):
            self.assertEqual(tokens,[100,101])
            self.assertFalse(skip_special_tokens)
            return '<tool_call>{"name":"read","arguments":{"path":"fixture"}}</tool_call>'
        r.model=types.SimpleNamespace(generate_stream=generate)
        r.processor=types.SimpleNamespace(tokenizer=types.SimpleNamespace(
            eos_token_id=151645,decode=decode))
        core=types.SimpleNamespace(random=types.SimpleNamespace(seed=lambda s:None))
        with patch.dict('sys.modules',{'mlx':types.SimpleNamespace(core=core),'mlx.core':core}):
            events=list(r.speech_events('read it',tools=[{'type':'function',
                'function':{'name':'read'}}]))
        self.assertEqual([e['type'] for e in events],['text','done'])
        self.assertIn('<tool_call>',events[0]['text'])
        self.assertEqual(reached,[]);self.assertEqual(closed,[True])


if __name__=='__main__':unittest.main(verbosity=2)
