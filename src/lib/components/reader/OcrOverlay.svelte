<script lang="ts">
  import { onMount, tick } from "svelte";
  import { settingsState } from "$lib/state/settings.svelte";
  import { openDictionaryLookup } from "$lib/state/dictionaryLookup.svelte";
  import { getOcrResults, type OcrLine } from "$lib/components/reader/lib/ocr";

  interface Props {
    pageUrl: string;
    context: string;
  }

  const { pageUrl, context }: Props = $props();

  let status = $state<"idle" | "loading" | "ready" | "error">("idle");
  let items = $state<OcrLine[]>([]);
  let activeIndex = $state<number | null>(null);
  let mergeAnchor = $state<number | null>(null);
  let overlayEl = $state<HTMLDivElement | null>(null);
  let measurementSpan = $state<HTMLSpanElement | null>(null);
  let resizeObserver: ResizeObserver | null = null;

  const enabled = $derived(settingsState.settings.readerOcrEnabled ?? false);
  const overlayMode = $derived(settingsState.settings.readerOcrOverlayMode ?? "hover");
  const orientation = $derived(settingsState.settings.readerOcrTextOrientation ?? "smart");
  const boxAdjustment = $derived(settingsState.settings.readerOcrBoxAdjustment ?? 4);
  const focusScale = $derived(settingsState.settings.readerOcrFocusScale ?? 1.12);
  const dimmedOpacity = $derived(settingsState.settings.readerOcrDimmedOpacity ?? 0.32);
  const horizontalMultiplier = $derived(settingsState.settings.readerOcrFontMultiplierHorizontal ?? 1);
  const verticalMultiplier = $derived(settingsState.settings.readerOcrFontMultiplierVertical ?? 1);
  const dictionaryLookupEnabled = $derived(settingsState.settings.readerDictionaryLookupEnabled ?? false);

  function textParts(text: string): string[] {
    return text.split("\u200B");
  }

  function escapeIndex(index: number): string {
    return `[data-ocr-index="${index}"]`;
  }

  function normalizedBox(item: OcrLine) {
    const box = item.tightBoundingBox;
    const right = Math.min(1, Math.max(0, box.x + box.width));
    const bottom = Math.min(1, Math.max(0, box.y + box.height));
    const x = Math.min(1, Math.max(0, box.x));
    const y = Math.min(1, Math.max(0, box.y));
    return {
      x,
      y,
      width: Math.max(0.001, right - x),
      height: Math.max(0.001, bottom - y),
    };
  }

  function shouldForceVertical(item: OcrLine): boolean | null {
    if (item.forcedOrientation === "vertical") return true;
    if (item.forcedOrientation === "horizontal") return false;
    if (orientation === "forceVertical") return true;
    if (orientation === "forceHorizontal") return false;
    return null;
  }

  function setMeasurementText(text: string, isMerged: boolean) {
    if (!measurementSpan) return;
    measurementSpan.textContent = "";
    const parts = textParts(text);
    parts.forEach((part, index) => {
      measurementSpan!.append(document.createTextNode(part));
      if (isMerged && index < parts.length - 1) measurementSpan!.append(document.createElement("br"));
    });
  }

  function bestFitSize(text: string, availableWidth: number, availableHeight: number, vertical: boolean): number {
    if (!measurementSpan || availableWidth <= 0 || availableHeight <= 0) return 1;

    const isMerged = text.includes("\u200B");
    measurementSpan.style.writingMode = vertical ? "vertical-rl" : "horizontal-tb";
    measurementSpan.style.whiteSpace = isMerged ? "normal" : "nowrap";
    setMeasurementText(text, isMerged);

    let low = 1;
    let high = 200;
    let best = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      measurementSpan.style.fontSize = `${mid}px`;

      const fits = measurementSpan.offsetWidth <= availableWidth && measurementSpan.offsetHeight <= availableHeight;
      if (fits) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  function fitBox(box: HTMLElement, item: OcrLine) {
    const text = item.text ?? "";
    if (!text.trim()) return;

    const availableWidth = box.offsetWidth + boxAdjustment;
    const availableHeight = box.offsetHeight + boxAdjustment;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const horizontalSize = bestFitSize(text, availableWidth, availableHeight, false);
    const verticalSize = bestFitSize(text, availableWidth, availableHeight, true);
    const forcedVertical = shouldForceVertical(item);
    const isVertical = forcedVertical ?? verticalSize > horizontalSize;
    const rawSize = isVertical ? verticalSize : horizontalSize;
    const multiplier = isVertical ? verticalMultiplier : horizontalMultiplier;
    const finalSize = Math.max(8, rawSize) * multiplier;

    box.classList.toggle("vertical", isVertical);
    box.style.fontSize = `${finalSize}px`;
    box.style.whiteSpace = text.includes("\u200B") ? "normal" : "nowrap";
    box.style.textAlign = text.includes("\u200B") ? "start" : "center";
  }

  function fitAllBoxes() {
    if (!overlayEl || !measurementSpan) return;
    const boxes = overlayEl.querySelectorAll<HTMLElement>(".ocr-box");
    boxes.forEach((box) => {
      const rawIndex = box.dataset.ocrIndex;
      if (rawIndex === undefined) return;
      const item = items[Number(rawIndex)];
      if (item) fitBox(box, item);
    });
    measurementSpan.style.writingMode = "horizontal-tb";
  }

  function scheduleFit() {
    void tick().then(() => requestAnimationFrame(fitAllBoxes));
  }

  function deleteBox(index: number) {
    items = items.filter((_, i) => i !== index);
    activeIndex = null;
    mergeAnchor = null;
    scheduleFit();
  }

  function mergeBoxes(anchorIndex: number, sourceIndex: number) {
    const anchor = items[anchorIndex];
    const source = items[sourceIndex];
    if (!anchor || !source || anchorIndex === sourceIndex) return;

    const a = normalizedBox(anchor);
    const b = normalizedBox(source);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);

    const anchorVertical = shouldForceVertical(anchor) ?? a.height > a.width;
    const sourceVertical = shouldForceVertical(source) ?? b.height > b.width;
    const merged: OcrLine = {
      ...anchor,
      text: `${anchor.text}\u200B${source.text}`,
      tightBoundingBox: { x, y, width: right - x, height: bottom - y },
      forcedOrientation: anchorVertical && sourceVertical ? "vertical" : "auto",
      isMerged: true,
      confidence: Math.min(anchor.confidence ?? 1, source.confidence ?? 1),
    };

    const next = items.filter((_, i) => i !== anchorIndex && i !== sourceIndex);
    next.push(merged);
    items = next;
    activeIndex = next.length - 1;
    mergeAnchor = null;
    scheduleFit();
  }

  function handleBoxClick(event: MouseEvent, index: number) {
    event.stopPropagation();

    if (event.altKey) {
      deleteBox(index);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (mergeAnchor === null) {
        mergeAnchor = index;
      } else {
        mergeBoxes(mergeAnchor, index);
      }
      return;
    }

    activeIndex = activeIndex === index ? null : index;
    mergeAnchor = null;

    if (dictionaryLookupEnabled) {
      const item = items[index];
      if (!item) return;
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      openDictionaryLookup(item.text, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        isVertical: target.classList.contains("vertical"),
      });
    }
  }

  $effect(() => {
    if (!enabled || !pageUrl) {
      status = "idle";
      items = [];
      return;
    }

    let cancelled = false;
    status = "loading";

    getOcrResults(pageUrl, context)
      .then((result) => {
        if (cancelled) return;
        items = result;
        status = "ready";
        scheduleFit();
      })
      .catch(() => {
        if (cancelled) return;
        status = "error";
        items = [];
      });

    return () => { cancelled = true; };
  });

  $effect(() => {
    void items;
    void orientation;
    void boxAdjustment;
    void horizontalMultiplier;
    void verticalMultiplier;
    scheduleFit();
  });

  onMount(() => {
    resizeObserver = new ResizeObserver(scheduleFit);
    if (overlayEl) resizeObserver.observe(overlayEl);
    window.addEventListener("resize", scheduleFit);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleFit);
    };
  });
