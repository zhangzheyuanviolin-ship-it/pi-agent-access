"""Offline/loopback regression. No weights, Metal, torch, or production gateway."""
import unittest, time, base64, json, threading
from aiohttp import web, ClientSession
from backend import make_app
from protocol import data_payload, tool_calls, validate_request

class Fake:
    model='MiniCPM-o-4.5-F16'; engine='minicpm'; config={'context':8192}; admission={}; busy=False
    def events(self, body, cancel):
        for text in ['第一段','第二段']:
            if cancel.is_set(): return
            yield {'type':'text','text':text}
            time.sleep(.08)
        yield {'type':'done','usage':{}}

class ProtocolTest(unittest.TestCase):
    def test_no_local_or_remote_media_reads(self):
        for url in ['file:///etc/passwd','http://localhost/test','/etc/passwd']:
            with self.assertRaises(ValueError): data_payload(url,'image')
    def test_media_validation(self):
        self.assertEqual(data_payload('data:image/png;base64,eA==','image'),(b'x','.png'))
        with self.assertRaises(ValueError): data_payload('data:application/octet-stream;base64,eA==','image')
        with self.assertRaises(ValueError): data_payload('data:image/png;base64,!!!!','image')
    def test_native_tool_parser(self):
        tool=[{'type':'function','function':{'name':'lookup'}}]
        content,calls=tool_calls('<tool_call>{"name":"lookup","arguments":{"id":7}}</tool_call>',tool)
        self.assertEqual(content,''); self.assertEqual(calls[0]['function']['arguments'],'{"id": 7}')
        with self.assertRaises(ValueError): tool_calls('<tool_call>{"name":"shell","arguments":{}}</tool_call>',tool)
        with self.assertRaises(ValueError): tool_calls('<tool_call>{',tool)
    def test_request_budget(self):
        with self.assertRaises(ValueError): validate_request({'model':'x','messages':[]},'x')
        with self.assertRaises(ValueError): validate_request({'model':'x','messages':[{'role':'user','content':'hi'}],'max_tokens':True},'x')

class HttpTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.backend=Fake();self.runner=web.AppRunner(make_app(self.backend));await self.runner.setup()
        self.site=web.TCPSite(self.runner,'127.0.0.1',0);await self.site.start()
        self.url='http://127.0.0.1:'+str(self.site._server.sockets[0].getsockname()[1]);self.client=ClientSession()
    async def asyncTearDown(self):
        await self.client.close();await self.runner.cleanup()
    def body(self,**kw): return {'model':self.backend.model,'messages':[{'role':'user','content':'hi'}],**kw}
    async def test_models_and_json(self):
        async with self.client.get(self.url+'/v1/models')as r:self.assertEqual((await r.json())['data'][0]['id'],self.backend.model)
        async with self.client.post(self.url+'/v1/chat/completions',json=self.body())as r:self.assertEqual((await r.json())['choices'][0]['message']['content'],'第一段第二段')
    async def test_incremental_sse(self):
        async with self.client.post(self.url+'/v1/chat/completions',json=self.body(stream=True))as r:
            first=await r.content.readline();start=time.monotonic();rest=await r.text()
            self.assertIn('第一段',first.decode());self.assertIn('第二段',rest);self.assertIn('[DONE]',rest);self.assertGreater(time.monotonic()-start,.06)
    async def test_busy_and_invalid_tools(self):
        self.backend.busy=True
        async with self.client.post(self.url+'/v1/chat/completions',json=self.body())as r:self.assertEqual(r.status,429)
        self.backend.busy=False
        async with self.client.post(self.url+'/v1/chat/completions',json=self.body(tools=[{'type':'function'}]))as r:self.assertEqual(r.status,400)
    async def test_error_never_success(self):
        def fail(body,cancel): raise RuntimeError('fixture fail');yield
        self.backend.events=fail
        async with self.client.post(self.url+'/v1/chat/completions',json=self.body())as r:self.assertEqual(r.status,502)
    async def test_cancel_keeps_lease_until_worker_exits(self):
        entered=threading.Event();finished=threading.Event()
        def slow(body,cancel):
            yield {'type':'text','text':'start'};entered.set()
            cancel.wait(5);time.sleep(.1);finished.set()
        self.backend.events=slow
        r=await self.client.post(self.url+'/v1/chat/completions',json=self.body(stream=True));await r.content.readline();r.close()
        self.assertTrue(self.backend.busy)
        import asyncio
        for _ in range(40):
            if finished.is_set() and not self.backend.busy:break
            await asyncio.sleep(.1)
        self.assertTrue(finished.is_set());self.assertFalse(self.backend.busy)

class BetaNativeOwnershipTest(unittest.TestCase):
    def test_occupied_native_port_never_spawns_or_attaches(self):
        from backend import Backend
        from unittest.mock import patch
        import socket,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory()as tmp,socket.socket()as listener:
            listener.bind(('127.0.0.1',0));listener.listen()
            config={'binary':'/unused','native_port':listener.getsockname()[1],'model_path':'/unused','engine_log':str(Path(tmp)/'engine.log'),'ffmpeg':'/unused/ffmpeg'}
            model=Backend('minicpm',config)
            with patch.dict('os.environ',{'PI_ACCESS_PROFILE':'beta'}),patch('backend.preflight',return_value={}),patch('backend.subprocess.Popen')as spawn:
                with self.assertRaisesRegex(RuntimeError,'端口已占用'):model.start()
                spawn.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
