"""Conservative physical-memory admission for the independent beta only.
Residual swap is allowed only by an explicit small per-model budget, with normal
kernel pressure, no observed anonymous swapout growth, sufficient genuinely free
pages plus pageable file-backed pages, and a successful audio mlock.
Anonymous inactive model/KV pages are not added to the available estimate.
"""
import ctypes,re,subprocess,time

class MemoryReserveError(RuntimeError):
 """A proven resource shortage, distinct from pressure/swap/ownership failure."""

def snapshot():
 vm=subprocess.check_output(['/usr/bin/vm_stat'],text=True,timeout=3)
 page=int(re.search(r'page size of (\d+)',vm)[1]);counts={k:int(v)for k,v in re.findall(r'([^\n:]+):\s+(\d+)\.',vm)}
 swap=subprocess.check_output(['/usr/sbin/sysctl','vm.swapusage'],text=True,timeout=3)
 match=re.search(r'used = ([\d.]+)([KMG])',swap)
 if not match:raise RuntimeError('无法核实交换内存，未启动测试推理')
 pressure=int(subprocess.check_output(['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],text=True,timeout=3))
 genuine=page*(counts['Pages free']+counts['Pages speculative'])
 # XNU external_page_count counts pageable file-backed (non-swap) pages.
 # These may be active after a model exits. Capping them at ALL inactive pages
 # falsely rejected DeepSeek with no models alive and ~108GB of file cache.
 # Never add anonymous inactive pages or wired GPU allocations as reclaimable.
 file_cache=page*counts['File-backed pages']
 return {'available_bytes':genuine+file_cache,'genuinely_free_bytes':genuine,'reclaimable_file_cache_estimate_bytes':file_cache,
         'inactive_file_cache_lower_estimate_bytes':page*min(counts['Pages inactive'],counts['File-backed pages']),
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
 # XNU Pageouts also counts file-backed pager writes. Only compressor Swapouts
 # and swap usage growth indicate new anonymous disk swap; retain both counters.
 if any(s['pressure']!=1 for s in [first,last]):raise RuntimeError('系统内存压力升高，未启动测试推理')
 if last['swapouts']!=first['swapouts'] or last['swap_bytes']>first['swap_bytes']:
  raise RuntimeError('系统正在换出内存，未启动测试推理')
 if max(first['swap_bytes'],last['swap_bytes'])>maximum_existing_swap_bytes:raise RuntimeError('现有交换内存超过测试模型预算，未启动测试推理')
 if min(first['available_bytes'],last['available_bytes'])<minimum_available_bytes:raise MemoryReserveError('可用内存估计不足，未启动测试模型；没有卸载稳定版模型')
 lock_audio()
 return {'before':first,'confirmed':last,'minimum_available_bytes':minimum_available_bytes,'maximum_existing_swap_bytes':maximum_existing_swap_bytes}
