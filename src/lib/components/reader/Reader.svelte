<script lang="ts">
  import { onMount, untrack, tick }        from "svelte";
  import { readerState, PAGE_STYLES }      from "$lib/state/reader.svelte";
  import { settingsState, updateSettings } from "$lib/state/settings.svelte";
  import { app }                           from "$lib/state/app.svelte";
  import { DEFAULT_KEYBINDS }              from "$lib/core/keybinds/defaultBinds";
  import { fetchPages, resolveUrl, preloadImage, measureAspect, buildPageGroups } from "$lib/components/reader/lib/pageLoader";
  import { setupScrollTracking, appendNextChapter }          from "$lib/components/reader/lib/scrollHandler";
  import { createReaderKeyHandler }                          from "$lib/components/reader/lib/readerKeybinds";
  import { markChapterRead, getMangaPrefs, toggleBookmark }  from "$lib/components/reader/lib/chapterActions";
  import { goForward, goBack, jumpToPage }                   from "$lib/components/reader/lib/navigation";
  import { clampZoom, captureZoomAnchor, restoreZoomAnchor } from "$lib/components/reader/lib/zoomHelpers";
  import { loadChapter, scheduleResumeDismiss }              from "$lib/components/reader/lib/chapterLoader";
  import { historyState }                                    from "$lib/state/history.svelte";
  import type { ReaderSettings }                             from "$lib/state/reader.svelte";
  import ReaderControls                                      from "$lib/components/reader/ReaderControls.svelte";
  import PageView                                            from "$lib/components/reader/PageView.svelte";
  import DictionaryLookupPopup                              from "$lib/components/reader/DictionaryLookupPopup.svelte";
  import ReaderProgressBar                                   from "$lib/components/reader/ReaderProgressBar.svelte";
  import ReaderOverlay                                       from "$lib/components/reader/ReaderOverlay.svelte";
  import ReaderPresetPanel                                   from "$lib/components/reader/ReaderPresetPanel.svelte";

  const useBlob = $derived((settingsState.settings.serverAuthMode ?? "NONE") !== "NONE");

  const effectiveReaderSettings = $derived.by(() => {
    const mangaId  = readerState.activeManga?.id;
    const override = mangaId != null ? (settingsState.settings.mangaReaderSettings ?? {})[mangaId] : undefined;
    return override ? { ...settingsState.settings, ...override } : settingsState.settings;
  });

  const rtl            = $derived(effectiveReaderSettings.readingDirection === "rtl");
  const fit            = $derived((effectiveReaderSettings.fitMode ?? "width") as ReaderSettings["fitMode"]);
  const style          = $derived((effectiveReaderSettings.pageStyle ?? "single") as typeof PAGE_STYLES[number]);
  const zoom           = $derived(effectiveReaderSettings.readerZoom ?? 1.0);
  const markOnNext     = $derived(settingsState.settings.markReadOnNext ?? true);
  const overlayBars    = $derived(settingsState.settings.overlayBars ?? false);
  const tapToToggleBar = $derived(settingsState.settings.tapToToggleBar ?? false);
  const barPosition    = $derived((settingsState.settings.barPosition ?? "top") as "top" | "left" | "right");
  const isVerticalBar  = $derived(barPosition === "left" || barPosition === "right");
  const lastPage       = $derived(readerState.pageUrls.length);
  const effectiveWidth = $derived(readerState.containerWidth > 0 ? Math.round(readerState.containerWidth * zoom) : undefined);
  const zoomPct        = $derived(Math.round(zoom * 100));
  const pinchZoomEnabled = $derived(settingsState.settings.pinchZoom ?? false);
  const containerized  = $derived(settingsState.settings.readerContainerized ?? false);

  const displayChapter = $derived(
    style === "longstrip" && readerState.visibleChapterId
      ? (readerState.activeChapterList.find(c => c.id === readerState.visibleChapterId) ?? readerState.activeChapter)
      : readerState.activeChapter
  );

  const currentBookmark = $derived(
    readerState.activeManga
      ? readerState.bookmarks.find(b => b.mangaId === readerState.activeManga!.id)
      : undefined
  );
  const isBookmarked = $derived(
    !!currentBookmark &&
    currentBookmark.chapterId === displayChapter?.id &&
    (style === "double"
      ? currentGroup.includes(currentBookmark.pageNumber)
      : currentBookmark.pageNumber === readerState.pageNumber)
  );

  const currentPageMarkers   = $derived(displayChapter ? readerState.getMarkersForPage(displayChapter.id, readerState.pageNumber) : []);
  const activeChapterMarkers = $derived(displayChapter ? readerState.getMarkersForChapter(displayChapter.id) : []);
  const hasMarkerOnPage      = $derived(currentPageMarkers.length > 0);

  const showResumeBanner = $derived(
    readerState.resumeVisible && readerState.resumePage > 1 &&
    (style === "longstrip" ? readerState.stripResumeReady : readerState.pageNumber === readerState.resumePage)
  );

  const adjacent = $derived.by(() => {
    const ref = displayChapter ?? readerState.activeChapter;
    if (!ref || !readerState.activeChapterList.length) return { prev: null, next: null, remaining: [] };
    const idx = readerState.activeChapterList.findIndex(c => c.id === ref.id);
    return {
      prev:      idx > 0                                        ? readerState.activeChapterList[idx - 1] : null,
      next:      idx < readerState.activeChapterList.length - 1 ? readerState.activeChapterList[idx + 1] : null,
      remaining: readerState.activeChapterList.slice(idx + 1),
    };
  });

  const visibleChunkLastPage = $derived.by(() => {
    if (style !== "longstrip") return lastPage;
    const chId  = readerState.visibleChapterId ?? readerState.activeChapter?.id;
    const chunk = readerState.stripChapters.find(c => c.chapterId === chId);
    return chunk?.urls.length ?? lastPage;
  });

  const imgCls = $derived([
    "img",
    fit === "width"    && "fit-width",
    fit === "height"   && "fit-height",
    fit === "screen"   && "fit-screen",
    fit === "original" && "fit-original",
    effectiveReaderSettings.optimizeContrast && "optimize-contrast",
  ].filter(Boolean).join(" "));

  const stripToRender = $derived(
    style === "longstrip"
      ? (readerState.stripChapters.length > 0
          ? readerState.stripChapters
          : [{ chapterId: readerState.activeChapter?.id ?? 0, chapterName: readerState.activeChapter?.name ?? "", urls: readerState.pageUrls }])
      : []
  );

  const currentGroup = $derived.by(() => {
    const group = style === "double" && readerState.pageGroups.length
      ? (readerState.pageGroups.find(g => g.includes(readerState.pageNumber)) ?? [readerState.pageNumber])
      : [readerState.pageNumber];
    return rtl ? [...group].reverse() : group;
  });

  const sliderPage = $derived.by(() => {
    if (style === "double" && readerState.pageGroups.length)
      return readerState.pageGroups.findIndex(g => g.includes(readerState.pageNumber)) + 1;
    return readerState.pageNumber;
  });

  const sliderMax = $derived.by(() => {
    if (style === "double" && readerState.pageGroups.length) return readerState.pageGroups.length;
    if (style === "longstrip") return visibleChunkLastPage || 1;
    return lastPage || 1;
  });

  const sliderPctRaw = $derived(sliderMax > 1 ? ((sliderPage - 1) / (sliderMax - 1)) * 100 : 0);
  const sliderPct    = $derived(rtl ? 100 - sliderPctRaw : sliderPctRaw);

  const perMangaEnabled = $derived(
    readerState.activeManga?.id != null &&
    !!(settingsState.settings.mangaReaderSettings ?? {})[readerState.activeManga.id]
  );

  let containerEl: HTMLDivElement | null = null;
  let pageViewRef: PageView;
  let zoomAnchor         = { el: null as HTMLElement | null, offset: 0 };
  let hideTimer          = $state<ReturnType<typeof setTimeout> | null>(null);
  let markedRead         = new Set<number>();
  let appending          = false;
  let abortCtrl          = { current: null as AbortController | null };
  let hasNavigated       = false;
  let startAtLastPageRef = { current: false };
  let cleanupScroll: () => void = () => {};
  let stripChaptersRef   = readerState.stripChapters;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => { stripChaptersRef = readerState.stripChapters; });

  function maybeMarkCurrentRead() {
    const ch = displayChapter ?? readerState.activeChapter;
    if (ch && markOnNext) markChapterRead(ch.id, markedRead);
  }

  function commitMarkerAction() {
    const ch    = displayChapter;
    const manga = readerState.activeManga;
    if (!ch || !manga) return;
    if (readerState.markerEditId) {
      readerState.updateMarker(readerState.markerEditId, { note: readerState.markerNote.trim(), color: readerState.markerColor });
    } else {
      readerState.addMarker({
        mangaId: manga.id, mangaTitle: manga.title, thumbnailUrl: manga.thumbnailUrl,
        chapterId: ch.id, chapterName: ch.name,
        pageNumber: readerState.pageNumber, note: readerState.markerNote.trim(), color: readerState.markerColor,
      });
    }
    readerState.clearMarkerPopover();
  }

  function deleteCurrentMarker() {
    if (readerState.markerEditId) readerState.removeMarker(readerState.markerEditId);
    readerState.clearMarkerPopover();
  }

  function showUi() {
    readerState.uiVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    if (!tapToToggleBar) {
      hideTimer = setTimeout(() => {
        if (!readerState.markerOpen && !readerState.winOpen) readerState.uiVisible = false;
      }, 3000);
    }
  }

  function toggleUiVisibility() {
    if (readerState.uiVisible) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      readerState.uiVisible = false;
    } else {
      readerState.uiVisible = true;
    }
  }

  function handleTap(e: MouseEvent) {
    const x = e.clientX / window.innerWidth;
    if (x > 0.6) goNext(); else if (x < 0.4) goPrev();
  }

  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    captureZoomAnchor(containerEl, style, zoomAnchor);
    applySettings({ readerZoom: clampZoom(zoom + (e.deltaY < 0 ? 0.05 : -0.05)) });
    restoreZoomAnchor(containerEl, zoomAnchor);
  }

  const startAtLast = () => { startAtLastPageRef.current = true; };

  const goNext = $derived(rtl
    ? () => goBack(style, adjacent, startAtLast)
    : () => goForward(style, adjacent, lastPage, maybeMarkCurrentRead, startAtLast));
  const goPrev = $derived(rtl
    ? () => goForward(style, adjacent, lastPage, maybeMarkCurrentRead, startAtLast)
    : () => goBack(style, adjacent, startAtLast));

  const onKey = createReaderKeyHandler({
    goNext:           () => goNext(),
    goPrev:           () => goPrev(),
    closeReader:      () => readerState.closeReader(),
    goToPage:         (p) => jumpToPage(p, style, lastPage, containerEl),
    lastPage:         () => lastPage,
    adjustZoom:       (d) => { captureZoomAnchor(containerEl, style, zoomAnchor); applySettings({ readerZoom: clampZoom(zoom + d) }); restoreZoomAnchor(containerEl, zoomAnchor); },
    resetZoom:        () => { captureZoomAnchor(containerEl, style, zoomAnchor); applySettings({ readerZoom: 1.0 }); restoreZoomAnchor(containerEl, zoomAnchor); },
    cycleStyle:       () => { const idx = PAGE_STYLES.indexOf(style); applySettings({ pageStyle: PAGE_STYLES[(idx + 1) % PAGE_STYLES.length] }); },
    toggleDirection:  () => applySettings({ readingDirection: rtl ? "ltr" : "rtl" }),
    openSettings: () => { app.setSettingsOpen(true); },
    toggleBookmark:   () => toggleBookmark(displayChapter, readerState.pageNumber),
    toggleAutoScroll: () => { if (style === "longstrip") updateSettings({ autoScroll: !(settingsState.settings.autoScroll ?? false) }); },
    toggleMarker:     () => {
      if (currentPageMarkers.length > 0) {
        const first = currentPageMarkers[0];
        readerState.openMarker(first.id, first.note, first.color);
      } else {
        readerState.openMarker("", "", "yellow");
      }
    },
    chapterNext: () => {
      const ch = rtl ? adjacent.prev : adjacent.next;
      if (ch) { maybeMarkCurrentRead(); readerState.openReader(ch, readerState.activeChapterList); }
    },
    chapterPrev: () => {
      const ch = rtl ? adjacent.next : adjacent.prev;
      if (ch) readerState.openReader(ch, readerState.activeChapterList);
    },
    closePopovers: () => readerState.closeAllPopovers(),
    getKeybinds:   () => settingsState.settings.keybinds ?? DEFAULT_KEYBINDS,
  });

  function bindContainer(el: HTMLDivElement) { containerEl = el; }

  function captureCurrentReaderSettings(): ReaderSettings {
    return {
      pageStyle:           style,
      fitMode:             fit,
      readingDirection:    (settingsState.settings.readingDirection ?? "ltr") as ReaderSettings["readingDirection"],
      readerZoom:          zoom,
      pageGap:             effectiveReaderSettings.pageGap ?? true,
      optimizeContrast:    effectiveReaderSettings.optimizeContrast ?? false,
      offsetDoubleSpreads: effectiveReaderSettings.offsetDoubleSpreads ?? false,
    };
  }

  function applySettings(patch: Partial<ReaderSettings>) {
    const mangaId = readerState.activeManga?.id;
    if (mangaId != null && (settingsState.settings.mangaReaderSettings ?? {})[mangaId]) {
      readerState.setMangaReaderSettings(mangaId, { ...(settingsState.settings.mangaReaderSettings ?? {})[mangaId]!, ...patch });
    } else {
      updateSettings(patch);
    }
  }

  function handleTogglePerManga() {
    const mangaId = readerState.activeManga?.id;
    if (mangaId == null) return;
    if ((settingsState.settings.mangaReaderSettings ?? {})[mangaId]) {
      readerState.clearMangaReaderSettings(mangaId);
    } else {
      readerState.setMangaReaderSettings(mangaId, captureCurrentReaderSettings());
    }
  }

  function handleSavePreset(name: string) {
    readerState.saveReaderPreset(name, captureCurrentReaderSettings());
  }

  function handleApplyPreset(settings: ReaderSettings) {
    const mangaId = readerState.activeManga?.id;
    if (mangaId != null && (settingsState.settings.mangaReaderSettings ?? {})[mangaId]) {
      readerState.setMangaReaderSettings(mangaId, settings);
    } else {
      updateSettings(settings);
    }
  }

  function handleBarPositionChange(pos: "top" | "left" | "right") {
    updateSettings({ barPosition: pos });
  }

  $effect(() => {
    const ch    = readerState.activeChapter;
    const manga = readerState.activeManga;
    if (ch && manga) {
      untrack(() => {
        historyState.openSession(
          manga.id, manga.title, manga.thumbnailUrl,
          ch.id, ch.name, readerState.pageNumber,
        );
        loadChapter(ch.id, useBlob, abortCtrl, startAtLastPageRef, markedRead, adjacent);
      });
    }
  });

  $effect(() => {
    const page   = readerState.pageNumber;
    const chId   = style === "longstrip"
      ? (readerState.visibleChapterId ?? readerState.activeChapter?.id)
      : readerState.activeChapter?.id;
    const chName = style === "longstrip"
      ? (readerState.activeChapterList.find(c => c.id === chId)?.name ?? readerState.activeChapter?.name ?? "")
      : (readerState.activeChapter?.name ?? "");

    if (!chId || !readerState.activeManga) return;

    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = setTimeout(() => {
      historyState.tickSession(chId, chName, page);
      tickTimer = null;
    }, 2_000);

    return () => {
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    };
  });

  $effect(() => {
    if (style === "longstrip" && readerState.pageUrls.length && readerState.activeChapter) {
      const ch       = readerState.activeChapter;
      const urls     = readerState.pageUrls;
      const targetPg = untrack(() => readerState.resumePage);
      appending                    = false;
      readerState.stripChapters    = [{ chapterId: ch.id, chapterName: ch.name, urls }];
      readerState.visibleChapterId = ch.id;
      tick().then(() => {
        if (!containerEl) return;
        if (targetPg > 1) {
          const chId = ch.id;
          const scrollToResumePage = () => {
            const target = containerEl!.querySelector<HTMLImageElement>(`img[data-local-page="${targetPg}"][data-chapter="${chId}"]`);
            if (!target) { requestAnimationFrame(scrollToResumePage); return; }
            containerEl!.querySelectorAll<HTMLImageElement>(`img[data-chapter="${chId}"]`).forEach((img, i) => { if (i < targetPg) img.loading = "eager"; });
            const doScroll = () => { target.scrollIntoView({ block: "start" }); readerState.stripResumeReady = true; };
            if (target.complete && target.naturalHeight > 0) doScroll();
            else { target.loading = "eager"; target.addEventListener("load", doScroll, { once: true }); }
          };
          scrollToResumePage();
          return;
        }
        containerEl!.scrollTop = 0;
      });
    }
  });

  $effect(() => { if (style !== "longstrip") readerState.resetInspect(); });

  $effect(() => {
    const chId = readerState.visibleChapterId;
    if (!chId || style !== "longstrip") return;
    if (chId === readerState.activeChapter?.id) return;
    const wasAppended = untrack(() => readerState.stripChapters.findIndex(c => c.chapterId === chId)) > 0;
    if (wasAppended) {
      untrack(() => {
        readerState.resumePage    = 0;
        readerState.resumeVisible = false;
        const prefs = getMangaPrefs(chId);
        if (prefs.downloadAhead > 0) {
          const list = readerState.activeChapterList;
          const idx  = list.findIndex(c => c.id === chId);
          if (idx >= 0) {
            const toQueue = list.slice(idx + 1, idx + 1 + prefs.downloadAhead)
              .filter(c => !c.downloaded && !c.read)
              .map(c => c.id);
            if (toQueue.length) {
              const DL = `mutation EnqueueDl($ids: [Int!]!) { enqueueChaptersDownloads(input: { ids: $ids }) { downloadStatus { queue { chapter { id } } } } }`;
              const base    = settingsState.settings.serverUrl ?? "http://localhost:4567";
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              const mode    = settingsState.settings.serverAuthMode ?? "NONE";
              if (mode === "BASIC_AUTH") {
                const u = settingsState.settings.serverAuthUser?.trim() ?? "";
                const p = settingsState.settings.serverAuthPass?.trim() ?? "";
                if (u && p) headers["Authorization"] = `Basic ${btoa(`${u}:${p}`)}`;
              }
              fetch(`${base}/api/graphql`, { method: "POST", headers, body: JSON.stringify({ query: DL, variables: { ids: toQueue } }) })
                .catch(console.error);
            }
          }
        }
      });
      return;
    }
    const bookmark = readerState.bookmarks.find(b => b.chapterId === chId);
    if (bookmark && bookmark.pageNumber > 1) {
      untrack(() => {
        readerState.resumePage       = bookmark.pageNumber;
        readerState.resumeDismissed  = false;
        readerState.resumeVisible    = true;
        readerState.stripResumeReady = true;
        scheduleResumeDismiss();
      });
    } else {
      untrack(() => readerState.resetResume());
    }
  });

  $effect(() => {
    void style;
    if (!containerEl) return;
    untrack(() => {
      cleanupScroll();
      cleanupScroll = setupScrollTracking(containerEl!, {
        onPageChange:    (p) => { readerState.pageNumber = p; },
        onChapterChange: (id) => { readerState.visibleChapterId = id; },
        onMarkRead:      (id) => markChapterRead(id, markedRead),
        onAppend:        () => {
          if (appending || !readerState.stripChapters.length) return;
          appending = true;
          appendNextChapter(
            stripChaptersRef,
            readerState.activeChapterList,
            (id) => fetchPages(id, useBlob),
            (url) => preloadImage(url, useBlob),
            (next) => { readerState.stripChapters = [...readerState.stripChapters, next]; appending = false; },
            () => { appending = false; },
          );
        },
        getStripChapters: () => stripChaptersRef,
        getPageUrls:      () => readerState.pageUrls,
        shouldAutoMark:   () => settingsState.settings.autoMarkRead ?? true,
      });
    });
  });

  $effect(() => {
    if (readerState.activeChapter && readerState.activeChapterList.length) {
      const idx = readerState.activeChapterList.findIndex(c => c.id === readerState.activeChapter!.id);
      if (idx >= 0) {
        const next = readerState.activeChapterList[idx + 1];
        const prev = readerState.activeChapterList[idx - 1];
        if (next) fetchPages(next.id, useBlob).then(urls => urls.slice(0, 8).forEach(u => preloadImage(u, useBlob))).catch(() => {});
        if (prev) fetchPages(prev.id, useBlob).then(urls => urls.slice(0, 2).forEach(u => preloadImage(u, useBlob))).catch(() => {});
      }
    }
  });

  $effect(() => {
    if (style === "double" && readerState.pageUrls.length) {
      let cancelled = false;
      const snap = readerState.pageUrls;
      Promise.all(snap.map(url => measureAspect(url, useBlob))).then(aspects => {
        if (cancelled || snap !== readerState.pageUrls) return;
        readerState.pageGroups = buildPageGroups(snap, aspects, effectiveReaderSettings.offsetDoubleSpreads ?? false);
      });
      return () => { cancelled = true; };
    } else {
      readerState.pageGroups = [];
    }
  });

  $effect(() => {
    const ahead   = settingsState.settings.preloadPages ?? 3;
    const current = readerState.pageUrls[readerState.pageNumber - 1];
    const pageNum = readerState.pageNumber;
    const urls    = readerState.pageUrls;
    if (!current) return;
    const t = setTimeout(() => {
      if (useBlob) {
        import("$lib/core/cache/imageCache").then(({ getBlobUrl, preloadBlobUrls }) => {
          getBlobUrl(current, 999);
          const upcoming = Array.from({ length: ahead }, (_, i) => urls[pageNum + i]).filter(Boolean) as string[];
          const behind   = urls[pageNum - 2];
          preloadBlobUrls(upcoming, ahead);
          if (behind) preloadBlobUrls([behind], 0);
        });
      } else {
        for (let i = 1; i <= ahead; i++) {
          const url = urls[pageNum - 1 + i];
          if (url) preloadImage(url, useBlob);
        }
        const behind = urls[pageNum - 2];
        if (behind) preloadImage(behind, useBlob);
      }
    }, 150);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (readerState.markerOpen || readerState.winOpen) {
      readerState.uiVisible = true;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }
  });

  $effect(() => {
    if (tapToToggleBar) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      readerState.uiVisible = true;
    }
  });

  $effect(() => {
    const ch    = displayChapter ?? readerState.activeChapter;
    const manga = readerState.activeManga;
    if (ch && lastPage && manga) {
      const { id: chapterId, name: chapterName } = ch;
      const { id: mangaId, title: mangaTitle, thumbnailUrl: thumb } = manga;
      const pageNum = readerState.pageNumber;
      const atLast  = pageNum === lastPage;
      if (pageNum > 1) hasNavigated = true;
      untrack(() => {
        if (!hasNavigated) return;
        if (style === "longstrip" && readerState.visibleChapterId && chapterId !== readerState.visibleChapterId) return;
        if (settingsState.settings.autoBookmark ?? true) {
          const existing = readerState.bookmarks.find(b => b.mangaId === mangaId && b.chapterId !== chapterId);
          if (existing) readerState.removeBookmark(existing.chapterId);
          readerState.addBookmark({ mangaId, mangaTitle, thumbnailUrl: thumb, chapterId, chapterName, pageNumber: pageNum });
        }
        if (style !== "longstrip" && (settingsState.settings.autoMarkRead ?? true) && atLast) markChapterRead(chapterId, markedRead);
      });
    }
  });

  $effect(() => {
    function onFsChange() { readerState.isFullscreen = !!document.fullscreenElement; }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  });

  onMount(() => {
    showUi();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", pageViewRef.onInspectMouseMove);
    window.addEventListener("mouseup",  pageViewRef.onInspectMouseUp);
    window.addEventListener("pointermove", pageViewRef.onPointerMove);
    window.addEventListener("pointerup",   pageViewRef.onPointerUp);

    readerState.isFullscreen = !!document.fullscreenElement;

    let roTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (roTimer) clearTimeout(roTimer);
      roTimer = setTimeout(() => { readerState.containerWidth = w; roTimer = null; }, 50);
    });
    if (containerEl) ro.observe(containerEl);

    return () => {
      historyState.closeSession();
      abortCtrl.current?.abort();
      if (hideTimer) clearTimeout(hideTimer);
      if (roTimer) clearTimeout(roTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", pageViewRef.onInspectMouseMove);
      window.removeEventListener("mouseup",  pageViewRef.onInspectMouseUp);
      window.removeEventListener("pointermove", pageViewRef.onPointerMove);
      window.removeEventListener("pointerup",   pageViewRef.onPointerUp);
      cleanupScroll();
      ro.disconnect();
    };
  });
