# Independent beta channel

Golden stable is c33df5f / v1.1.5. Never activate these beta sources on the stable
30143 service, re-sign the stable app, or rewrite its profile / native host.
Beta package name is Pi Agent Access 测试版, ID com.zhangzheyuan.pi-agent.access.beta.
The app and its Node helper both use the beta identifier. The only beta desktop
origin is loopback 38472; collisions fail rather than selecting a stable origin.

Private state is ~/Library/Application Support/Pi Agent Access Beta. A fresh
profile copies explicitly selected configuration and memory, not chats, shared
backend configuration, scheduled tasks or stable npm state. Credentials remain
private and are never part of a package. The existing sealed CU runtime and
model weight files are read-only dependencies. Browser registration repair is
not permitted from beta. Gateway 12449 owns only its explicitly spawned native
process groups on dedicated 124xx ports. It refuses unknown occupied ports even
if they advertise the expected model ID. It never calls stable model unload.

Conservative resource admission checks stable tasks, available memory (genuinely free pages plus a file-cache allowance bounded by
both inactive and file-backed totals; never all anonymous inactive model pages), swap activity, normal kernel pressure and
audio mlock. Admission refusal is not model acceptance and must not be bypassed
just to complete a test. Stable requests do not wait for beta acceptance gates.

Builds require dependencies physically belonging to this worktree; external
node_modules symlinks are rejected before staging. The Node copied into the
package must run independently: this Mac's generic Node uses a private libnode
dylib, whereas the previously verified desktop Node is self-contained. Explicitly
select the verified binary; its source app is never modified. Camera/microphone
usage descriptions are beta-only and do not grant access or start capture.

Status: development candidate, NOT user-installed or promoted. Unit tests and
partial package smoke are evidence only. Run all historical cases against the
final actual package before installation. Old 200k SSD caches were explicitly
deleted at the user's request; previous restoration evidence cannot be relabeled
as a new beta cache test. Keep original failures and distinguish inherited cold
loopback/SSE recovery from the already accepted remote-mobile behavior.

A small model may explicitly allow up to 32MiB of static residual swap, only
with two unchanged anonymous Swapouts/swap-usage samples, normal pressure, its full available-memory
reserve, and a successful audio mlock. Default remains zero. This avoids requiring
a system reboot merely for historical 7MiB swap; it never relaxes large-model
reserves or changes stable admission. Evidence must retain both refusals and
resource readings. Do not increase the cap to force a model to load.

The file-cache allowance is an estimate, recorded separately from genuinely free
bytes. A stopped Mini model and downloaded weight files leave clean filesystem
pages behind; treating all such pages as unavailable would prevent the next
model load despite normal pressure. No per-model reserve or swap cap is lowered.

On macOS vm_stat, Pageouts includes external/file-backed pager activity and is
not interchangeable with compressor Swapouts. Keep Pageouts as diagnostics;
reject new Swapouts, increasing swap usage, abnormal kernel pressure or a failed
audio mlock. Apple system_cmds vm_stat.c subtracts speculative_count from its
printed Pages free, so adding printed free + speculative does not double count.
Primary definitions: apple-oss-distributions/xnu osfmk/mach/vm_statistics.h and
osfmk/vm/vm_pageout.c; system_cmds/vm_stat/vm_stat.c.

Candidate bundles live at an immutable beta releases/<sourceDigest>/ path. All
model/UI/prefix acceptance must use that exact canonical app. After full gates,
the separate Applications entry can link to it; Rust canonicalizes beta resources
before constructing Node/SDK/backend paths. Never copy to a new runtime path and
repair recipes after testing, never overwrite an existing immutable release, and
never treat candidate construction as installation authorization.

Duplex has its own admission before closing a warm chat owner or creating the
native pipeline: 64GiB genuinely free pages, as well as all ordinary pressure,
swap and audio checks. A real candidate duplex initialization caused swap to
grow from 7.12 to 21.75MiB and was stopped by post-load protection. Do not repeat
that load alongside the resident stable large model. File-cache estimates do
not satisfy this stricter reserve. This is a protected refusal, not live-call
acceptance; actual camera/microphone, interruption and full model gates remain.

Qwen Instruct uses the official plain assistant prefix. Passing
enable_thinking=false injected empty think delimiters and caused first-token
corruption. Real 4bit audio/text and three-turn KV reuse passed after omitting
that switch; synthetic music was recognized without invented speech. Visual
accuracy, visual cached suffix handling, speech output and final PIA integration
are still unaccepted. Qwen stays disabled; raw diagnostic success is not a
registered usable model. The downloaded pinned weights and original BF16 assets
remain intact. No global MLX or Transformers package was modified.

2026-11-06 candidate update (supersedes the earlier partial status above):
Mini's real SDK read/result/cache and tools-off requests passed. Qwen is the
pinned four-bit checkpoint, not a BF16 alias. Video cached suffix and native
speech KV have separate regression cases. Native speech retains function-call
special-token delimiters and stops before Talker for a function request; a real
tool result precedes spoken answers. Actual package acceptance remains required.
A source diagnostic asking only for video colors produced a wrong temporal
order; preserve this model-understanding failure, not just the successful
color-and-shape question. No universal visual-accuracy claim is made.

Residual-swap policy review: all four large Sushi engines were loaded and
actually inferred/tool-called/restored from SSD with 13.75–21.75MiB historical
swap, normal pressure, successful audio mlock, and zero new Swapouts. The
DeepSeek test preserved >8GiB available after its ~108GB allocation. An absolute
zero-swap requirement in beta would therefore reject a genuinely idle healthy
host until reboot, even when >110GB is available. Explicit beta recipes may now
use the same bounded 32MiB residual allowance for every model; default for an
unspecified recipe remains zero. Full 96/52GiB per-model reserves are retained,
no active swap or increasing usage is admitted, and the gateway now rechecks
8GiB/pressure/audio/swap growth after a NEW load, before forwarding inference.
A rejected load is released only when it is our owned idle child group. Stable
admission, OS limits and the native engine's own preflight are unchanged. This
is a documented policy change based on measured resource behavior, not a claim
that new swapping is acceptable. Duplex still requires 64GiB genuinely free.

2026-11-06 active file-cache correction (supersedes the inactive cap and
64GiB genuinely-free-only wording above): the exact build8 switch test rejected
DeepSeek twice without ever spawning it, even with no other model alive. The
resource timeline and vm_stat show ~108GB file-backed pages, ~60GB inactive,
~16GB free/speculative, only ~7GB anonymous and ~4GB wired. The old
min(inactive,file_backed) allowance omitted ~48GB of pageable file cache. This
is an accounting error, not an occupied GPU or demonstrated release delay.
XNU host.c exports external_page_count from vm_page_pageable_external_count;
vm_statistics.h defines it as file-backed non-swap. Queue activity does not
make a pageable file page anonymous or wired. Use free/speculative plus this
file-backed estimate, recording the previous inactive-only lower estimate
separately. Never add all anonymous inactive pages. Kernel pressure, bounded
static swap, two unchanged samples, full 96/52GiB model reserves, engine native
preflight, post-load8GiB/audio/no-new-swap guards remain. Duplex retains its full
64GiB preallocation headroom based on the corrected estimate, instead of
requiring cached file data to have disappeared from RAM before allocation.
This fixes false refusal without purging files/caches, reallocating dummy memory,
changing OS limits or waiting for an arbitrary aging interval. The negative
64GiB test and anonymous-page exclusion tests are retained. New actual-package
model-switch, duplex and resource acceptance are required before activation.
Primary sources:
https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/host.c
https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/vm_statistics.h
https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_page.h
