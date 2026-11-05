#!/usr/bin/env python3
"""Activate an actually tested Pi runtime. The same gate applies to hotfix and rollback."""
import argparse,json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BRIDGE=Path('/Users/zhangzheyuan/LocalAI/Tailscale-TSNET-Sushi-Bridge')
RELEASES=Path('/Users/zhangzheyuan/LocalAI/Pi-Web-Releases')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--gate',type=Path,required=True);args=parser.parse_args()
 gate=json.loads(args.gate.read_text());runtime=Path(gate['runtimeDirectory']).resolve()
 if RELEASES.resolve()not in runtime.parents:raise SystemExit('Runtime outside approved release directory')
 revoked=RELEASES/'revoked-runtimes.json'
 if revoked.exists()and str(runtime)in json.loads(revoked.read_text())['revoked']:raise SystemExit('S0: revoked defective runtime cannot be activated, including rollback')
 # No development-only, hotfix or partial-evidence bypass.
 subprocess.run(['node',str(ROOT/'scripts/verify-access-release-gate.mjs'),str(args.gate.resolve())],check=True,cwd=ROOT)
 sys.path.insert(0,'/Users/zhangzheyuan/LocalAI/Pi-Video-Global-Cleanup-20261101');from pi_client import api
 if api('/api/agent/running')['runningSessionIds']:raise SystemExit('User task active; activation deferred without cancelling it')
 selection=BRIDGE/'private/pi-web-release.json';old=json.loads(selection.read_text())
 pids=subprocess.check_output(['/usr/sbin/lsof','-nP','-iTCP:30143','-sTCP:LISTEN','-t'],text=True).strip().splitlines()
 if len(pids)!=1:raise SystemExit('Shared backend identity is ambiguous')
 pid=int(pids[0]);identity=subprocess.check_output(['/bin/ps','-p',str(pid),'-o','lstart=,comm='],text=True)
 cwd=subprocess.check_output(['/usr/sbin/lsof','-a','-p',str(pid),'-d','cwd','-Fn'],text=True)
 if '\nn'+old['server']+'\n'not in '\n'+cwd:raise SystemExit('Shared backend cwd differs from selected runtime')
 stamp=time.strftime('%Y%m%d-%H%M%S');backup=selection.with_name('pi-web-release.before-'+stamp+'.json');backup.write_bytes(selection.read_bytes());backup.chmod(0o600)
 receipt=runtime/'release-acceptance.json';receipt.write_bytes(args.gate.read_bytes());receipt.chmod(0o600)
 record={'server':str(runtime),'kind':'historical-regression-gated','gate':str(receipt),'runtimeDigest':gate['runtimeDigest'],'previous_server':old['server']}
 temp=selection.with_suffix('.json.tmp');temp.write_text(json.dumps(record));temp.chmod(0o600);temp.replace(selection)
 # Exact idle server only. Preserve all inference, network, VoiceOver and user applications.
 os.kill(pid,signal.SIGTERM)
 for _ in range(40):
  time.sleep(.25);alive=subprocess.run(['/bin/ps','-p',str(pid),'-o','lstart=,comm='],capture_output=True,text=True).stdout
  if not alive:break
 else:
  if alive==identity:os.kill(pid,signal.SIGKILL)
 print(json.dumps({'activated':str(runtime),'previous':old['server'],'stoppedIdleBackendPid':pid,'receipt':str(receipt)}))
if __name__=='__main__':main()
