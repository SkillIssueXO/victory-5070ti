import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    'from-utc': { type: 'string' },
    'to-utc': { type: 'string' },
    'min-draws': { type: 'string' },
    'present-log': { type: 'boolean' },
    'host-meter': { type: 'boolean' },
    'target-fps': { type: 'string' },
    memory: { type: 'string' },
    json: { type: 'boolean' },
    timeline: { type: 'string' },
  },
});

if (positionals.length !== 1) {
  console.error('Usage: node frame-report.mjs TRACE.csv [--from N] [--to N] [--min-draws N] [--memory memory.csv] [--target-fps N] [--json] [--timeline timeline.json]');
  console.error('       node frame-report.mjs STDERR.log --present-log [--from N] [--to N] [--host-meter] [--target-fps N] [--json]');
  console.error('       With --present-log, use --from-utc and --to-utc for UTC video or log timestamps.');
  process.exit(2);
}

const [tracePath] = positionals;
const first = countOption(values.from, 1);
const last = countOption(values.to, Number.MAX_SAFE_INTEGER);
const fromUtc = parseUtcOption(values['from-utc'], '--from-utc');
const toUtc = parseUtcOption(values['to-utc'], '--to-utc');
const targetFps = values['target-fps'] === undefined ? undefined : Number(values['target-fps']);
if (targetFps !== undefined && (!Number.isFinite(targetFps) || targetFps <= 0 || !Number.isFinite(1000 / targetFps))) {
  throw new Error('The target FPS must be a positive number with a finite frame budget.');
}
if (values['present-log']) {
  if (values['min-draws'] !== undefined || values.memory || values.timeline) {
    throw new Error('Draw filters, memory samples and timelines require a frame trace CSV.');
  }
  const report = reportPresents(tracePath, first, last, values['host-meter']);
  console.log(values.json ? JSON.stringify(report, null, 2) : report);
  process.exit(0);
}
if (values['host-meter']) throw new Error('Host meter reporting requires --present-log.');
if (fromUtc !== undefined || toUtc !== undefined) throw new Error('UTC bounds require --present-log.');
const minDraws = countOption(values['min-draws'], 0);
const events = readTrace(tracePath);
const presents = events.filter(({ phase }) => phase === 'present').sort((a, b) => a.frame - b.frame);
const spans = events.sort((a, b) => a.start - b.start);
const relayReasons = new Map([
  [2, 'settle'], [3, 'card_done'], [4, 'title_value'], [5, 'stale'], [6, 'read_after_write'],
  [7, 'ordered_work'], [8, 'flight_limit'], [9, 'write_limit'], [10, 'title_fence'],
]);
const comparisons = [
  ['relay_wait', 'relay_fetch'],
  ['relay_wait', 'relay_gpu_fence'],
  ['queue_idle', 'present_thread/submit_prepare'],
];

const frames = [];
let pending = [];
let cursor = 0;
for (let i = 1; i < presents.length; i++) {
  const previous = presents[i - 1];
  const current = presents[i];
  const draws = current.value - previous.value;
  if (current.frame < first || current.frame > last || current.frame !== previous.frame + 1 ||
      current.end <= previous.end || draws < minDraws) continue;

  const start = previous.end;
  const end = current.end;
  while (cursor < spans.length && spans[cursor].start < end) pending.push(spans[cursor++]);
  pending = pending.filter(event => event.end > start);
  const byPhase = new Map();
  let relayBytes = 0;
  let gpuCopies = 0;
  let gpuCopyUs = 0;
  for (const event of pending) {
    if (event.phase === 'relay_copy_gpu_us') {
      gpuCopies++;
      gpuCopyUs += event.value;
      continue;
    }
    const interval = [Math.max(start, event.start), Math.min(end, event.end)];
    addInterval(byPhase, event.phase, interval);
    if (event.phase === 'relay_wait') {
      addInterval(byPhase, `relay_wait/${relayReasons.get(event.value) ?? event.value}`, interval);
      if (event.thread === current.thread) addInterval(byPhase, 'present_thread/relay_wait', interval);
    }
    if (event.phase === 'submit_prepare' && event.thread === current.thread) {
      addInterval(byPhase, 'present_thread/submit_prepare', interval);
    }
    if (event.phase === 'relay_fetch' && event.end <= end) relayBytes += event.value;
  }
  const unions = new Map([...byPhase].map(([phase, intervals]) => [phase, merged(intervals)]));
  const phaseMs = Object.fromEntries([...unions].map(([phase, intervals]) => [phase, duration(intervals) / 1000]));
  for (const [left, right] of comparisons) {
    if (unions.has(left) && unions.has(right)) {
      phaseMs[`${left} ∩ ${right}`] = overlap(unions.get(left), unions.get(right)) / 1000;
    }
  }
  frames.push({ frame: current.frame, start, end, draws, relayBytes, gpuCopies, gpuCopyUs, ms: (end - start) / 1000, phaseMs });
}

