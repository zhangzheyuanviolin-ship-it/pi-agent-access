import asyncio,base64,unittest,threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from live import QwenLiveSession
class Runtime:
 def __init__(self):self.requests=[];self.thread_ids=[]
 def speech_events(self,prompt,**kwargs):
  self.thread_ids.append(threading.get_ident());self.requests.append(kwargs)
  yield {'type':'text','text':'蓝色方形'}
  yield {'type':'audio','pcm':np.ones(240,dtype='float32')*.1}
class Backend:
 def __init__(self):self.busy=True;self.runtime=Runtime();self.executor=ThreadPoolExecutor(max_workers=1)
class QwenLiveTest(unittest.IsolatedAsyncioTestCase):
 async def test_vad_stream_and_lease(self):
  b=Backend();session=QwenLiveSession(b);await session.start()
  def audio(level):return base64.b64encode(np.full(16000,level,dtype='<f4').tobytes()).decode()
  await session.append({'audio':audio(.1)});self.assertEqual(b.runtime.requests,[])
  await session.append({'audio':audio(0)});await session.append({'audio':audio(0)})
  await asyncio.wait_for(session.speech_task,5)
  self.assertTrue(b.busy);self.assertEqual(len(b.runtime.requests),1)
  events=[]
  while not session.events.empty():events.append(session.events.get_nowait())
  self.assertEqual([e.get('kind')for e in events],['text','audio',None]);self.assertNotEqual(b.runtime.thread_ids[0],threading.get_ident())
  self.assertTrue((await session.interrupt())['interrupted']);await session.stop();self.assertFalse(b.busy);self.assertTrue(session.closed);b.executor.shutdown()
 async def test_bad_audio_and_frame_never_reach_model(self):
  b=Backend();s=QwenLiveSession(b);await s.start()
  with self.assertRaises(ValueError):await s.append({'audio':'!!!!'})
  with self.assertRaises(ValueError):await s.append({'audio':base64.b64encode(np.ones(16000,dtype='<f4').tobytes()).decode(),'frame':base64.b64encode(b'not an image').decode()})
  self.assertEqual(b.runtime.requests,[]);await s.stop();b.executor.shutdown()
if __name__=='__main__':unittest.main(verbosity=2)
