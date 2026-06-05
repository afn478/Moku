<script lang="ts">
  import OcrOverlay from "$lib/components/reader/OcrOverlay.svelte";

  interface Props {
    src: string;
    pageUrl: string;
    alt: string;
    className: string;
    styleText?: string;
    localPage?: number;
    chapterId?: number;
    total?: number;
    onLoad?: (img: HTMLImageElement) => void;
  }

  const {
    src,
    pageUrl,
    alt,
    className,
    styleText = "",
    localPage,
    chapterId,
    total,
    onLoad,
  }: Props = $props();
</script>

<span class="ocr-page-frame {className}" style={styleText}>
  <img
    {src}
    {alt}
    class="ocr-page-img"
    data-local-page={localPage}
    data-chapter={chapterId}
    data-total={total}
    loading="eager"
    decoding="async"
    draggable="false"
    onload={(event) => onLoad?.(event.currentTarget as HTMLImageElement)}
  />
  <OcrOverlay {pageUrl} context={alt} />
</span>

<style>
  .ocr-page-frame {
    position: relative;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    min-width: 0;
  }

  .ocr-page-img {
    display: block;
    grid-area: 1 / 1;
    user-select: none;
    image-rendering: auto;
    max-width: 100%;
    height: auto;
    min-width: 0;
  }

  .ocr-page-frame :global(.ocr-overlay) {
    grid-area: 1 / 1;
  }

  .ocr-page-frame:global(.fit-width) {
    width: 100%;
    max-width: var(--effective-width, 100%);
  }

  .ocr-page-frame:global(.fit-width) .ocr-page-img {
    width: 100%;
    height: auto;
  }

  .ocr-page-frame:global(.fit-height) {
    width: fit-content;
    max-width: var(--effective-width, 100%);
    max-height: calc(var(--visual-vh, 100vh) - 80px);
  }

  .ocr-page-frame:global(.fit-height) .ocr-page-img {
    width: auto;
    height: auto;
    max-width: var(--effective-width, 100%);
    max-height: calc(var(--visual-vh, 100vh) - 80px);
  }

  .ocr-page-frame:global(.fit-screen) {
    width: fit-content;
    max-width: var(--effective-width, 100%);
    max-height: calc(var(--visual-vh, 100vh) - 80px);
  }

  .ocr-page-frame:global(.fit-screen) .ocr-page-img {
    width: auto;
    height: auto;
    max-width: var(--effective-width, 100%);
    max-height: calc(var(--visual-vh, 100vh) - 80px);
    object-fit: contain;
  }

  .ocr-page-frame:global(.fit-original) {
    width: fit-content;
    max-width: 100%;
  }

  .ocr-page-frame:global(.fit-original) .ocr-page-img {
    width: auto;
    height: auto;
    max-width: 100%;
  }

  .ocr-page-frame:global(.page-half) {
    flex: 1;
    min-width: 0;
  }

  .ocr-page-frame:global(.page-half) .ocr-page-img {
    width: 100%;
    object-fit: contain;
  }

  .ocr-page-frame:global(.gap-left) {
    margin-right: 2px;
  }

  .ocr-page-frame:global(.gap-right) {
    margin-left: 2px;
  }

  .ocr-page-frame:global(.strip-gap) {
    margin-bottom: 8px;
  }

  .ocr-page-frame:global(.optimize-contrast) .ocr-page-img {
    image-rendering: -webkit-optimize-contrast;
  }
</style>
