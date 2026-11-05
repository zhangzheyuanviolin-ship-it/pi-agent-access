import json
import threading
import unittest
from minicpm_session import MiniCPMSession


class Socket:
    def __init__(self):
        self.sent = []
        self.closed = False
        self.events = [{'type': 'session.created'}]

    def send(self, value):
        value = json.loads(value)
        self.sent.append(value)
        if value['type'] == 'input.append':
            self.events += [{'kind': 'text', 'text': 'answer'}, {
                'type': 'response.done', 'metrics': {'kv_cache_length': 100}}]

    def recv(self, **kwargs):
        return json.dumps(self.events.pop(0))

    def close(self):
        self.closed = True


class PrefixTest(unittest.TestCase):
    def setUp(self):
        self.sockets = []
        def connect(*args, **kwargs):
            sock = Socket()
            self.sockets.append(sock)
            return sock
        self.client = MiniCPMSession(12352, connect)
        self.first = [{'role': 'user', 'content': 'original'}]

    def call(self, messages, **kwargs):
        return list(self.client.events(messages, lambda rows: rows, **kwargs))

    def history(self):
        return self.first + [{'role': 'assistant', 'content': 'answer'}, {
            'role': 'user', 'content': 'next'}]

    def test_only_new_user_is_prefilled_on_exact_append(self):
        self.call(self.first)
        out = self.call(self.history())
        self.assertEqual(len(self.sockets), 1)
        self.assertEqual(self.sockets[0].sent[-1]['input']['messages'], self.history()[-1:])
        self.assertEqual(out[-1]['metrics']['prompt_tokens_details']['cached_tokens'], 100)

    def test_edit_replays_complete_history(self):
        self.call(self.first)
        history = self.history()
        history[0] = {'role': 'user', 'content': 'edited'}
        out = self.call(history)
        self.assertTrue(self.sockets[0].closed)
        self.assertEqual(self.sockets[1].sent[-1]['input']['messages'], history)
        self.assertEqual(out[-1]['metrics']['prompt_tokens_details']['cached_tokens'], 0)

    def test_media_identity_participates_in_prefix(self):
        self.first[0]['content'] = [{'type': 'audio_url', 'audio_url': {'url': 'data:audio/wav;base64,eA=='}}]
        self.call(self.first)
        history = self.history()
        history[0] = {'role': 'user', 'content': [{'type': 'audio_url', 'audio_url': {'url': 'data:audio/wav;base64,eQ=='}}]}
        self.call(history)
        self.assertEqual(len(self.sockets), 2)

    def test_speech_mode_change_is_cold(self):
        self.call(self.first)
        self.call(self.history(), speech=True)
        self.assertEqual(len(self.sockets), 2)

    def test_cancellation_invalidates_owner(self):
        self.call(self.first)
        cancel = threading.Event()
        cancel.set()
        self.call(self.history(), cancel=cancel)
        self.assertIsNone(self.client.ws)
        self.assertEqual(self.client.prefix, [])

    def test_generator_close_invalidates_incomplete_owner(self):
        gen = self.client.events(self.first, lambda rows: rows)
        next(gen)
        gen.close()
        self.assertTrue(self.sockets[0].closed)
        self.assertEqual(self.client.prefix, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