if (!frames.length) {
  console.error('No complete consecutive frame pairs match the range and draw filter.');
  process.exit(1);
}

const names = new Set(frames.flatMap(frame => Object.keys(frame.phaseMs)));
const phases = [...names].map(phase => ({ phase, ...summarize(frames.map(frame => frame.phaseMs[phase] ?? 0)) }))
  .sort((a, b) => b.median - a.median || b.p95 - a.p95);
const frameMs = frames.map(frame => frame.ms);
const report = {
  from: frames[0].frame,
  to: frames.at(-1).frame,
  frames: frames.length,
  fps: round(1000 * frames.length / frameMs.reduce((sum, ms) => sum + ms, 0)),
  framesAt10Fps: frames.filter(frame => frame.ms <= 100).length,
  ...measureTarget(frameMs),
  frameMs: summarize(frameMs),
  draws: summarize(frames.map(frame => frame.draws)),
  relayFetchMiB: summarize(frames.map(frame => frame.relayBytes / 2 ** 20)),
  phases,
};
const timestamped = frames.filter(frame => frame.gpuCopies > 0);
if (timestamped.length) {
  report.relayGpuCopy = {
    frames: timestamped.length,
    batches: timestamped.reduce((total, frame) => total + frame.gpuCopies, 0),
    ms: summarize(timestamped.map(frame => frame.gpuCopyUs / 1000)),
  };
}

if (values.memory) {
  // The collector opens the original trace file at its monotonic clock origin.
  const created = statSync(tracePath).birthtimeMs;
  const samples = readFileSync(values.memory, 'utf8').trim().split(/\r?\n/).slice(1).map(row => row.split(','));
  const included = samples.filter(([utc]) => {
    const at = (Date.parse(utc) - created) * 1000;
    return frames.some(frame => frame.start <= at && at < frame.end);
  });
  if (included.length) {
    const cpuCores = included.map(row => Number(row[4])).filter(Number.isFinite);
    report.process = {
      samples: included.length,
      peakPrivateGiB: Math.max(...included.map(row => Number(row[3]))),
      minFreeCommitGiB: Math.min(...included.map(row => Number(row[2]))),
      ...(cpuCores.length && { cpuCores: summarize(cpuCores) }),
    };
  }
}

if (values.timeline) {
  const start = frames[0].start;
  const end = frames.at(-1).end;
  const traceEvents = spans.filter(event => event.start < end && event.end > start).map(event => ({
    name: event.phase === 'relay_wait' ? `${event.phase}/${relayReasons.get(event.value) ?? event.value}` : event.phase,
    cat: 'VIctory', pid: 1, tid: event.thread,
    ts: Math.max(event.start, start) - start,
    ...(event.start === event.end
      ? { ph: 'i', s: 't' }
      : { ph: 'X', dur: Math.min(event.end, end) - Math.max(event.start, start) }),
    args: { frame: event.frame, value: event.value },
  }));
  for (const frame of frames) {
    traceEvents.push({
      name: `Frame ${frame.frame}`, cat: 'frame', ph: 'X', pid: 1, tid: 0,
      ts: frame.start - start, dur: frame.end - frame.start, args: { draws: frame.draws },
    });
  }
  writeFileSync(values.timeline, JSON.stringify({ traceEvents, displayTimeUnit: 'ms' }), { flag: 'wx' });
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { phases, ...summary } = report;
  console.log(summary);
  console.log('Milliseconds per frame by phase. Concurrent and nested phases overlap.');
  console.table(phases);
}

function countOption(raw, fallback) {
  if (raw === undefined) return fallback;
  const number = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number)) throw new Error(`Invalid frame or draw count: ${raw}`);
  return number;
}

function measureTarget(frameMs) {
  if (targetFps === undefined) return {};
  const budget = 1000 / targetFps;
  return {
    targetFps,
    frameBudgetMs: round(budget),
    framesAtTargetFps: frameMs.filter(ms => ms <= budget).length,
  };
}

