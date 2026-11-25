# Series X boat water on an RTX 5070 Ti

The Series X run on an RTX 5070 Ti with driver 621.40 reached playable **Follow the plane** with the boat afloat, a visible wake, and a continuous water surface in the captured view. The large black rectangles seen in earlier local runs were absent from that view. The sun disk and small dark spots in its reflection were still visible.

The game window reported 5 FPS and 194.4 ms/frame at the handoff, with 4,059 draws/frame. The three surrounding renderer reports were 4.9, 5.2, and 5.7 FPS at roughly 4,000 draws/frame.

The same session continued through the boat sequence to **Search the camp for Donnie** on foot. A sample of 201 consecutive present intervals over 54.0 seconds at the camp averaged 3.72 FPS, with a 291 ms median and 359 ms p95. The run was closed on request after 37 minutes 51 seconds. The log recorded no access violation or GPU device removal. Mission completion remains unverified.

The tested source commit is `cffdb50f43261772fb5fd6b702849afa9f4c775a`. Apply the accompanying `rtx5070ti-original-water.patch` to fxceless `0b0074e` to reproduce source tree `ef4f7c7e3157fc964dfbd51516e9828e0242f74a`. The patch ports Geckomacabre's `eee5667d` with the readback implementation unchanged. A diagnostics build passed all ten texture tests and has SHA-256 `f7a5eede9a1d018ed2d648b92096ed1a8bc207e836e4c45677ac578f7b6fc0ca`. The launch used Series X, a copy of the same local checkpoint, and the original four default water formats (`256x256f41,256x256f16,64x64f16,128x128f36`). Async submit, the second queue, indirect windows, and wide texture checks were disabled. [Original implementation](https://github.com/Geckomacabre/vx-layer/commit/eee5667d7119bc4a378214621e1b18a814ebe80f) · [Prior Series X report on the same GPU](https://github.com/fxceless/victory-fork/issues/863#issuecomment-7167764954)

The earlier local build using five readback formats crashed in a 16-byte copy from address zero. A separate trial held 2,079 DirectStorage reads until the explicit submit and reproduced the same crash. Those runs differ from this build in more than the format list. [DirectStorage change](https://github.com/Marvisak/VIctory/commit/eddde734)

AI-assisted testing and analysis. Source and aggregate measurements only. [Upstream test report](https://github.com/fxceless/victory-fork/issues/863#issuecomment-7172850010)
