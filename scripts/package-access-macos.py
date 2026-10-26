#!/usr/bin/env python3
"""Assemble an ad-hoc signed arm64 distribution after desktop:prepare and cargo build.
No OpenAI app/runtime is copied. LCU manifest bytes must survive signing unchanged.
"""
import argparse, hashlib, json, os, plistlib, shutil, subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=root / 'build/release')
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
version = json.loads((root / 'src-tauri/pi-agent-desktop-package.json').read_text())['version']
app = output / 'Pi Agent Access.app'
if app.exists():
    raise SystemExit('Output app already exists; use a new output directory.')
mac = app / 'Contents/MacOS'
resources = app / 'Contents/Resources'
mac.mkdir(parents=True)
resources.mkdir(parents=True)
shutil.copy2(root / 'src-tauri/target/release/pi-agent-desktop', mac / 'pi-agent-desktop')
shutil.copytree(root / 'src-tauri/resources', resources / 'resources', symlinks=True,
                ignore=shutil.ignore_patterns('.DS_Store'))
shutil.copy2(root / 'src-tauri/icons/icon.icns', resources / 'icon.icns')
info = {
 'CFBundleDevelopmentRegion':'zh_CN', 'CFBundleLocalizations':['zh_CN','en'],
 'CFBundleDisplayName':'Pi Agent Access', 'CFBundleName':'Pi Agent Access',
 'CFBundleIdentifier':'com.zhangzheyuan.pi-agent.access', 'CFBundleExecutable':'pi-agent-desktop',
 'CFBundleShortVersionString':version, 'CFBundleVersion':version,
 'CFBundlePackageType':'APPL', 'CFBundleInfoDictionaryVersion':'6.0',
 'CFBundleIconFile':'icon.icns', 'LSMinimumSystemVersion':'11.0',
 'NSHighResolutionCapable':True, 'LSApplicationCategoryType':'public.app-category.developer-tools',
 'NSAppleEventsUsageDescription':'电脑操作需要经您允许访问目标应用，以完成您要求的操作。',
 'NSMicrophoneUsageDescription':'仅在您明确使用音频输入时访问麦克风。',
}
(app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
(app / 'Contents/PkgInfo').write_bytes(b'APPL????')

def run(*cmd):
 subprocess.run(cmd, check=True)

server = resources / 'resources/server'
# Sign native Node bindings/helpers, but never re-sign the hash-pinned LCU tree.
for file in sorted((server / 'node_modules').rglob('*')):
 if not file.is_file() or file.is_symlink():
  continue
 with file.open('rb') as handle:
  magic = handle.read(4)
 if magic in [b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca']:
  run('codesign','--force','--sign','-',str(file))
run('codesign','--force','--sign','-',str(resources / 'resources/Pi Agent Server.app'))
run('codesign','--force','--sign','-',str(app))
run('codesign','--verify','--deep','--strict','--verbose=2',str(app))

vendor = server / 'access-distribution/lcu'
manifest = json.loads((vendor / 'bundle.json').read_text())
checked = 0
for name, record in manifest['files'].items():
 file = vendor / name
 if record['type'] == 'symlink':
  if name == 'agent-tools/node/bin/node':
   assert file.read_text() == 'LCU_EXTERNAL_NODE_LINK_PLACEHOLDER\n'
  else:
   assert file.is_symlink() and os.readlink(file) == record['target'], name
 else:
  assert hashlib.sha256(file.read_bytes()).hexdigest() == record['sha256'], name
 checked += 1
assert not (vendor / 'app').exists()
(output / 'bundle-verification.json').write_text(json.dumps({'version':version,'lcuEntriesVerified':checked,'signature':'ad-hoc; not notarized','architecture':'arm64'},indent=2)+'\n')
print(app)
