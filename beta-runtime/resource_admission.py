"""Conservative physical-memory admission for the independent beta only.
Residual swap is allowed only by an explicit small per-model budget, with normal
kernel pressure, no observed pageout/swapout growth, sufficient genuinely free
pages, and a successful audio mlock. Inactive model pages are NOT counted free.
"""
import ctypes,re,subprocess,time

def snapshot():
 vm=subprocess.check_output(['/usr/bin/vm_stat'],text=True,timeout=3)
 page=int(re.search(r'page size of (\d+)',vm)[1]);counts={k:int(v)for k,v in re.findall(r'([^\n:]+):\s+(\d+)\.',vm)}
 swap=subprocess.check_output(['/usr/sbin/sysctl','vm.swapusage'],text=True,timeout=3)
 match=re.search(r'used = ([\d.]+)([KMG])',swap)
 if not match:raise RuntimeError('无法核实交换内存，未启动测试推理')
 pressure=int(subprocess.check_output(['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],text=True,timeout=3))
 return {'available_bytes':page*(counts['Pages free']+counts['Pages speculative']),
         'swap_bytes':float(match[1])*{'K':1024,'M':1024**2,'G':1024**3}[match[2]],
         'pageouts':counts['Pageouts'],'swapouts':counts['Swapouts'],'pressure':pressure}

def lock_audio():
 buf=ctypes.create_string_buffer(65536);lib=ctypes.CDLL(None)
 lib.mlock.argtypes=[ctypes.c_void_p,ctypes.c_size_t];lib.munlock.argtypes=lib.mlock.argtypes
 if lib.mlock(buf,len(buf))!=0:raise RuntimeError('语音内存锁定不可用，未启动测试推理')
 lib.munlock(buf,len(buf))

def check_resources(minimum_available_bytes,maximum_existing_swap_bytes=0):
 if maximum_existing_swap_bytes<0 or maximum_existing_swap_bytes>32*1024**2:raise RuntimeError('测试模型交换内存预算无效')
 first=snapshot();time.sleep(.5);last=snapshot()
 if any(s['pressure']!=1 for s in [first,last]):raise RuntimeError('系统内存压力升高，未启动测试推理')
 if last['pageouts']!=first['pageouts'] or last['swapouts']!=first['swapouts'] or last['swap_bytes']>first['swap_bytes']:
  raise RuntimeError('系统正在换出内存，未启动测试推理')
 if max(first['swap_bytes'],last['swap_bytes'])>maximum_existing_swap_bytes:raise RuntimeError('现有交换内存超过测试模型预算，未启动测试推理')
 if min(first['available_bytes'],last['available_bytes'])<minimum_available_bytes:raise RuntimeError('实际空闲内存不足，未启动测试模型；没有回收稳定版模型内存')
 lock_audio()
 return {'before':first,'confirmed':last,'minimum_available_bytes':minimum_available_bytes,'maximum_existing_swap_bytes':maximum_existing_swap_bytes}
