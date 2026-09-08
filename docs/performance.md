# Performance evidence and budgets

## Repeatable checks

Use Node 24, install the locked dependencies and Chromium, then run:

```sh
npm run check:release
```

This includes `npm run check:performance`, which requires an existing production build and reports gzip sizes plus native engine/save timings. The release gate fails above **225 KiB total emitted client JavaScript**, **64 KiB page JavaScript**, or **16 KiB CSS**. These are regression budgets with headroom, not claims about initial transfer size or loading speed. Investigate a regression before changing the limits.

The mobile browser test runs at 4× CPU slowdown with a 40-entry saved history. It checks ten persisted life changes, setup typing, spell confirmation and horizontal overflow. Chromium PerformanceObserver records long tasks, layout shifts and Event Timing entries; a second-animation-frame measurement approximates click-to-render time. Event Timing excludes entries below its 16 ms threshold. These are **lab measurements, not field INP**. Scryfall requests are blocked to keep the comparison repeatable; real image-network latency is not measured.

For a sequential local comparison:

```sh
npx playwright test performance.spec.mjs --project mobile --repeat-each 3 --workers 1
```

Results and base64-encoded JSON measurement attachments are stored in `test-results/results.json`; a viewport screenshot is saved per run. GitHub Actions retains this evidence for seven days. The first desktop copy of this mobile-only test is intentionally skipped. Absolute browser timing is reported rather than gated, because shared CI hardware varies substantially.

## September 2026 measurements

After milestone 8, the production export contained 573,314 bytes of JavaScript, **169,877 bytes gzip** across ten emitted files. The page chunk was **42,265 bytes gzip**, and CSS was **8,648 bytes gzip**. All are comfortably below the budgets. The count includes small emitted helper files, not just the eight hashed chunks.

The final verified build, including the small readability and departed-recipient reminder fixes, measures **169,899 bytes JavaScript gzip**, **42,286 bytes page gzip**, and **8,667 bytes CSS gzip**.

A 13,365-byte session with 40 retained entries was sampled after 200 warmup calls, in 25 batches of 100 calls:

| Operation | Median per operation | 95th percentile batch mean |
| --- | ---: | ---: |
| Serialize and validate | 0.0386 ms | 0.0565 ms |
| Parse and validate save | 0.1022 ms | 0.1231 ms |
| Validate, save and back up in memory | 0.1674 ms | 0.2035 ms |
| Generate event | 0.0060 ms | 0.0104 ms |

Memory storage excludes browser storage I/O. These results do not justify caching the rules engine or delaying autosaves, so those speculative changes were not introduced. Existing validation, recoverable backups and cross-tab conflict protection remain intact.

Three sequential mobile baseline runs measured Table setup click-to-second-frame at **284.1 / 262.4 / 275.8 ms**. Their worst reported interaction durations were **312 / 296 / 304 ms**. A mobile blur-removal experiment returned worst durations of **400 / 304 / 272 ms**: the median was unchanged, so the full-backdrop change was rejected rather than presented as a speedup. Other single runs varied from 216 to 416 ms, illustrating why one measurement is insufficient.

Visual inspection independently found low-contrast preset controls on the existing dark setup panel and text showing through its sticky header. Preset foreground/button contrast and an opaque header were corrected; no latency gain is attributed to those accessibility/readability fixes.

## Interpretation and next trigger

The largest measured interaction is opening the dense setup dialog, not the numeric simulation. If field data or repeatable traces show this remains a problem, profile dialog mounting/layout before isolating or deferring its secondary sections. No worker, cache, virtualization framework or new runtime dependency was added for this roadmap.

The existing Vercel Speed Insights integration is the source for real-user performance when enabled. No account-level field dataset was available in this run, so this release makes no claim about field percentiles. Layout-shift samples include initial hydration/import as well as interaction and must not be interpreted as a clean-navigation field CLS score.
