"""Fail-closed isolation checks; no model load or stable service mutation."""
import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
import beta_gateway as beta

class Isolation(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.root_patch=patch.object(beta,'ROOT',self.root);self.root_patch.start();self.addCleanup(self.root_patch.stop)
  self.model={'id':'fixture','engine':'sushi','port':12445,'args':['/read-only/engine','--host','127.0.0.1','--port','12445','--log-file',str(self.root/'engine.log')],'environment':{'SUSHI_PREFIX_CACHE_DIR':str(self.root/'cache')}}
 def test_accept_own_paths(self):beta.validate_catalog([self.model])
 def test_deny_shared_gateway_and_stable_port(self):
  for port in [12345,12349,12449,38471]:
   m=copy.deepcopy(self.model);m['port']=port
   with self.assertRaises(RuntimeError):beta.validate_catalog([m])
 def test_deny_recipe_port_drift_and_external_storage(self):
  for mutate in [lambda m:m['args'].__setitem__(4,'12345'),lambda m:m['environment'].__setitem__('SUSHI_PREFIX_CACHE_DIR','/stable/cache'),lambda m:m['args'].__setitem__(-1,'/stable/log')]:
   m=copy.deepcopy(self.model);mutate(m)
   with self.assertRaises(RuntimeError):beta.validate_catalog([m])
 def test_deny_symlink_escape(self):
  (self.root/'escape').symlink_to('/tmp',target_is_directory=True)
  self.model['environment']['SUSHI_PREFIX_CACHE_DIR']=str(self.root/'escape/cache')
  with self.assertRaises(RuntimeError):beta.validate_catalog([self.model])
 def test_deny_duplicate_ports_and_ids(self):
  with self.assertRaises(RuntimeError):beta.validate_catalog([self.model,self.model])
 def test_stable_unavailable_does_not_call_parent_manager(self):
  manager=beta.BetaManager([],Path('/unused'))
  with patch.object(beta,'stable_idle',side_effect=RuntimeError('stable busy')),patch.object(beta.core.Manager,'ensure')as parent:
   with self.assertRaisesRegex(RuntimeError,'stable busy'):manager.ensure(self.model)
   parent.assert_not_called()
 def test_omni_native_port_and_config_outputs_are_isolated(self):
  config=self.root/'mini.json';config.write_text(json.dumps({'native_port':12452,'output_dir':str(self.root/'audio'),'engine_log':str(self.root/'native.log')}))
  model={'id':'MiniCPM-o-4.5-F16','engine':'omni','port':12454,'args':['python',str(Path(beta.__file__).resolve().parents[1]/'local-omni/backend.py'),'--engine','minicpm','--config',str(config),'--port','12454']}
  beta.validate_catalog([model])
  for change in [{'native_port':12352},{'native_port':12449},{'output_dir':'/stable/audio'}]:
   value=json.loads(config.read_text());original=dict(value);value.update(change);config.write_text(json.dumps(value))
   with self.assertRaises(RuntimeError):beta.validate_catalog([model])
   config.write_text(json.dumps(original))
 def test_matching_port_without_owned_child_is_not_adopted(self):
  manager=beta.BetaManager([self.model],Path('/unused'))
  with patch.object(beta,'stable_idle'),patch.object(beta.core,'owner_pid',return_value=99999),patch.object(beta.core.Manager,'ensure')as parent:
   with self.assertRaisesRegex(RuntimeError,'非本轮'):manager.ensure(self.model)
   parent.assert_not_called()
 def test_live_loaded_probe_never_contacts_an_unknown_process(self):
  manager=beta.BetaManager([self.model],Path('/unused'))
  with patch.object(beta.core,'owner_pid',return_value=99999),patch.object(beta.core.Manager,'loaded')as parent:
   self.assertFalse(manager.loaded(self.model));parent.assert_not_called()
 def test_spawn_and_reload_both_require_admission(self):
  # Exercise the real manager with a reachable unloaded fake Sushi backend.
  manager=beta.BetaManager([],Path('/unused'))
  with patch.object(beta,'stable_idle'),patch.object(manager,'loaded',return_value=False),patch.object(beta,'admission',side_effect=RuntimeError('reserve')),patch.object(beta.core,'api')as api:
   with self.assertRaisesRegex(RuntimeError,'reserve'):manager.ensure(self.model)
   api.assert_not_called()
 def test_new_swap_after_load_prevents_forwarding_and_releases_only_owned_load(self):
  manager=beta.BetaManager([],Path('/unused'))
  def load(target):manager.load_admission={'confirmed':{'swapouts':3,'swap_bytes':14}}
  with patch.object(beta,'stable_idle'),patch.object(beta.core.Manager,'ensure',side_effect=load),patch('resource_admission.check_resources',return_value={'confirmed':{'swapouts':4,'swap_bytes':14}}),patch.object(manager,'_release_rejected_load')as cleanup:
   with self.assertRaisesRegex(RuntimeError,'新增交换'):manager.ensure(self.model)
   cleanup.assert_called_once_with(self.model)
 def test_rejected_load_cleanup_never_kills_unknown_or_busy_process(self):
  manager=beta.BetaManager([],Path('/unused'));child=Mock(pid=900);child.poll.return_value=None
  with patch.object(beta.core,'owner_pid',return_value=900),patch.object(beta.os,'getpgid',return_value=900),patch.object(beta.os,'killpg')as kill:
   self.assertFalse(manager._release_rejected_load(self.model));kill.assert_not_called()
   manager.children[self.model['id']]=child
   with patch.object(beta.core,'other_backend_busy',return_value=True):
    self.assertFalse(manager._release_rejected_load(self.model));kill.assert_not_called()

if __name__=='__main__':unittest.main()
