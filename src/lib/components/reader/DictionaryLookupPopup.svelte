<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowClockwise, CaretLeft, CaretRight, X } from "phosphor-svelte";
  import { settingsState } from "$lib/state/settings.svelte";
  import {
    closeDictionaryLookup,
    dictionaryLookupState,
    retryDictionaryLookup,
    type DictionaryLookupAnchor,
  } from "$lib/state/dictionaryLookup.svelte";
  import { glossaryToPlainText, type HoshiLookupResult } from "$lib/components/reader/lib/dictionary";

  interface PopupFrame {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  let activeIndex = $state(0);
  let viewportWidth = $state(1280);
  let viewportHeight = $state(720);

  const popupWidth = $derived(settingsState.settings.readerDictionaryPopupWidth ?? 320);
  const popupHeight = $derived(settingsState.settings.readerDictionaryPopupHeight ?? 250);
  const popupScale = $derived(Math.max(0.8, Math.min(1.5, settingsState.settings.readerDictionaryPopupScale ?? 1)));
  const fullWidth = $derived(settingsState.settings.readerDictionaryPopupFullWidth ?? false);
  const actionBar = $derived(settingsState.settings.readerDictionaryPopupActionBar ?? false);
  const compactGlossaries = $derived(settingsState.settings.readerDictionaryCompactGlossaries ?? true);
  const showExpressionTags = $derived(settingsState.settings.readerDictionaryShowExpressionTags ?? false);
  const compactPitchAccents = $derived(settingsState.settings.readerDictionaryCompactPitchAccents ?? true);

  const currentResult = $derived(dictionaryLookupState.results[activeIndex] as HoshiLookupResult | undefined);
  const frame = $derived.by(() => {
    const anchor = dictionaryLookupState.anchor;
    if (!anchor) return null;
    return calculatePopupFrame(anchor, viewportWidth, viewportHeight);
  });
  const frameStyle = $derived(frame
    ? `left:${frame.left}px;top:${frame.top}px;width:${frame.width}px;height:${frame.height}px;--popup-scale:${popupScale};`
    : "");

  function updateViewport() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
  }

  function calculatePopupFrame(anchor: DictionaryLookupAnchor, screenWidth: number, screenHeight: number): PopupFrame {
    const popupPadding = 4;
    const screenBorderPadding = 6;
    const maxWidth = popupWidth * popupScale;
    const maxHeight = popupHeight * popupScale;
    const isVertical = anchor.isVertical;

    const spaceLeft = anchor.left - popupPadding;
    const spaceRight = screenWidth - anchor.left - anchor.width - popupPadding;
    const spaceAbove = anchor.top - popupPadding;
    const spaceBelow = screenHeight - anchor.top - anchor.height - popupPadding;

    const width = fullWidth
      ? screenWidth - screenBorderPadding * 2
      : isVertical
        ? Math.min(Math.max(spaceLeft, spaceRight) - screenBorderPadding, maxWidth)
        : Math.min(screenWidth - screenBorderPadding * 2, maxWidth);

    const height = isVertical || fullWidth
      ? maxHeight
      : Math.min(Math.max(spaceAbove, spaceBelow) - screenBorderPadding, maxHeight);

    const safeWidth = Math.max(220, width);
    const safeHeight = Math.max(160, height);

    let centerX: number;
    if (fullWidth) {
      centerX = safeWidth / 2 + screenBorderPadding;
    } else if (isVertical) {
      const showOnRight = spaceRight >= spaceLeft || spaceRight >= maxWidth;
      centerX = showOnRight
        ? anchor.left + anchor.width + popupPadding + safeWidth / 2
        : anchor.left - popupPadding - safeWidth / 2;
      centerX = clamp(centerX, safeWidth / 2 + screenBorderPadding, screenWidth - safeWidth / 2 - screenBorderPadding);
    } else {
      centerX = clamp(anchor.left + safeWidth / 2, safeWidth / 2 + screenBorderPadding, screenWidth - safeWidth / 2 - screenBorderPadding);
    }

    let centerY: number;
    if (fullWidth) {
      centerY = screenHeight - safeHeight / 2 - screenBorderPadding;
    } else if (isVertical) {
      centerY = clamp(anchor.top + safeHeight / 2, safeHeight / 2 + screenBorderPadding, screenHeight - safeHeight / 2 - screenBorderPadding);
    } else {
      const showBelow = spaceBelow >= safeHeight;
      centerY = showBelow
        ? anchor.top + anchor.height + popupPadding + safeHeight / 2
        : anchor.top - popupPadding - safeHeight / 2;
      centerY = clamp(centerY, safeHeight / 2 + screenBorderPadding, screenHeight - safeHeight / 2 - screenBorderPadding);
    }

    return {
      left: Math.round(centerX - safeWidth / 2),
      top: Math.round(centerY - safeHeight / 2),
      width: Math.round(safeWidth),
      height: Math.round(safeHeight),
    };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
  }

  function splitTags(tags: string | undefined): string[] {
    return (tags ?? "").split(/\s+/).map((tag) => tag.trim()).filter(Boolean);
  }

  function deinflectionTrace(result: HoshiLookupResult): string[] {
    return result.process.map((step) => step.name).filter(Boolean).reverse();
  }

  function glossaryText(content: string): string {
    const text = glossaryToPlainText(content);
    return compactGlossaries ? text.replace(/\s+/g, " ").trim() : text;
  }

  function previousEntry() {
    if (activeIndex > 0) activeIndex -= 1;
  }

  function nextEntry() {
    if (activeIndex < dictionaryLookupState.results.length - 1) activeIndex += 1;
  }

  $effect(() => {
    void dictionaryLookupState.query;
    activeIndex = 0;
  });

  onMount(() => {
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  });
</script>

