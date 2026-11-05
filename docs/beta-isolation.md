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
