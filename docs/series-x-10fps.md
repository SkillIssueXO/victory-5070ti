# Series X boat chase at 10 FPS on an RTX 5070 Ti

The boat stayed afloat and the chase was playable with keyboard and mouse in borderless fullscreen. Between 22:09:20 and 22:09:50 UTC on November 25, 2026, 305 consecutive logged present intervals averaged **10.19 FPS**, with **100.9 ms median** and **158.6 ms p95** frame time. The Windows title at 22:09:52 UTC reported **10 FPS, 102.4 ms/frame, and 4,053 draws/frame**. An earlier 30-second stretch averaged 8.44 FPS. The dark sun, spots in bright reflections, block artifacts on the boat, and missing lip movement were visible during this replay. A matched baseline comparison is pending.

## Source and build

The run used source commit `b391c7349e47cd1a1eef258b4c2a5ed116ed55c8`. It includes BradRoland's water readback change at `643f05a02ffd8b01f0ca7937655d52017169c0ae` and the fullscreen and PC input code. The source patch contains the complete difference from fxceless base `9c184b35b43de3455b74ac1770e1c8734a047810`. [Water readback PR and replay report](https://github.com/fxceless/victory-fork/pull/1152#issuecomment-7175998092)

In a checkout of the fxceless repository, apply [series-x-10fps.patch](series-x-10fps.patch) from the exact base. Replace the patch path with its download location.

```powershell
git switch --detach 9c184b35b43de3455b74ac1770e1c8734a047810
git apply --index 'C:/path/to/series-x-10fps.patch'
git write-tree
cargo build --profile diag --locked -p victory --features diagnostics
```

The tree hash is `df827ee7d4e50a2e5743309c42aaf154e003f1e0`. The measured Windows executable's SHA-256 is `fd9536c295a9d11766ccc5c0ebf10fada6c5bdfa41daea691990d428cdd36166`.

## Replay settings

The test used a copied boat-mission profile and a warm cache from the preceding windowed `643f05a0` run on the same PC. The launcher requested `1920x1080`. Fullscreen uses the current monitor. These were the renderer and input settings in the launch command.

```powershell
$env:VICTORY_LEVELS_ON_DEMAND = '1'
$env:VICTORY_ASYNC_SUBMIT = '1'
$env:VICTORY_QUEUE2 = '1'
$env:VICTORY_INDIRECT_WINDOW = '1'
$env:VICTORY_TEXTURE_NO_WAIT = '1'
$env:VICTORY_MERGE_GAP = '64'
$env:VICTORY_MERGE_RUNS = '4096'
$env:VICTORY_STAGING_POOL = '0'
$env:VICTORY_COPY_PLAIN = '1'
$env:VICTORY_JOIN_PARTS = '1'
$env:VICTORY_BACK_OWN_VIEW = '1'
$env:VICTORY_INDIRECT_GATHER = '1'
$env:VICTORY_CARD_REHASH_RUNS = '1'
$env:VICTORY_TEXTURE_BACK = '1'
$env:VICTORY_DISPLAY_MODE = '1920x1080'
$env:VICTORY_PC_CONTROLS = '1'
$env:VICTORY_PC_DRIVING = '1'
$env:VICTORY_FULLSCREEN = '1'
.\target\diag\victory.exe run 'C:/path/to/game-executable.exe' --execute --console series-x
```

Click the focused game window to capture and hide the mouse. W/S apply throttle and brake or reverse in driving mode, A/D steer, and F7 switches between walking and driving. F8 toggles mouse capture and F11 toggles fullscreen. [Full controls and PC input notes](rtx5070ti-pc-controls.md)

AI-assisted testing. This report shares source changes, launch settings, and aggregate measurements.
