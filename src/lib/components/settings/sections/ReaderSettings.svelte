<script lang="ts">
  import { settingsState, updateSettings } from '$lib/state/settings.svelte'
  import type {
    Settings,
    FitMode,
    ReaderDictionaryPopupProfile,
    ReaderOcrOverlayMode,
    ReaderOcrTextOrientation,
  } from '$lib/types/settings'

  interface Props {
    selectOpen: string | null
    closingSelect?: string | null
    toggleSelect: (id: string) => void
    anims: boolean
  }
  let { selectOpen, toggleSelect, anims }: Props = $props()

  let triggerPageStyle  = $state<HTMLButtonElement>(null!)
  let triggerReadingDir = $state<HTMLButtonElement>(null!)
  let triggerFitMode    = $state<HTMLButtonElement>(null!)
  let triggerOcrMode    = $state<HTMLButtonElement>(null!)
  let triggerOcrText    = $state<HTMLButtonElement>(null!)
  let triggerDictProfile = $state<HTMLButtonElement>(null!)

  const dictionaryProfileLabels: Record<ReaderDictionaryPopupProfile, string> = {
    hoshi: 'Hoshi default',
    compact: 'Compact',
    wide: 'Wide',
    custom: 'Custom',
  }

  function applyDictionaryPopupProfile(profile: ReaderDictionaryPopupProfile) {
    const patch = profile === 'compact'
      ? { readerDictionaryPopupWidth: 280, readerDictionaryPopupHeight: 220, readerDictionaryPopupScale: 0.9, readerDictionaryPopupFullWidth: false, readerDictionaryPopupActionBar: false }
      : profile === 'wide'
        ? { readerDictionaryPopupWidth: 440, readerDictionaryPopupHeight: 320, readerDictionaryPopupScale: 1, readerDictionaryPopupFullWidth: false, readerDictionaryPopupActionBar: true }
        : { readerDictionaryPopupWidth: 320, readerDictionaryPopupHeight: 250, readerDictionaryPopupScale: 1, readerDictionaryPopupFullWidth: false, readerDictionaryPopupActionBar: false }
    updateSettings({ readerDictionaryPopupProfile: profile, ...patch })
  }
</script>