function parseUtcOption(value, name) {
  if (value === undefined) return undefined;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z$/.exec(value);
  const second = parts && Date.parse(`${parts[1]}Z`);
  if (!Number.isFinite(second)) {
    throw new Error(`${name} must be an ISO 8601 UTC timestamp ending in Z.`);
  }
  return second + Number(parts[2] ?? 0) * 1000;
}

function reportPresents(path, first, last, includeHostMeter) {
  const contents = readFileSync(path, 'utf8');
  const line = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z +DEBUG victory_gpu::frame: present token=\d+\r?$/gm;
  // Present order is independent of the title's frame-start token.
  const times = Array.from(contents.matchAll(line), ([, second, fraction]) =>
    Date.parse(`${second}Z`) + Number(fraction ?? 0) * 1000);
  const firstUtcIndex = fromUtc === undefined ? 0 : times.findIndex(time => time >= fromUtc);
  const utcLast = toUtc === undefined ? times.length : times.findLastIndex(time => time <= toUtc) + 1;
  const from = Math.max(first, firstUtcIndex + 2);
  const to = Math.min(last, utcLast);
  const frameMs = times.slice(from - 1, to).map((end, index) => end - times[from + index - 2]);
  if (firstUtcIndex < 0 || !frameMs.length || frameMs.some(ms => !Number.isFinite(ms) || ms <= 0)) {
    throw new Error('The selected range needs consecutive presents with increasing UTC timestamps.');
  }
  const report = {
    from,
    to,
    startUtc: new Date(times[from - 2]).toISOString(),
    endUtc: new Date(times[to - 1]).toISOString(),
    frames: frameMs.length,
    fps: round(1000 * frameMs.length / frameMs.reduce((sum, ms) => sum + ms, 0)),
    framesAt10Fps: frameMs.filter(ms => ms <= 100).length,
    ...measureTarget(frameMs),
    frameMs: summarize(frameMs),
  };
  if (includeHostMeter) {
    report.hostMeter = summarizeHostMeter(contents, times[from - 2], times[to - 1]);
  }
  return report;
}

