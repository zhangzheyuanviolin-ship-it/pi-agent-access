import unittest
from unittest.mock import patch
import resource_admission as r
class Admission(unittest.TestCase):
 def sample(self,**changes):return dict({'available_bytes':40*1024**3,'swap_bytes':7*1024**2,'pageouts':12,'swapouts':3,'pressure':1},**changes)
 def run_case(self,first,last,budget=32*1024**2):
  with patch.object(r,'snapshot',side_effect=[first,last]),patch.object(r.time,'sleep'),patch.object(r,'lock_audio')as lock:
   result=r.check_resources(32*1024**3,budget);lock.assert_called_once();return result
 def test_available_estimate_does_not_add_all_inactive_anonymous_pages(self):
  vm='Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages speculative: 3.\nPages inactive: 100.\nFile-backed pages: 5.\nPageouts: 0.\nSwapouts: 0.\n'
  with patch.object(r.subprocess,'check_output',side_effect=[vm,'vm.swapusage: used = 0.00M','1']):
   value=r.snapshot();self.assertEqual(value['genuinely_free_bytes'],13*16384);self.assertEqual(value['reclaimable_file_cache_estimate_bytes'],5*16384);self.assertEqual(value['available_bytes'],18*16384)
 def test_small_static_swap_requires_all_guards(self):self.run_case(self.sample(),self.sample())
 def test_default_retains_zero_swap_policy(self):
  with self.assertRaisesRegex(RuntimeError,'交换'):self.run_case(self.sample(),self.sample(),0)
 def test_any_current_swapout_growth_refuses(self):
  for change in [{'swapouts':4},{'swap_bytes':8*1024**2}]:
   with self.assertRaisesRegex(RuntimeError,'正在换出'):self.run_case(self.sample(),self.sample(**change))
 def test_clean_file_pageout_is_not_anonymous_swap(self):self.run_case(self.sample(),self.sample(pageouts=500))
 def test_pressure_or_low_genuine_free_memory_refuses(self):
  for change in [{'pressure':2},{'available_bytes':20*1024**3}]:
   with self.assertRaises(RuntimeError):self.run_case(self.sample(),self.sample(**change))
 def test_residual_swap_budget_is_bounded(self):
  with self.assertRaises(RuntimeError):r.check_resources(1,33*1024**2)
 def test_too_much_existing_swap_refuses(self):
  with self.assertRaisesRegex(RuntimeError,'交换'):self.run_case(self.sample(swap_bytes=33*1024**2),self.sample(swap_bytes=33*1024**2))
 def test_large_reserve_is_not_reduced_by_residual_swap_allowance(self):
  for available in [95*1024**3,96*1024**3]:
   reading=self.sample(available_bytes=available,swap_bytes=14*1024**2)
   with patch.object(r,'snapshot',side_effect=[reading,reading]),patch.object(r.time,'sleep'),patch.object(r,'lock_audio'):
    if available<96*1024**3:
     with self.assertRaisesRegex(RuntimeError,'不足'):r.check_resources(96*1024**3,32*1024**2)
    else:r.check_resources(96*1024**3,32*1024**2)
if __name__=='__main__':unittest.main()
