# RTX 5070 Ti test notes

Tests use Windows 11, an RTX 5070 Ti with 16 GB VRAM, driver 621.40, a Ryzen 7
9850X3D, 32 GB RAM, and the Series X profile. The goal is correct rendering and
steady play in the open world. Indoor and outdoor measurements describe different
workloads.

On November 25, 2026, a diagnostic build based on `a253706` averaged **6.26 FPS**
across 176 presents while walking through a prison hallway. The median was
154.45 ms and the 95th percentile was 194.88 ms. This was a manual movement
sample. The run later reached an outdoor cutscene at about 2 FPS. A local memory
guard closed the run at 2.90 GiB of available system commit and 27.44 GiB of
process private memory.

## Changes in this fork

- `VICTORY_SPLIT_DISPATCH=1` allows eligible indirect compute dispatches to run in
  two segments with the correct X group offsets. The original dispatch budget
  still applies. The switch is experimental.
- Diagnostic builds can use `VICTORY_KEYS_FILE` for repeatable controller input.
  Entries use `start:key:hold` in seconds and are relative to the file edit.
  For example, `0:L:1.2,2:S:2` turns the camera and steps backward.
- Kyle Soderlund's [parallel texture refresh](https://github.com/fxceless/victory-fork/pull/768)
  is available with `VICTORY_WIDE_TEXTURES=1`. The local change completes pending
  refreshes before host steps consume the mip mask, and logs how many refreshes
  run alone or in parallel. This option still needs matched gameplay measurements.

## Compare runs

Build with `cargo build --locked --profile diag -p victory --features diagnostics`.
Set `VICTORY_LOG=info,victory_gpu::frame=debug` and `VICTORY_FRAME_LOG=1` to record
present and frame timing in stderr. Keep the executable, console profile, cache
seed, and visual settings fixed while changing the option under test. Compare
the same camera view or route.

```powershell
node tools/frame-report.mjs stderr.log --present-log --from 2301 --to 2449 --host-meter --target-fps 60 --json
```

`--from` and `--to` are present ordinals. `--from-utc` and `--to-utc` select a
window by timestamp, using frame intervals entirely inside that window. For a
runner directory with `memory.csv`, `stderr.log`, and an optional `end.txt`, use
`node tools/memory-report.mjs <run-directory> --seconds 45`. The CSV header is
`UTC,Seconds,FreeCommitGiB,ProcessPrivateGiB,ProcessCpuCores`.

[Asset policy](asset-policy.md)
