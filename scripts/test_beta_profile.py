import unittest,importlib.util,tempfile
from pathlib import Path
class ProfileRegression(unittest.TestCase):
 def setUp(self):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
 def test_new_profile_does_not_reintroduce_aggressive_deepseek_residency(self):
  path=Path(__file__).resolve().parent/'setup-beta-profile.py'
  # Packaged runtimes do not include the developer-only setup script; the source
  # suite exercises this constructor before staging the resulting private recipe.
  if not path.exists():raise RuntimeError('Run profile-constructor test from the source tree')
  spec=importlib.util.spec_from_file_location('beta_profile_setup',path)
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  original={'id':'DeepSeek-V4.1-Flash-1017-Sushi-STQ-1.75bpw','engine':'sushi','port':12350,
   'args':['sushi','--port','12350','--ssd-budget-gb','108','--prefix-cache-mem','8GB','--prefix-cache-disk','128GB','--ctx-size','1048576']}
  result=module.beta_catalog([original],self.root)[0]
  self.assertEqual(original['args'][4],'108')
  self.assertEqual(result['args'][4],'96')
  self.assertEqual(result['args'][5:],original['args'][5:])
if __name__=='__main__':unittest.main()
