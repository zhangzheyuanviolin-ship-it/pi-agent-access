# Local DeepSeek streamed-load admission patch

Base: official Sushi 1.4.1, commit 078012e6dcf924894aa8266c2aca7aba8c806692. Local patch, not an upstream release or a new benchmark. Preserve the original binary and licenses.

The streamed DeepSeek loader previously used free/reclaimable host memory while request admission had already derived a declared wired ceiling. The patch routes only streamed DeepSeek through the existing effectiveSushiAvailableBytes path. It retains GPU caps, wired margins, active-buffer subtraction and failure on genuinely inadequate budgets. It does not enable skip-mem-preflight or lower the 108GiB expert budget.

Compile ReleaseFast with the official matching Zig 0.17 and MLX dependencies. Apply this patch to the pinned source; run the filtered DeepSeek streamed-load test and actual cold/repeated loads. Keep libmlxc and the matching MLX metallib with the binary; verify its runtime rpath and signature after relocation. Do not overwrite other models' engine binaries.

The macOS GPU cap and global user-wire cap are separate from dynamic host headroom; changing a maximum is not equivalent to preallocating that memory. Preserve audio/VoiceOver headroom and do not promise all concurrent workloads will fit. The production gateway checks both configured limits before this model starts. A future upstream upgrade must repeat admission and cache restoration tests rather than silently dropping this patch.
