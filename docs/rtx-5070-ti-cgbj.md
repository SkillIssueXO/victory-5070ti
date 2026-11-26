# CGBJ on RTX 5070 Ti

This branch preserves the CGBJ revision we tested on Windows with a Ryzen 7
9850X3D, RTX 5070 Ti, and 32 GB of RAM. The runtime was built from
`558e0aa4b93d355bcc1dc89ae9b22f3dc51f5282`. Its cache used a single
`PS_CompositeNMB` pixel shader compiled from
`70efdffa683ce8d8477dd24b15638e170320478f`. The original CGBJ source is
[`f4b48ad`](https://github.com/Lq0ne/cool_fox/commit/f4b48ad766ddbec1a1867022cd42f7645b0dd55e).

## Results

The corrected Series S boat scene showed a bright sun, smooth sky gradients,
and continuous bright reflections through a timed throttle run. In a
260 × 294 pixel area of the reflection band in the held views, the count of
pixels with all three channels at or below 32 fell from 1,260 to zero.
The camera and individual waves varied between captures.

| Run | Game output | Held FPS | Throttle FPS | Throttle p95 |
| --- | ---: | ---: | ---: | ---: |
| CGBJ Series X, stock composite | 3840 × 2160 | 26.05 | 19.29 | 105.2 ms |
| CGBJ Series X, repaired composite | 3840 × 2160 | 23.99 | 18.60 | 118.1 ms |
| CGBJ Series S, stock composite | 1920 × 1080 | 26.66 | 20.08 | 96.8 ms |
| CGBJ Series S, repaired composite | 1920 × 1080 | 26.25 | 23.16 | 55.5 ms |

Each held sample covered about 30 seconds. Each throttle sample used 16.2
seconds of scripted right-trigger input from a copy of the same checkpoint.
FPS is based on successful DXGI presents. A screenshot was taken during
each throttle sample. Series X used THIN recording with the ambient
overrides unset. Both Series S runs used THIN with CGBJ's ambient
compensation. The repaired Series X replay restored smooth sky gradients
and a bright sun disk. Broad, flat patches remained in the water under
throttle. The repaired Series X capture recorded 720 accepted presents
over 29.967 seconds at the helm and 301 over 16.125 seconds under throttle.
Each result comes from one replay. Scene timing varies, and longer gameplay
still needs testing.

## Series X submission trace

A diagnostic replay at 3840 × 2160 reused the repaired composite, the
same saved checkpoint, and the same launcher settings. It recorded
24.14 FPS over 29.986 seconds held and 17.82 FPS over 16.052 seconds
under throttle, with 104.3 ms throttle p95. The longest throttle gap
was 550.8 ms and began about 0.3 seconds after the first moving trace
finished writing. The earlier replay is the throughput baseline for
comparisons without the timeline enabled.

The timeline recorded three bursts with zero dropped trace events.
Each burst began with a present interval under 1.2 ms. The ranges below
use the next two intervals from each burst. GPU time integrates the
graphics submission timestamps within each present interval. CPU
spans overlap GPU execution and one another.

| Sample | Intervals | Present interval | Graphics submissions | Descriptor wait | Resource refresh worker window |
| --- | ---: | ---: | ---: | ---: | ---: |
| Held | 2 | 38.13–39.69 ms | 21.46–37.51 ms | 1.71–6.41 ms | 6.33–7.66 ms |
| Throttle | 4 | 39.87–64.89 ms | 19.81–47.03 ms | 1.86–12.30 ms | 6.35–11.12 ms |

The worker window includes work performed by the submitting thread.
Across 15 periodic samples during throttle, the descriptor worker
reported a median 6.20 ms making host descriptors and 1.93 ms reading
and comparing records. CGBJ already compares raw descriptor bytes in
batches. The next comparison isolates descriptor worker scheduling
while preserving the existing record comparison.

## Descriptor worker comparison

Setting `VICTORY_VIEW_THREADS=4` lowered the descriptor-record pool
from six workers to four and kept the texture-view pool at four.
Both runs used the same profiler, checkpoint, cache seed, and 4K
Series X settings.

| Descriptor workers | Held FPS | Throttle FPS | Throttle p95 |
| --- | ---: | ---: | ---: |
| 6 | 24.14 | 17.82 | 104.3 ms |
| 4 | 24.14 | 20.88 | 80.3 ms |

The four-worker replay recorded 338 successful presents over 16.141
seconds under throttle. In the 15 complete periodic samples per run,
median host descriptor creation fell from 6.20 to 5.34 ms, and the
median submission wait was 6.12 ms with six workers and 6.26 ms with
four. Both moving runs had a hitch above 480 ms. The four-worker
capture still showed broad flat patches on the water. These are single
replays with timeline tracing active. A repeat with tracing disabled
is needed to establish the throughput effect.

## Water-volumetric replay

The selective shader build loaded and created both water-volumetric
compute pipelines in a 4K Series X replay. The four-worker control
reported one dropped dispatch per frame for each of those programs.
The selective replay finished the timed throttle window with zero
reported drops for either program. It showed turquoise water with
dark rectangles both at rest and under throttle. The repaired sun
and sky were visible. [Selective source](https://github.com/SkillIssueXO/victory-5070ti/tree/cgbj-selective-wave-water)

The replay averaged 24.54 FPS over 29.957 seconds held and 18.61 FPS
over 16.173 seconds under throttle, with 113.5 ms p95 while moving.
It used a fresh driver cache with tracing disabled. These figures
describe the replay with the additional shaders active. The color
and tile coverage still need visual verification with the separate
tile-list repair. [Tile-list diagnosis](https://github.com/iGoldenNinja/victory-fork/commit/d380bef4e1f873c0c488af7dc38a6b6c5d6be021)

## Reproduce the one-shader comparison

1. Build the runtime revision and the repair revision in separate checkouts
   using the pinned Rust toolchain and Microsoft C++ Build Tools.

   ```powershell
   cargo build --locked --profile diag -p victory --features diagnostics
   ```

2. Use the same local title installation for both. Set `$archive` to your
   local shader archive. Set `$runtime` and `$compiler` to the two built
   executables. Set `$scratch` to a new directory outside the repository.
   The commands below generate the original and repaired cache entries in
   separate trees, using the Wave32 cap and null-view slot observed on the
   tested RTX 5070 Ti.

   ```powershell
   $wanted = Join-Path $scratch 'composite-only.txt'
   New-Item -ItemType Directory -Path $scratch -Force | Out-Null
   '6318f669e4f17d65' | Set-Content -LiteralPath $wanted -Encoding ascii
   $env:VICTORY_HOST_WAVE = '32'
   $env:VICTORY_VIEW_LIMIT = '999999'
   $env:VICTORY_LOG = 'info,victory_gpu::shader_cache=debug'
   $env:VICTORY_CACHE_DIR = Join-Path $scratch 'stock'
   & $runtime translate --warm $wanted --jobs 1 $archive
   $env:VICTORY_CACHE_DIR = Join-Path $scratch 'repaired'
   & $compiler translate --warm $wanted --jobs 1 $archive
   ```

3. Generate a stock game cache with the runtime and keep a separate copy for
   the comparison. Check that the stock probe entry matches the existing
   game-cache file at the path reported in the log, relative to its cache
   root. Check that both entries have the same `VSH1` magic, pixel stage,
   and binding metadata. The wrapper stores a little-endian DXIL length at
   byte 8 and the metadata starts at byte 12 plus that length. Copy the
   repaired entry over the **stock entry's relative path** in the private
   cache copy. The repair compiler's cache key differs because its
   translator source changed.

4. Start the runtime with fresh copies of the checkpoint data, changing
   `VICTORY_CACHE_DIR` between the stock cache and the repaired copy.
   Start with the Series S options below. The cache hit and the first
   shader bind are reported in the log. Keep each trace and cache outside
   the repository.

   ```powershell
   $settings = @{
       VICTORY_TEXTURE_NO_WAIT='1'; VICTORY_RELAY='2'; VICTORY_WIDE_BACK='1'
       VICTORY_CARD_REHASH_RUNS='1'; VICTORY_JOIN_COPIES='1'
       VICTORY_INDIRECT_WINDOW='1'; VICTORY_RELAY_COPY='1'; VICTORY_CARD_STEPS='2'
       VICTORY_INDIRECT_BATCH='2'; VICTORY_MAP_THREADS='1'; VICTORY_CARD_AWAKE='1'
       VICTORY_SHOW_AFTER='1'; VICTORY_JOIN_PARTS='8'; VICTORY_UPLOAD_AHEAD='1'
       VICTORY_LEVELS_ON_DEMAND='1'; VICTORY_CARD_BUFFERS_MIN_KB='64'
       VICTORY_AMBIENT='0.8'; VICTORY_AMBIENT_AIR='1.5'; VICTORY_THIN='1'
       VICTORY_LOG='info,victory_gpu::frame=debug,victory_gpu::shader_cache=debug'
   }
   foreach ($setting in $settings.GetEnumerator()) {
       Set-Item -LiteralPath "Env:$($setting.Key)" -Value $setting.Value
   }
   $env:VICTORY_KEYS = (2..13 | ForEach-Object { '{0}:Enter' -f ($_ * 4) }) -join ','
   & $runtime run $gameExecutable --execute --console series-s
   ```

   For a timed comparison, set `VICTORY_KEYS_FILE` to a fresh path before
   starting. At the playable helm, write `32:C:16.2` to that file. After
   the log reports `playthrough input batch loaded`, use seconds 1–31
   for the held view and seconds 32–48.2 for throttle. Count consecutive
   `swap chain accepted present` events in each window. Divide the number
   of intervals by elapsed time between the first and last events.

The regression fixture passed on the RTX 5070 Ti. The repaired pixel shader
passed DXIL validation and linked with the original CGBJ vertex shader in
the offline pipeline test. The arithmetic change comes from Moon0755's
port of Calvix2k's VIctory work. [fxceless PR 1026](https://github.com/fxceless/victory-fork/pull/1026)

See the [asset policy](asset-policy.md) before submitting results.