<div class="s-panel">

  <div class="s-section">
    <p class="s-section-title">Page Layout</p>
    <div class="s-section-body">
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Default layout</span><span class="s-desc">How chapters open by default</span></div>
        <div class="s-select">
          <button bind:this={triggerPageStyle} class="s-select-btn" onclick={() => toggleSelect('page-style')}>
            <span>{{ 'single':'Single page','fade':'Fade','longstrip':'Long strip' }[settingsState.settings.pageStyle === 'double' ? 'single' : settingsState.settings.pageStyle]}</span>
            <svg class="s-select-caret" class:open={selectOpen === 'page-style'} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
          </button>
          {#if selectOpen === 'page-style'}
            <div class="s-select-menu" class:anims>
              {#each [['single','Single page'],['longstrip','Long strip']] as [v, l]}
                <button class="s-select-option" class:active={(settingsState.settings.pageStyle === 'double' ? 'single' : settingsState.settings.pageStyle) === v} onclick={() => { updateSettings({ pageStyle: v as Settings['pageStyle'] }); toggleSelect('page-style') }}>{l}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Reading direction</span><span class="s-desc">Left-to-right for most manga, right-to-left for Japanese</span></div>
        <div class="s-select">
          <button bind:this={triggerReadingDir} class="s-select-btn" onclick={() => toggleSelect('reading-dir')}>
            <span>{{ 'ltr':'Left to right','rtl':'Right to left' }[settingsState.settings.readingDirection]}</span>
            <svg class="s-select-caret" class:open={selectOpen === 'reading-dir'} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
          </button>
          {#if selectOpen === 'reading-dir'}
            <div class="s-select-menu" class:anims>
              {#each [['ltr','Left to right'],['rtl','Right to left']] as [v, l]}
                <button class="s-select-option" class:active={settingsState.settings.readingDirection === v} onclick={() => { updateSettings({ readingDirection: v as Settings['readingDirection'] }); toggleSelect('reading-dir') }}>{l}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Page gap</span><span class="s-desc">Adds spacing between pages in single-page mode</span></div>
        <button role="switch" aria-checked={settingsState.settings.pageGap} aria-label="Page gap" class="s-toggle" class:on={settingsState.settings.pageGap} onclick={() => updateSettings({ pageGap: !settingsState.settings.pageGap })}><span class="s-toggle-thumb"></span></button>
      </label>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Overlay bars</span><span class="s-desc">Floats the nav and chapter bars over the page instead of pushing content</span></div>
        <button role="switch" aria-checked={settingsState.settings.overlayBars ?? false} aria-label="Overlay bars" class="s-toggle" class:on={settingsState.settings.overlayBars ?? false} onclick={() => updateSettings({ overlayBars: !(settingsState.settings.overlayBars ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Tap to toggle bar</span><span class="s-desc">Double-tap the center of the reader to show or hide the bars</span></div>
        <button role="switch" aria-checked={settingsState.settings.tapToToggleBar ?? false} aria-label="Tap to toggle bar" class="s-toggle" class:on={settingsState.settings.tapToToggleBar ?? false} onclick={() => updateSettings({ tapToToggleBar: !(settingsState.settings.tapToToggleBar ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Containerized view</span><span class="s-desc">Shows the reader inside the app shell with the sidebar instead of filling the whole screen</span></div>
        <button role="switch" aria-checked={settingsState.settings.readerContainerized ?? false} aria-label="Containerized reader view" class="s-toggle" class:on={settingsState.settings.readerContainerized ?? false} onclick={() => updateSettings({ readerContainerized: !(settingsState.settings.readerContainerized ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">Fit &amp; Zoom</p>
    <div class="s-section-body">
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Default fit mode</span><span class="s-desc">How pages are scaled to fill the reader on open</span></div>
        <div class="s-select">
          <button bind:this={triggerFitMode} class="s-select-btn" onclick={() => toggleSelect('fit-mode')}>
            <span>{{ 'width':'Fit width','height':'Fit height','screen':'Fit screen','original':'Original (1:1)' }[settingsState.settings.fitMode ?? 'width']}</span>
            <svg class="s-select-caret" class:open={selectOpen === 'fit-mode'} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
          </button>
          {#if selectOpen === 'fit-mode'}
            <div class="s-select-menu" class:anims>
              {#each [['width','Fit width'],['height','Fit height'],['screen','Fit screen'],['original','Original (1:1)']] as [v, l]}
                <button class="s-select-option" class:active={(settingsState.settings.fitMode ?? 'width') === v} onclick={() => { updateSettings({ fitMode: v as FitMode }); toggleSelect('fit-mode') }}>{l}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Optimize contrast</span><span class="s-desc">Sharpens dark lines on light pages; best for black-and-white manga</span></div>
        <button role="switch" aria-checked={settingsState.settings.optimizeContrast} aria-label="Optimize contrast" class="s-toggle" class:on={settingsState.settings.optimizeContrast} onclick={() => updateSettings({ optimizeContrast: !settingsState.settings.optimizeContrast })}><span class="s-toggle-thumb"></span></button>
      </label>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">OCR Overlay</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Enable OCR overlay</span><span class="s-desc">Requests OCR for reader pages and places selectable text over detected lines</span></div>
        <button role="switch" aria-checked={settingsState.settings.readerOcrEnabled ?? false} aria-label="Enable OCR overlay" class="s-toggle" class:on={settingsState.settings.readerOcrEnabled ?? false} onclick={() => updateSettings({ readerOcrEnabled: !(settingsState.settings.readerOcrEnabled ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">OCR server URL</span><span class="s-desc">Mangatan-compatible endpoint, usually http://127.0.0.1:3000</span></div>
        <input class="s-input" value={settingsState.settings.readerOcrServerUrl ?? 'http://127.0.0.1:3000'}
          oninput={(e) => updateSettings({ readerOcrServerUrl: e.currentTarget.value })}
          placeholder="http://127.0.0.1:3000" spellcheck="false" />
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Overlay visibility</span><span class="s-desc">When OCR text appears on top of pages</span></div>
        <div class="s-select">
          <button bind:this={triggerOcrMode} class="s-select-btn" onclick={() => toggleSelect('ocr-overlay-mode')}>
            <span>{{ 'hover':'On hover','always':'Always visible' }[settingsState.settings.readerOcrOverlayMode ?? 'hover']}</span>
            <svg class="s-select-caret" class:open={selectOpen === 'ocr-overlay-mode'} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
          </button>
          {#if selectOpen === 'ocr-overlay-mode'}
            <div class="s-select-menu" class:anims>
              {#each [['hover','On hover'],['always','Always visible']] as [v, l]}
                <button class="s-select-option" class:active={(settingsState.settings.readerOcrOverlayMode ?? 'hover') === v} onclick={() => { updateSettings({ readerOcrOverlayMode: v as ReaderOcrOverlayMode }); toggleSelect('ocr-overlay-mode') }}>{l}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Text orientation</span><span class="s-desc">Smart mode chooses the largest readable fit per detected line</span></div>
        <div class="s-select">
          <button bind:this={triggerOcrText} class="s-select-btn" onclick={() => toggleSelect('ocr-text-orientation')}>
            <span>{{ 'smart':'Smart','forceHorizontal':'Horizontal','forceVertical':'Vertical' }[settingsState.settings.readerOcrTextOrientation ?? 'smart']}</span>
            <svg class="s-select-caret" class:open={selectOpen === 'ocr-text-orientation'} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
          </button>
          {#if selectOpen === 'ocr-text-orientation'}
            <div class="s-select-menu" class:anims>
              {#each [['smart','Smart'],['forceHorizontal','Horizontal'],['forceVertical','Vertical']] as [v, l]}
                <button class="s-select-option" class:active={(settingsState.settings.readerOcrTextOrientation ?? 'smart') === v} onclick={() => { updateSettings({ readerOcrTextOrientation: v as ReaderOcrTextOrientation }); toggleSelect('ocr-text-orientation') }}>{l}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Focus scale</span><span class="s-desc">How much a selected OCR line expands</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerOcrFocusScale: Math.max(1, Number(((settingsState.settings.readerOcrFocusScale ?? 1.12) - 0.05).toFixed(2))) })}>-</button>
          <span class="s-step-val">{Math.round((settingsState.settings.readerOcrFocusScale ?? 1.12) * 100)}%</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerOcrFocusScale: Math.min(2, Number(((settingsState.settings.readerOcrFocusScale ?? 1.12) + 0.05).toFixed(2))) })}>+</button>
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Box padding</span><span class="s-desc">Extra fitting room in pixels for OCR text</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerOcrBoxAdjustment: Math.max(0, (settingsState.settings.readerOcrBoxAdjustment ?? 4) - 1) })}>-</button>
          <span class="s-step-val">{settingsState.settings.readerOcrBoxAdjustment ?? 4}</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerOcrBoxAdjustment: Math.min(24, (settingsState.settings.readerOcrBoxAdjustment ?? 4) + 1) })}>+</button>
        </div>
      </div>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">Dictionary Lookup</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">OCR box lookup</span><span class="s-desc">Click OCR text boxes to open Japanese dictionary results</span></div>
        <button role="switch" aria-checked={settingsState.settings.readerDictionaryLookupEnabled ?? false} aria-label="Enable OCR dictionary lookup" class="s-toggle" class:on={settingsState.settings.readerDictionaryLookupEnabled ?? false} onclick={() => updateSettings({ readerDictionaryLookupEnabled: !(settingsState.settings.readerDictionaryLookupEnabled ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Dictionary server URL</span><span class="s-desc">Local hoshidicts adapter, usually http://127.0.0.1:3031</span></div>
        <input class="s-input" value={settingsState.settings.readerDictionaryServerUrl ?? 'http://127.0.0.1:3031'}
          oninput={(e) => updateSettings({ readerDictionaryServerUrl: e.currentTarget.value })}
          placeholder="http://127.0.0.1:3031" spellcheck="false" />
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Popup profile</span><span class="s-desc">Hoshi default keeps the Android popup dimensions</span></div>
        <div class="s-select">
          <button bind:this={triggerDictProfile} class="s-select-btn" onclick={() => toggleSelect('dict-popup-profile')}>
            <span>{dictionaryProfileLabels[settingsState.settings.readerDictionaryPopupProfile ?? 'hoshi']}</span>
            <svg class="s-select-caret" class:open={selectOpen === 'dict-popup-profile'} width="10" height="6" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6" fill="currentColor"/></svg>
          </button>
          {#if selectOpen === 'dict-popup-profile'}
            <div class="s-select-menu" class:anims>
              {#each [['hoshi','Hoshi default'],['compact','Compact'],['wide','Wide']] as [v, l]}
                <button class="s-select-option" class:active={(settingsState.settings.readerDictionaryPopupProfile ?? 'hoshi') === v} onclick={() => { applyDictionaryPopupProfile(v as ReaderDictionaryPopupProfile); toggleSelect('dict-popup-profile') }}>{l}</button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Max results</span><span class="s-desc">How many Hoshi lookup entries to keep for a clicked OCR box</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryMaxResults: Math.max(1, (settingsState.settings.readerDictionaryMaxResults ?? 16) - 1) })}>-</button>
          <span class="s-step-val">{settingsState.settings.readerDictionaryMaxResults ?? 16}</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryMaxResults: Math.min(50, (settingsState.settings.readerDictionaryMaxResults ?? 16) + 1) })}>+</button>
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Scan length</span><span class="s-desc">Maximum number of characters Hoshi scans from selected text</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryScanLength: Math.max(1, (settingsState.settings.readerDictionaryScanLength ?? 16) - 1) })}>-</button>
          <span class="s-step-val">{settingsState.settings.readerDictionaryScanLength ?? 16}</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryScanLength: Math.min(64, (settingsState.settings.readerDictionaryScanLength ?? 16) + 1) })}>+</button>
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Popup width</span><span class="s-desc">Default Hoshi profile is 320 px wide</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupWidth: Math.max(220, (settingsState.settings.readerDictionaryPopupWidth ?? 320) - 20) })}>-</button>
          <span class="s-step-val">{settingsState.settings.readerDictionaryPopupWidth ?? 320}</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupWidth: Math.min(720, (settingsState.settings.readerDictionaryPopupWidth ?? 320) + 20) })}>+</button>
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Popup height</span><span class="s-desc">Default Hoshi profile is 250 px tall</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupHeight: Math.max(160, (settingsState.settings.readerDictionaryPopupHeight ?? 250) - 20) })}>-</button>
          <span class="s-step-val">{settingsState.settings.readerDictionaryPopupHeight ?? 250}</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupHeight: Math.min(640, (settingsState.settings.readerDictionaryPopupHeight ?? 250) + 20) })}>+</button>
        </div>
      </div>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Popup scale</span><span class="s-desc">Matches Hoshi's 0.8 to 1.5 scale range</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupScale: Math.max(0.8, Number(((settingsState.settings.readerDictionaryPopupScale ?? 1) - 0.05).toFixed(2))) })}>-</button>
          <span class="s-step-val">{Math.round((settingsState.settings.readerDictionaryPopupScale ?? 1) * 100)}%</span>
          <button class="s-step-btn" onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupScale: Math.min(1.5, Number(((settingsState.settings.readerDictionaryPopupScale ?? 1) + 0.05).toFixed(2))) })}>+</button>
        </div>
      </div>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Action bar</span><span class="s-desc">Shows a top bar with entry navigation and close controls</span></div>
        <button role="switch" aria-checked={settingsState.settings.readerDictionaryPopupActionBar ?? false} aria-label="Dictionary popup action bar" class="s-toggle" class:on={settingsState.settings.readerDictionaryPopupActionBar ?? false} onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupActionBar: !(settingsState.settings.readerDictionaryPopupActionBar ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Full-width popup</span><span class="s-desc">Pins the popup along the bottom of the reader</span></div>
        <button role="switch" aria-checked={settingsState.settings.readerDictionaryPopupFullWidth ?? false} aria-label="Full width dictionary popup" class="s-toggle" class:on={settingsState.settings.readerDictionaryPopupFullWidth ?? false} onclick={() => updateSettings({ readerDictionaryPopupProfile: 'custom', readerDictionaryPopupFullWidth: !(settingsState.settings.readerDictionaryPopupFullWidth ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
    </div>
  </div>

  <div class="s-section">
    <p class="s-section-title">Behaviour</p>
    <div class="s-section-body">
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Auto-mark read</span><span class="s-desc">Marks a chapter as read when you reach the last page</span></div>
        <button role="switch" aria-checked={settingsState.settings.autoMarkRead} aria-label="Auto-mark chapters read" class="s-toggle" class:on={settingsState.settings.autoMarkRead} onclick={() => updateSettings({ autoMarkRead: !settingsState.settings.autoMarkRead })}><span class="s-toggle-thumb"></span></button>
      </label>
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Auto-advance chapters</span><span class="s-desc">Automatically loads the next chapter when you pass the last page</span></div>
        <button role="switch" aria-checked={settingsState.settings.autoNextChapter ?? false} aria-label="Auto-advance chapters" class="s-toggle" class:on={settingsState.settings.autoNextChapter} onclick={() => updateSettings({ autoNextChapter: !(settingsState.settings.autoNextChapter ?? false) })}><span class="s-toggle-thumb"></span></button>
      </label>
      {#if !(settingsState.settings.autoNextChapter ?? false)}
        <label class="s-row">
          <div class="s-row-info"><span class="s-label">Mark read when skipping</span><span class="s-desc">Marks the current chapter read when you manually jump to the next</span></div>
          <button role="switch" aria-checked={settingsState.settings.markReadOnNext ?? true} aria-label="Mark read when skipping" class="s-toggle" class:on={settingsState.settings.markReadOnNext ?? true} onclick={() => updateSettings({ markReadOnNext: !(settingsState.settings.markReadOnNext ?? true) })}><span class="s-toggle-thumb"></span></button>
        </label>
      {/if}
      <label class="s-row">
        <div class="s-row-info"><span class="s-label">Auto-bookmark</span><span class="s-desc">Automatically saves your page position as you read</span></div>
        <button role="switch" aria-checked={settingsState.settings.autoBookmark ?? true} aria-label="Enable auto-bookmark" class="s-toggle" class:on={settingsState.settings.autoBookmark ?? true} onclick={() => updateSettings({ autoBookmark: !(settingsState.settings.autoBookmark ?? true) })}><span class="s-toggle-thumb"></span></button>
      </label>
      <div class="s-row">
        <div class="s-row-info"><span class="s-label">Pages to preload</span><span class="s-desc">How many pages ahead to fetch in the background while reading</span></div>
        <div class="s-stepper">
          <button class="s-step-btn" onclick={() => updateSettings({ preloadPages: Math.max(0, settingsState.settings.preloadPages - 1) })} disabled={settingsState.settings.preloadPages <= 0}>−</button>
          <span class="s-step-val">{settingsState.settings.preloadPages}</span>
          <button class="s-step-btn" onclick={() => updateSettings({ preloadPages: Math.min(10, settingsState.settings.preloadPages + 1) })} disabled={settingsState.settings.preloadPages >= 10}>+</button>
        </div>
      </div>
    </div>
  </div>

</div>