{#if dictionaryLookupState.open && frame}
  <button
    class="lookup-scrim"
    type="button"
    aria-label="Close dictionary lookup"
    onclick={closeDictionaryLookup}
  ></button>

  <div
    class="lookup-popup"
    class:loading={dictionaryLookupState.status === "loading"}
    style={frameStyle}
    role="dialog"
    tabindex="-1"
    aria-label="Dictionary lookup"
    onpointerdown={(event) => event.stopPropagation()}
  >
    {#if actionBar}
      <div class="popup-action-bar">
        <button type="button" class="icon-btn" aria-label="Previous entry" disabled={activeIndex === 0} onclick={previousEntry}>
          <CaretLeft size={17} weight="bold" />
        </button>
        <button type="button" class="icon-btn" aria-label="Next entry" disabled={activeIndex >= dictionaryLookupState.results.length - 1} onclick={nextEntry}>
          <CaretRight size={17} weight="bold" />
        </button>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" aria-label="Close" onclick={closeDictionaryLookup}>
          <X size={16} weight="bold" />
        </button>
      </div>
    {/if}

    <div class="popup-body">
      {#if dictionaryLookupState.status === "loading"}
        <div class="lookup-empty">
          <span class="loader"></span>
          <span>Looking up {dictionaryLookupState.query}</span>
        </div>
      {:else if dictionaryLookupState.status === "error"}
        <div class="lookup-empty">
          <strong>Dictionary server unavailable</strong>
          <span>{dictionaryLookupState.error}</span>
          <button type="button" class="text-btn" onclick={retryDictionaryLookup}>
            <ArrowClockwise size={14} weight="bold" />
            Retry
          </button>
        </div>
      {:else if dictionaryLookupState.status === "empty"}
        <div class="lookup-empty">
          <strong>No entries</strong>
          <span>{dictionaryLookupState.query}</span>
        </div>
      {:else if currentResult}
        <article class="entry">
          <header class="entry-header">
            <div class="expression-scroll">
              <ruby class="expression">
                {currentResult.term.expression || currentResult.deinflected || currentResult.matched}<rt>{currentResult.term.reading}</rt>
              </ruby>
            </div>
            <div class="header-buttons">
              {#if dictionaryLookupState.results.length > 1}
                <span class="entry-count">{activeIndex + 1}/{dictionaryLookupState.results.length}</span>
              {/if}
              {#if !actionBar}
                <button type="button" class="icon-btn" aria-label="Previous entry" disabled={activeIndex === 0} onclick={previousEntry}>
                  <CaretLeft size={15} weight="bold" />
                </button>
                <button type="button" class="icon-btn" aria-label="Next entry" disabled={activeIndex >= dictionaryLookupState.results.length - 1} onclick={nextEntry}>
                  <CaretRight size={15} weight="bold" />
                </button>
                <button type="button" class="icon-btn" aria-label="Close" onclick={closeDictionaryLookup}>
                  <X size={15} weight="bold" />
                </button>
              {/if}
            </div>
          </header>

          <div class="entry-tags">
            {#if currentResult.deinflected && currentResult.deinflected !== currentResult.term.expression}
              <span class="deinflection-tag">{currentResult.deinflected}</span>
            {/if}
            {#each deinflectionTrace(currentResult) as tag}
              <span class="deinflection-tag">{tag}</span>
            {/each}
            {#if showExpressionTags}
              {#each splitTags(currentResult.term.rules) as tag}
                <span class="expr-tag">{tag}</span>
              {/each}
            {/if}
          </div>

          {#if currentResult.term.frequencies.length > 0 || currentResult.term.pitches.length > 0}
            <div class="meta-row">
              {#each currentResult.term.frequencies as group}
                {#if group.frequencies.length}
                  <span class="frequency-group">
                    <span class="frequency-dict-label">{group.dictName}</span>
                    <span class="frequency-values">
                      {group.frequencies.map((frequency) => frequency.displayValue || String(frequency.value)).join(", ")}
                    </span>
                  </span>
                {/if}
              {/each}
              {#each currentResult.term.pitches as pitch}
                {#if pitch.pitchPositions.length}
                  <span class="pitch-group" class:compact={compactPitchAccents}>
                    <span>{pitch.dictName}</span>
                    <b>{pitch.pitchPositions.join(", ")}</b>
                  </span>
                {/if}
              {/each}
            </div>
          {/if}

          <div class="glossary-list">
            {#each currentResult.term.glossaries as glossary}
              <section class="glossary">
                <div class="dictionary-name">{glossary.dictName}</div>
                {#if splitTags(glossary.definitionTags).length || splitTags(glossary.termTags).length}
                  <div class="tag-row">
                    {#each splitTags(glossary.definitionTags) as tag}
                      <span class="expr-tag">{tag}</span>
                    {/each}
                    {#each splitTags(glossary.termTags) as tag}
                      <span class="expr-tag">{tag}</span>
                    {/each}
                  </div>
                {/if}
                <p class="glossary-text">{glossaryText(glossary.glossary)}</p>
              </section>
            {/each}
          </div>
        </article>
      {/if}
    </div>
  </div>
{/if}

<style>
  .lookup-scrim {
    position: fixed;
    inset: 0;
    z-index: 32;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .lookup-popup {
    position: fixed;
    z-index: 33;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-surface) 94%, #ffffff 6%);
    color: var(--text-primary);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.48), 0 3px 14px rgba(0, 0, 0, 0.38);
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", var(--font-ui), system-ui, sans-serif;
    font-size: calc(15px * var(--popup-scale, 1));
    line-height: 1.38;
  }

  .popup-action-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    flex: 0 0 32px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-dim);
    background: var(--bg-raised);
  }

  .popup-body {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 0 10px 10px;
  }

  .spacer { flex: 1; }

  .entry {
    padding: 4px 0;
  }

  .entry-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
  }

  .expression-scroll {
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
  }

  .expression-scroll::-webkit-scrollbar {
    display: none;
  }

  .expression {
    display: inline-block;
    white-space: nowrap;
    font-size: calc(26px * var(--popup-scale, 1));
    font-weight: 600;
    letter-spacing: 0;
  }

  .expression rt {
    color: var(--text-secondary);
    font-size: calc(13px * var(--popup-scale, 1));
    font-weight: 500;
  }

  .header-buttons {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 4px;
  }

  .icon-btn,
  .text-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }

  .icon-btn:hover:not(:disabled),
  .text-btn:hover {
    background: var(--bg-overlay);
    color: var(--text-primary);
  }

  .icon-btn:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .entry-count {
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .entry-tags,
  .tag-row,
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .entry-tags {
    margin-top: -2px;
  }

  .meta-row {
    margin-top: 8px;
  }

  .deinflection-tag,
  .expr-tag,
  .frequency-group,
  .pitch-group {
    border-radius: 4px;
    font-size: 11px;
    line-height: 1;
  }

  .deinflection-tag,
  .expr-tag {
    padding: 3px 5px;
    background: color-mix(in srgb, var(--bg-overlay) 82%, transparent);
    color: var(--text-secondary);
  }

  .expr-tag {
    background: color-mix(in srgb, var(--accent-muted) 74%, transparent);
    color: var(--accent-fg);
  }

  .frequency-group {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid #77aaeb;
  }

  .frequency-dict-label {
    display: flex;
    align-items: center;
    padding: 4px;
    background: #477fc5;
    color: #fff;
  }

  .frequency-values {
    padding: 4px;
    color: var(--text-secondary);
  }

  .pitch-group {
    display: inline-flex;
    gap: 5px;
    padding: 4px 5px;
    border: 1px solid color-mix(in srgb, #d6a657 70%, transparent);
    color: var(--text-secondary);
  }

  .pitch-group b {
    color: #e8c777;
    font-weight: 700;
  }

  .pitch-group.compact {
    padding-block: 3px;
  }

  .glossary-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 9px;
  }

  .glossary {
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, var(--border-base) 86%, transparent);
  }

  .dictionary-name {
    color: var(--accent-fg);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    text-transform: uppercase;
  }

  .tag-row {
    margin-top: 5px;
  }

  .glossary-text {
    margin-top: 5px;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .lookup-empty {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 18px;
    text-align: center;
    color: var(--text-muted);
  }

  .lookup-empty strong {
    color: var(--text-primary);
  }

  .text-btn {
    gap: 5px;
    min-height: 28px;
    padding: 0 9px;
    border-radius: 6px;
    background: var(--bg-raised);
    color: var(--text-secondary);
  }

  .loader {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent-fg);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
