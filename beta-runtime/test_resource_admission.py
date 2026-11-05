import unittest
from unittest.mock import patch
import resource_admission as r
class Admission(unittest.TestCase):
 def sample(self,**changes):return dict({'available_bytes':40*1024**3,'swap_bytes':7*1024**2,'pageouts':12,'swapouts':3,'pressure':1},**changes)
 def run_case(self,first,last,budget=32*1024**2):
  with patch.object(r,'snapshot',side_effect=[first,last]),patch.object(r.time,'sleep'),patch.object(r,'lock_audio')as lock:
   result=r.check_resources(32*1024**3,budget);lock.assert_called_once();return result
 def test_small_static_swap_requires_all_guards(self):self.run_case(self.sample(),self.sample())
 def test_default_retains_zero_swap_policy(self):
  with self.assertRaisesRegex(RuntimeError,'交换'):self.run_case(self.sample(),self.sample(),0)
 def test_any_current_swap_or_pageout_growth_refuses(self):
  for change in [{'pageouts':13},{'swapouts':4},{'swap_bytes':8*1024**2}]:
   with self.assertRaisesRegex(RuntimeError,'正在换出'):self.run_case(self.sample(),self.sample(**change))
 def test_pressure_or_low_genuine_free_memory_refuses(self):
  for change in [{'pressure':2},{'available_bytes':20*1024**3}]:
   with self.assertRaises(RuntimeError):self.run_case(self.sample(),self.sample(**change))
 def test_residual_swap_budget_is_bounded(self):
  with self.assertRaises(RuntimeError):r.check_resources(1,33*1024**2)
 def test_too_much_existing_swap_refuses(self):
  with self.assertRaisesRegex(RuntimeError,'交换'):self.run_case(self.sample(swap_bytes=33*1024**2),self.sample(swap_bytes=33*1024**2))
if __name__=='__main__':unittest.main()