function summarizeHostMeter(contents, start, end) {
  const meter = /^(\S+) +INFO victory_gpu::host: ([\d.]+) fps, ([\d.]+) ms\/frame \(([\d.]+) preparing:[^\r\n]+?; ([\d.]+) on the GPU; ([\d.]+) copying back ([\d.]+) MB\), ([\d.]+) draws\/frame, dropped ([\d.]+) without a host pipeline[^\r\n]*? and ([\d.]+) indirect\b/gm;
  const queue = /^(\S+) +INFO victory_gpu::host: the card's clock per frame: nothing of ours queued ([\d.]+) ms \(the card about ([\d.]+)% busy by this count\), ([\d.]+) ms of that while the submitting thread was working[^\r\n]+?stood waiting for the card ([\d.]+) ms\b/gm;
  const preparation = /^(\S+) +INFO victory_gpu::host: [\d.]+ fps, [\d.]+ ms\/frame \([\d.]+ preparing: copies ([\d.]+) ms ([\d.]+) MB, textures ([\d.]+) ms ([\d.]+) MB;/gm;
  const copyWork = /^(\S+) +INFO victory_gpu::copystat: copies per frame:[^\r\n]*?; ([\d.]+) refreshes ([\d.]+) MB, [\d.]+ skipped [\d.]+ MB; [\d.]+ runs [\d.]+ ms; ([\d.]+) queries ([\d.]+) ms, moves ([\d.]+) ms, ([\d.]+) MB unmapped; ([\d.]+) page faults; ([\d.]+) watches ([\d.]+) ms, ([\d.]+) MB checked, ([\d.]+) MB unchanged; ([\d.]+) fallbacks\b/gm;
  const plainCopy = /^(\S+) +INFO victory_gpu::plaincopy: copies of title memory made in place per frame \(VICTORY_COPY_PLAIN=1\): ([\d.]+), ([\d.]+) MB; ([\d.]+) met a page\b/gm;
  const usualFrames = /^(\S+) +INFO victory_gpu::framelog: usual frame \(the mean of ([\d.]+) not long\): ([\d.]+) ms[^\r\n]*?in the present call ([\d.]+) \(lines and settling ([\d.]+), copy and show ([\d.]+)\)[^\r\n]*?; copies ([\d.]+) ms [\d.]+ MB; copy-back ([\d.]+) ms [\d.]+ MB[^\r\n]*?all other lists ([\d.]+) ms[^\r\n]*?textures: refresh ([\d.]+) ms \(([\d.]+) waiting for memory to hold still\)[^\r\n]*?pipelines: ([\d.]+) made, ([\d.]+) loaded, ([\d.]+) ms waited \| disk: ([\d.]+) reads ([\d.]+) MB ([\d.]+) worker ms/gm;
  const frameAccount = /^(\S+) +INFO victory_gpu::copystat: frame account per frame: after a present ([\d.]+) ms until the first list call and ([\d.]+) ms until the first submission; ([\d.]+) ms from the last submission to the present call; lists reset in ([\d.]+) ms; the process ran ([\d.]+) ms user \+ ([\d.]+) ms kernel on all threads;[^\r\n]*?; ([\d.]+) held submissions run at the present with their waits not met\b/gm;
  const relay = /^(\S+) +INFO victory_gpu::host: the relay per frame \(VICTORY_RELAY=\d+\): ([\d.]+) flights landed in ([\d.]+) landings[^\r\n]+?waited ([\d.]+) ms for the card with nothing to land and ([\d.]+) ms for fetches of card copies' pieces, and was ([\d.]+) ms landing in all\b/gm;
  const relayCopies = /^(\S+) +INFO victory_gpu::host: relay card readbacks per frame: ([\d.]+) pieces in ([\d.]+) GPU copy commands\r?$/gm;
  const relayCopyTiming = /^(\S+) +INFO victory_gpu::host: relay GPU copy time per frame: ([\d.]+) ms in ([\d.]+) timed batches\r?$/gm;
  const copyQueues = /^(\S+) +INFO victory_gpu::queue2: the copy queues per frame \(VICTORY_QUEUE2=\d+\): fetches of what shaders wrote: ([\d.]+) jobs, ([\d.]+) MB, ([\d.]+) ms on their queue, our threads stood ([\d.]+) ms waiting for them\b/gm;
  const copyQueueUploads = /^(\S+) +INFO victory_gpu::queue2: the copy queues per frame[^\r\n]*?title bytes sent up: ([\d.]+) jobs, ([\d.]+) MB, ([\d.]+) ms on their queue; the direct queue was told to wait for them ([\d.]+) times and stood at ([\d.]+) of those for ([\d.]+) ms in all; landing buffers on the card: ([\d.]+) MB, ([\d.]+) sends found no room in them/gm;
  const refetch = /^(\S+) +INFO victory_gpu::host: the relay per frame[^\r\n]*?pieces fetched on the copy queue beside later submissions: ([\d.]+), pieces those fetched again at their own landing whatever the compare said: ([\d.]+) \(VICTORY_QUEUE2_REFETCH\)/gm;
  const fillFallback = /^(\S+) +WARN victory_gpu::host(?:::fill_ahead)?:[^\r\n]*Fills wait for flights again from here on\b/gm;
  const inflight = /^(\S+) +INFO victory_gpu::host: card copies' pieces fetched inside their flights per frame \(VICTORY_CARD_FETCH_INFLIGHT=1\): ([\d.]+) pieces \(([\d.]+) MB\) merged with no fetch of their own; ([\d.]+) landings fetched the old way \(the wait above\), ([\d.]+) of them because a flight's pieces overflowed the slots\b/gm;
  const stagedFetch = /^(\S+) +INFO victory_gpu::host: card copies' pieces staged inside their flights per frame \(VICTORY_CARD_FETCH_INFLIGHT=1\): ([\d.]+) pieces \(([\d.]+) MB\) merged from their slots, which came down \(([\d.]+) MB\) in ([\d.]+) ms of waiting on a copy queue;\s+([\d.]+) pieces flagged beyond their flight's region; ([\d.]+) landings fetched pieces the old way\b/gm;
  const resident = /^(\S+) +INFO victory_gpu::resident: residents \(VICTORY_INPLACE=4\): (\d+) alive, (\d+) MB in the card's memory and (\d+) MB of twins \(budget (\d+) MB\); per frame: ([\d.]+) MB uploaded from arenas in (\d+) ranges, ([\d.]+) MB compared in (\d+) merge passes, ([\d.]+) MB merged into arenas\b/gm;
  const dispatch = /^(\S+) +INFO victory_gpu::host: indirect compute dispatches: the largest group count in x asked for (\d+) \(run: at most \d+\), +([\d.]+) records per frame asked for more and were cut to that\b/gm;
  const descriptors = /^(\S+) +INFO victory_gpu::descriptor: descriptor records the title copied into its heap as bytes[^\r\n]*?: per frame ([\d.]+) changed heap pages, ([\d.]+) slots looked at, ([\d.]+) whose record was new and was mirrored, ([\d.]+) left to the\s+draws that read them through tables[^\r\n]*?, ([\d.]+) ms\r?$/gm;
  const meterReports = Array.from(contents.matchAll(meter));
  return {
    perReportAverages: summarizeCompleteReports(meterReports, start, end, [
      'fps', 'frameMs', 'prepareMs', 'submitWaitMs', 'copyBackMs', 'copyBackMb',
      'draws', 'droppedWithoutPipeline', 'droppedIndirect',
    ]),
    queueEstimatePerReport: summarizeCompleteReports(contents.matchAll(queue), start, end, [
      'unoccupiedMs', 'estimatedBusyPercent', 'unoccupiedWhileSubmittingMs', 'submitWaitMs',
    ]),
    preparationPerReport: summarizeCompleteReports(contents.matchAll(preparation), start, end, [
      'bufferCopyMs', 'bufferCopyMib', 'textureUploadMs', 'textureUploadMib',
    ]),
    copyWorkPerReport: summarizeCompleteReports(contents.matchAll(copyWork), start, end, [
      'refreshes', 'refreshMb', 'queries', 'queryMs', 'moveMs', 'unmappedMb',
      'pageFaults', 'watches', 'watchMs', 'checkedMb', 'unchangedMb', 'fallbacks',
    ]),
    plainCopyPerReport: summarizeCompleteReports(contents.matchAll(plainCopy), start, end, [
      'copies', 'copiedMb', 'copyFaults',
    ]),
    usualFramePerReport: summarizeCompleteReports(contents.matchAll(usualFrames), start, end, [
      'frames', 'frameMs', 'presentMs', 'presentSettleMs', 'presentShowMs',
      'copyMs', 'copyBackMs', 'otherGpuListMs', 'textureMs', 'textureMemoryWaitMs',
      'pipelinesMade', 'pipelinesLoaded', 'pipelineWaitMs', 'diskReads', 'diskMb', 'diskWorkerMs',
    ]),
    frameAccountPerReport: summarizeCompleteReports(contents.matchAll(frameAccount), start, end, [
      'untilFirstListMs', 'untilFirstSubmissionMs', 'afterLastSubmissionMs', 'listResetMs',
      'processUserMs', 'processKernelMs', 'forcedSubmissionsWithUnmetWaits',
    ]),
    relayPerReport: summarizeCompleteReports(contents.matchAll(relay), start, end, [
      'flights', 'landings', 'idleWaitMs', 'cardFetchWaitMs', 'landingMs',
    ]),
    relayCopiesPerReport: summarizeCompleteReports(contents.matchAll(relayCopies), start, end, [
      'pieces', 'copyCommands',
    ]),
    relayCopyTimingPerReport: summarizeCompleteReports(contents.matchAll(relayCopyTiming), start, end, [
      'gpuCopyMs', 'timedBatches',
    ]),
    copyQueueFetchPerReport: summarizeCompleteReports(contents.matchAll(copyQueues), start, end, [
      'fetchJobs', 'fetchMib', 'queueMs', 'threadWaitMs',
    ]),
    copyQueueUploadPerReport: summarizeCompleteReports(contents.matchAll(copyQueueUploads), start, end, [
      'uploadJobs', 'uploadMib', 'queueMs', 'directQueueWaits', 'directQueueStalls',
      'directQueueStallMs', 'landingBufferMib', 'fallbackSends',
    ]),
    copyQueueRefetchPerReport: summarizeCompleteReports(contents.matchAll(refetch), start, end, [
      'piecesFetchedBesideLaterFlights', 'piecesRefetchedAtLanding',
    ]),
    fillWaitFallbacksThroughSample: Array.from(contents.matchAll(fillFallback))
      .filter(([, stamp]) => Date.parse(stamp) <= end).length,
    inflightFetchPerReport: summarizeCompleteReports(contents.matchAll(inflight), start, end, [
      'mergedPieces', 'mergedMib', 'fallbackLandings', 'overflowLandings',
    ]),
    stagedFetchPerReport: summarizeCompleteReports(contents.matchAll(stagedFetch), start, end, [
      'mergedPieces', 'mergedMib', 'copiedMib', 'copyQueueWaitMs', 'overflowPieces', 'fallbackLandings',
    ]),
    residentPerReport: summarizeCompleteReports(contents.matchAll(resident), start, end, [
      'buffers', 'buffersMib', 'twinsMib', 'budgetMib', 'uploadedMib', 'uploadRanges',
      'comparedMib', 'mergePasses', 'mergedMib',
    ]),
    computeDispatchPerReport: summarizeCompleteReports(contents.matchAll(dispatch), start, end, [
      'largestXRequested', 'truncatedPerFrame',
    ]),
    descriptorSyncPerReport: summarizeCompleteReports(contents.matchAll(descriptors), start, end, [
      'changedPages', 'slotsScanned', 'slotsMirrored', 'slotsDeferred', 'syncMs',
    ]),
    pipelineDropsPerReport: summarizePipelineDrops(contents, meterReports, start, end),
  };
}

function summarizeCompleteReports(reports, start, end, fields) {
  const rows = [];
  let previous = -Infinity;
  for (const [, stamp, ...values] of reports) {
    const at = Date.parse(stamp);
    // A report covers the time since its previous report. Exclude partial windows.
    if (previous >= start && at <= end && at > previous) rows.push(values.map(Number));
    previous = at;
  }
  const result = { reports: rows.length };
  if (rows.length) {
    fields.forEach((field, index) => {
      result[field] = summarize(rows.map(row => row[index]));
    });
  }
  return result;
}

function summarizePipelineDrops(contents, meterReports, start, end) {
  const drop = /^\S+ +INFO victory_gpu::host: dropped ([\d.]+)\/frame without a host pipeline: ([^\r\n]+)\r?\n/gm;
  const ratesByReason = new Map();
  let index = -1;
  let complete = false;
  for (const match of contents.matchAll(drop)) {
    // The host prints these reasons immediately after a meter report.
    while (index + 1 < meterReports.length && meterReports[index + 1].index < match.index) {
      index++;
      const at = Date.parse(meterReports[index][1]);
      const previous = index > 0 ? Date.parse(meterReports[index - 1][1]) : -Infinity;
      complete = previous >= start && at <= end && at > previous;
    }
    if (!complete) continue;
    const [, rate, reason] = match;
    if (!ratesByReason.has(reason)) ratesByReason.set(reason, []);
    ratesByReason.get(reason).push(Number(rate));
  }
  // The logger limits how many reasons it prints per window.
  return Array.from(ratesByReason, ([reason, rates]) => ({
    reason,
    reportsWithReason: rates.length,
    droppedPerFrame: summarize(rates),
  })).sort((a, b) => b.droppedPerFrame.median - a.droppedPerFrame.median);
}

function readTrace(path) {
  const contents = readFileSync(path, 'utf8');
  const lines = contents.split(/\r?\n/);
  if (lines.shift() !== 'phase,frame,thread,start_us,end_us,value') throw new Error('Unrecognized frame trace header');
  // A concurrently written trace can end in the middle of a row.
  lines.pop();
  return lines.map((line, index) => {
    const [phase, ...fields] = line.split(',');
    if (!phase || fields.length !== 5 || !fields.every(field => /^\d+$/.test(field))) {
      throw new Error(`Malformed trace row ${index + 2}`);
    }
    const [frame, thread, start, end, value] = fields.map(Number);
    if (start > end) throw new Error(`Inverted span on row ${index + 2}`);
    return { phase, frame, thread, start, end, value };
  });
}

function addInterval(byPhase, phase, interval) {
  if (!byPhase.has(phase)) byPhase.set(phase, []);
  byPhase.get(phase).push(interval);
}

function merged(intervals) {
  const union = [];
  for (const [start, end] of intervals) {
    const last = union.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(end, last[1]);
    else union.push([start, end]);
  }
  return union;
}

function duration(intervals) {
  return intervals.reduce((total, [start, end]) => total + end - start, 0);
}

function overlap(a, b) {
  let total = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    const [aStart, aEnd] = a[i];
    const [bStart, bEnd] = b[j];
    total += Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
    if (aEnd < bEnd) i++;
    else j++;
  }
  return total;
}

function round(value) { return Math.round(value * 100) / 100; }

function summarize(numbers) {
  const sorted = numbers.toSorted((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return {
    median: round((sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: round(sorted.at(-1)),
  };
}