</script>

{#if enabled}
  <div
    bind:this={overlayEl}
    class="ocr-overlay mode-{overlayMode}"
    class:ready={status === "ready" && items.length > 0}
    class:has-active={activeIndex !== null || mergeAnchor !== null}
    style={`--ocr-focus-scale:${focusScale};--ocr-dimmed-opacity:${dimmedOpacity};`}
    aria-hidden="true"
  >
    {#each items as item, index (item.text + ":" + index)}
      {@const box = normalizedBox(item)}
      <button
        type="button"
        class="ocr-box"
        class:active={activeIndex === index}
        class:selected={mergeAnchor === index}
        data-ocr-index={index}
        style={`left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%;`}
        title="Ctrl-click to merge, Alt-click to remove"
        onclick={(event) => handleBoxClick(event, index)}
      >
        {#each textParts(item.text) as part, partIndex}
          {part}{#if partIndex < textParts(item.text).length - 1}<br />{/if}
        {/each}
      </button>
    {/each}
    <span bind:this={measurementSpan} class="ocr-measure" aria-hidden="true"></span>
  </div>
{/if}

<style>
  .ocr-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.14s ease;
  }

  .ocr-overlay.ready.mode-always,
  .ocr-overlay.ready.has-active,
  :global(.ocr-page-frame:hover) .ocr-overlay.ready.mode-hover,
  :global(.ocr-page-frame:focus-within) .ocr-overlay.ready.mode-hover {
    opacity: 1;
    pointer-events: auto;
  }

  .ocr-box {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: #fff;
    cursor: text;
    font-family: var(--font-ui), system-ui, sans-serif;
    font-weight: 800;
    line-height: 1.02;
    letter-spacing: 0;
    mix-blend-mode: difference;
    text-align: center;
    text-shadow: 0 0 1px rgba(0, 0, 0, 0.75), 0 0 2px rgba(255, 255, 255, 0.35);
    user-select: text;
    -webkit-user-select: text;
    transition: opacity 0.12s ease, transform 0.12s ease, background 0.12s ease, color 0.12s ease;
    transform-origin: center;
    word-break: keep-all;
    overflow-wrap: normal;
    unicode-bidi: plaintext;
  }

  .ocr-box.vertical {
    writing-mode: vertical-rl;
    text-orientation: upright;
  }

  .ocr-box:hover,
  .ocr-box.active,
  .ocr-box.selected {
    z-index: 3;
    overflow: visible;
    transform: scale(var(--ocr-focus-scale));
    mix-blend-mode: normal;
    background: color-mix(in srgb, var(--bg-surface) 78%, transparent);
    color: var(--accent-fg);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent), 0 4px 16px rgba(0, 0, 0, 0.45);
    border-radius: 2px;
  }

  .ocr-box.selected {
    color: #f7d96b;
    box-shadow: 0 0 0 2px #f7d96b, 0 4px 18px rgba(0, 0, 0, 0.55);
  }

  .ocr-overlay:has(.ocr-box:hover) .ocr-box:not(:hover),
  .ocr-overlay.has-active .ocr-box:not(.active):not(.selected) {
    opacity: var(--ocr-dimmed-opacity);
  }

  .ocr-measure {
    position: fixed;
    left: -10000px;
    top: -10000px;
    visibility: hidden;
    pointer-events: none;
    font-family: var(--font-ui), system-ui, sans-serif;
    font-weight: 800;
    line-height: 1.02;
    letter-spacing: 0;
  }
</style>
