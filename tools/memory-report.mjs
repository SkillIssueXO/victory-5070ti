import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { seconds: { type: 'string', default: '30' } },
});
const seconds = Number(values.seconds);
if (positionals.length !== 1 || !Number.isFinite(seconds) || seconds <= 0) {
  console.error('Usage: node memory-report.mjs RUN_DIR [--seconds 30]');
  process.exit(2);
}

const [runDir] = positionals;
const stopFile = join(runDir, 'end.txt');
const endReason = existsSync(stopFile) ? readFileSync(stopFile, 'utf8').trim() : null;
const lines = readFileSync(join(runDir, 'memory.csv'), 'utf8').split(/\r?\n/);
// While the runner appends a row, its last line can be incomplete.
if (lines.at(-1) === '' || !endReason) lines.pop();
if (lines.shift() !== 'UTC,Seconds,FreeCommitGiB,ProcessPrivateGiB,ProcessCpuCores') {
  throw new Error('Unrecognized runner memory CSV header');
}
const samples = lines.map((line, index) => {
  const [utc, elapsed, freeCommitGiB, privateGiB, cpuCores] = line.split(',');
  if (![Date.parse(utc), Number(elapsed), Number(freeCommitGiB), Number(privateGiB), Number(cpuCores)].every(Number.isFinite)) {
    throw new Error(`Invalid runner memory sample on line ${index + 2}`);
  }
  return { utc, elapsed: Number(elapsed), freeCommitGiB: Number(freeCommitGiB), privateGiB: Number(privateGiB) };
});
if (!samples.length) throw new Error('No runner memory samples');
const lastSample = samples.at(-1);
const end = Date.parse(lastSample.utc);
const start = end - seconds * 1000;
const tail = samples.filter(({ utc }) => Date.parse(utc) >= start);

const snapshots = [];
let textures;
let snapshot;
let comparisonSamples = 0;
let comparisonsWithWindowRanges = 0;
const remapTimes = [];
for (const line of readFileSync(join(runDir, 'stderr.log'), 'utf8').split(/\r?\n/)) {
  const utc = line.split(' ', 1)[0];
  const at = Date.parse(utc);
  if (!Number.isFinite(at) || at > end) continue;

  const comparison = /shader writes looked for on the CPU per frame: [\d.]+ MB compared in ([\d.]+) ranges of windows/.exec(line);
  if (comparison) {
    comparisonSamples++;
    if (Number(comparison[1]) > 0) comparisonsWithWindowRanges++;
  }
  if (at < start) continue;

  const remap = /texture refreshes per frame, all threads: .*?([\d.]+) ms waiting for title memory to hold still/.exec(line);
  if (remap) remapTimes.push(Number(remap[1]));
  if (!line.includes('victory_gpu::copystat:')) continue;

  // The census prints the texture, process and descriptor rows in order.
  // Different threads can log in between these rows.
  if (line.includes('memory of textures:')) {
    textures = /the host renders to or writes: \d+ alive (\d+) MB; host copies the title fills: \d+ alive (\d+) MB .*?the card: (\d+) MB in use of a budget of (\d+) MB, (\d+) MB/.exec(line);
    snapshot = undefined;
    continue;
  }
  const memory = /memory: (\d+) MB private .*? (\d+) MB left to commit\); host copies of title memory: \d+ alive (\d+) MB, of them (\d+) windows outside buffers (\d+) MB/.exec(line);
  if (memory) {
    const [, privateMiB, freeCommitMiB, bufferCopyMiB, windows, windowMiB] = memory.map(Number);
    snapshot = { utc, privateMiB, freeCommitMiB, bufferCopyMiB, windows, windowMiB };
    const staging = /staging of textures: (\d+) alive (\d+) MB, (\d+) kept by their texture/.exec(line);
    if (staging) {
      const [, liveTextureStaging, textureStagingMiB, textureRetainedStaging] = staging.map(Number);
      Object.assign(snapshot, { liveTextureStaging, textureStagingMiB, textureRetainedStaging });
    }
    if (textures) {
      const [, hostWrittenTextureMiB, titleFilledTextureMiB, gpuLocalMiB, gpuLocalBudgetMiB, gpuSharedMiB] = textures.map(Number);
      Object.assign(snapshot, { hostWrittenTextureMiB, titleFilledTextureMiB, gpuLocalMiB, gpuLocalBudgetMiB, gpuSharedMiB });
    }
    textures = undefined;
    snapshots.push(snapshot);
    continue;
  }
  const holders = /windows outside buffers \(grid \d+ KiB\): (\d+) MB .*?, \d+ shown by descriptor slots (\d+) MB, \d+ held by lists or the pass\s+over the heap (\d+) MB/.exec(line);
  if (snapshot && holders) {
    const [, windowCopiedPageMiB, windowDescriptorMiB, windowListOrHeapPassMiB] = holders.map(Number);
    Object.assign(snapshot, { windowCopiedPageMiB, windowDescriptorMiB, windowListOrHeapPassMiB });
  }
  const allocations = /our own allocations: (\d+) MB in (\d+) blocks/.exec(line);
  if (snapshot && allocations && line.includes('memory, what holds it:')) {
    const [, trackedAllocatorMiB, trackedAllocatorBlocks] = allocations.map(Number);
    Object.assign(snapshot, { trackedAllocatorMiB, trackedAllocatorBlocks });
  }
}

console.log(JSON.stringify({
  endReason,
  lastSample,
  tail: {
    seconds,
    pollCount: tail.length,
    minFreeCommitGiB: Math.min(...tail.map(sample => sample.freeCommitGiB)),
    peakPrivateGiB: Math.max(...tail.map(sample => sample.privateGiB)),
    ...(remapTimes.length && { peakTextureRemapWaitMsPerFrameAllThreads: Math.max(...remapTimes) }),
  },
  // These count observed comparison reports. Zero reported ranges does
  // not establish that no shader can ever write to a window.
  cpuWindowComparison: { samples: comparisonSamples, withWindowRanges: comparisonsWithWindowRanges },
  // Diagnostic counters can overlap and aren't a sum of commit charges.
  snapshots,
}, null, 2));
