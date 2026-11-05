#!/usr/bin/env python3
"""Bind an already compiled isolated native candidate, never a stable/global binary."""
from pathlib import Path
import argparse,hashlib,json,subprocess,os
ROOT=Path.home()/'Library/Application Support/Pi Agent Access Beta'
REPO=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--build',type=Path,required=True);a=p.parse_args()
source=a.source.resolve();build=a.build.resolve();binary=build/'bin/llama-omni-server'
if not all(path.is_relative_to((ROOT/'native').resolve())for path in [source,build,binary.resolve()]):raise SystemExit('Only isolated beta native paths are eligible')
manifest_path=REPO/'local-engines/minicpm-beta-source.json';manifest=json.loads(manifest_path.read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
if subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()!=manifest['baseCommit']:raise SystemExit('Native upstream base differs')
changed=set(subprocess.check_output(['git','diff','--name-only'],cwd=source,text=True).splitlines())
if changed!=set(manifest['files']):raise SystemExit('Native adapter set differs; preserve/review rather than reset files')
for name,digest in manifest['files'].items():
 if sha(source/name)!=digest:raise SystemExit('Native source differs: '+name)
cache=(build/'CMakeCache.txt').read_text();home=next(row.split('=',1)[1]for row in cache.splitlines()if row.startswith('CMAKE_HOME_DIRECTORY:'))
if Path(home).resolve()!=source:raise SystemExit('CMake build belongs to another source tree')
for key,value in manifest['buildOptions'].items():
 actual=next((line.split('=',1)[1]for line in cache.splitlines()if line.startswith(key+':')),None)
 if actual!=value:raise SystemExit('Native build option differs: '+key)
if not binary.is_file()or binary.stat().st_mtime<max((source/name).stat().st_mtime for name in manifest['files']):raise SystemExit('Native binary predates current reviewed source')
files=sorted({binary,*build.rglob('*.dylib')})
if any(not path.resolve().is_relative_to(build)for path in files):raise SystemExit('Native runtime has an external library link')
record={'format':1,'binary':str(binary),'sha256':sha(binary),'sourceBaseCommit':manifest['baseCommit'],'sourceManifestSha256':sha(manifest_path),'buildRoot':str(build),'runtimeFiles':[{'path':str(path),'sha256':sha(path)}for path in files],'acceptance':'candidate-only; real media/system/cache gates remain mandatory'}
os.umask(0o077);path=ROOT/'private/minicpm-engine.json';tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(record,indent=2));tmp.chmod(0o600);tmp.replace(path);print('Pinned isolated native candidate and',len(files),'runtime files; not activated')
