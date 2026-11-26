# CGBJ water-only checkpoint

This checkpoint uses the executable from `9047aa8e` and an overlay of exactly three shader cache entries. The tile generator appends one work item per eligible tile. The forward and reverse volume shaders use the paired Wave32 translation from the `118f9430` Neptune reference with the group base set to zero for the unsplit boat dispatch. The validated tile edit was prepared from the `acf71f96` CGBJ translation and has the same binding metadata as `9047aa8e` stock. The existing sun composite repair is part of the baseline cache.

The verified launch used Series S console mode, a 1920 × 1080 output, borderless fullscreen, async submission, and water readback selectors `256x256f41,256x256f16,64x64f16,128x128f36`. It used the saved boat checkpoint. The local run is `series-s-water-only-fullscreen`.

Use the preserved local executable and prepared cache as a pair. To assemble the same cache from the pinned baseline seed and the three private repaired entries, run the following.

```powershell
& .\scripts\cgbj-water-only\prepare.ps1 -Executable $executable `
    -BaselineCache $baselineCache -RepairedCache $privateWaterCache -Destination $newCache
```

The script verifies the executable, the exact baseline cache and the three input entries. It writes a new cache directory and verifies the exact output. The cache digest is SHA-256 over ordinally sorted, newline-separated relative paths and lowercase file digests, using forward slashes and UTF-8 with no final newline. Keep the executable, save, generated shaders, and gameplay captures in local storage.

All three pipelines bound in the boat scene on the RTX 5070 Ti. The first two boat captures show turquoise water, a bright reflection and continuous coverage in the sampled views. A 15-second gameplay sample measured 24.14 accepted presents/s, with 38.48 ms median and 59.21 ms p95. These timings describe that run and viewpoint.