</script>

<div
  class="root"
  class:containerized
  class:overlay-bars={overlayBars}
  class:bar-left={barPosition === "left"}
  class:bar-right={barPosition === "right"}
  class:pinch-active={pinchZoomEnabled}
  role="presentation"
  onmousemove={(e) => {
    if (!tapToToggleBar) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      if (barPosition === "top" && (y < 60 || h - y < 60)) showUi();
      if (barPosition === "left" && x < 60) showUi();
      if (barPosition === "right" && w - x < 60) showUi();
    }
  }}
>
  <ReaderControls
    {displayChapter} {adjacent} {visibleChunkLastPage}
    {zoom} {zoomPct}
    isFullscreen={readerState.isFullscreen}
    {isBookmarked} {hasMarkerOnPage} {currentPageMarkers}
    uiVisible={readerState.uiVisible}
    {barPosition}
    progressBar={isVerticalBar ? progressBarSnippet : undefined}
    onCaptureZoomAnchor={() => captureZoomAnchor(containerEl, style, zoomAnchor)}
    onRestoreZoomAnchor={() => restoreZoomAnchor(containerEl, zoomAnchor)}
    onMaybeMarkRead={maybeMarkCurrentRead}
    onToggleBookmark={() => toggleBookmark(displayChapter, readerState.pageNumber)}
    onCommitMarker={commitMarkerAction}
    onDeleteMarker={deleteCurrentMarker}
    onClampZoom={clampZoom}
    onApplySettings={applySettings}
    onSettingsOpen={() => { app.setSettingsOpen(true); }}
    {perMangaEnabled}
  />

  {#if readerState.presetOpen}
    <ReaderPresetPanel
      {fit} {style} {rtl} {zoom} {zoomPct}
      {perMangaEnabled}
      {barPosition}
      onBarPositionChange={handleBarPositionChange}
      onTogglePerManga={handleTogglePerManga}
      onApplySettings={applySettings}
      onSavePreset={handleSavePreset}
      onApplyPreset={handleApplyPreset}
      onUpdatePreset={(id, patch) => readerState.updateReaderPreset(id, patch)}
      onDeletePreset={(id) => readerState.deleteReaderPreset(id)}
      onCaptureZoomAnchor={() => captureZoomAnchor(containerEl, style, zoomAnchor)}
      onRestoreZoomAnchor={() => restoreZoomAnchor(containerEl, zoomAnchor)}
      onClampZoom={clampZoom}
    />
  {/if}

  <ReaderOverlay
    {showResumeBanner}
    resumePage={readerState.resumePage}
    resumeFading={readerState.resumeFading}
    {adjacent}
    onDismissResume={() => { readerState.resumeVisible = false; readerState.resumeFading = false; }}
  />

  <PageView
    bind:this={pageViewRef}
    {style} {imgCls} {effectiveWidth}
    loading={readerState.loading}
    error={readerState.error}
    pageReady={readerState.pageReady}
    pageGroups={readerState.pageGroups}
    {currentGroup} {stripToRender}
    fadingOut={readerState.fadingOut}
    {tapToToggleBar}
    {pinchZoomEnabled}
    {barPosition}
    onGetZoom={() => zoom}
    onSetZoom={(z) => { captureZoomAnchor(containerEl, style, zoomAnchor); applySettings({ readerZoom: z }); restoreZoomAnchor(containerEl, zoomAnchor); }}
    resolveUrl={(url, priority) => resolveUrl(url, useBlob, priority)}
    onTap={handleTap}
    onWheel={handleWheel}
    onToggleUi={toggleUiVisibility}
    {bindContainer}
  />

  <DictionaryLookupPopup />

  {#snippet progressBarSnippet()}
    <ReaderProgressBar
      {style}
      loading={readerState.loading}
      {rtl} {sliderPage} {sliderMax} {sliderPct} {lastPage}
      {displayChapter} {currentBookmark} {activeChapterMarkers} {adjacent}
      uiVisible={readerState.uiVisible}
      {barPosition}
      onGoPrev={goPrev}
      onGoNext={goNext}
      onJumpToPage={(p) => jumpToPage(p, style, lastPage, containerEl)}
    />
  {/snippet}

  {#if !isVerticalBar}
    <ReaderProgressBar
      {style}
      loading={readerState.loading}
      {rtl} {sliderPage} {sliderMax} {sliderPct} {lastPage}
      {displayChapter} {currentBookmark} {activeChapterMarkers} {adjacent}
      uiVisible={readerState.uiVisible}
      {barPosition}
      onGoPrev={goPrev}
      onGoNext={goNext}
      onJumpToPage={(p) => jumpToPage(p, style, lastPage, containerEl)}
    />
  {/if}
</div>

<style>
  .root { position: fixed; inset: 0; background: #000; display: flex; flex-direction: column; z-index: var(--z-reader); transform: translateZ(0); will-change: transform; }
  .root.containerized { position: relative; inset: auto; flex: 1; height: 100%; z-index: 0; transform: none; will-change: auto; }

  .root.overlay-bars :global(.topbar)    { position: absolute; top: 0; left: 0; right: 0; z-index: 10; }
  .root.overlay-bars :global(.bottombar) { position: absolute; bottom: 0; left: 0; right: 0; z-index: 10; }
  .root.overlay-bars :global(.viewer)    { height: 100%; }

  .root.bar-left  :global(.viewer) { margin-left: 40px; }
  .root.bar-right :global(.viewer) { margin-right: 40px; }

  .root.pinch-active :global(.viewer) { touch-action: none; }
</style>
