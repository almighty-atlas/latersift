<script lang="ts">
  import { onMount } from 'svelte';
  import type { Runtime, Tabs } from 'webextension-polyfill';
  import {
    emptyLibrary,
    latestScan,
    safeCandidate,
    type DecisionKind,
    type Library,
    type Scan,
  } from './model';
  import {
    catalog,
    candidates,
    currentVideo,
    decide,
    playlistId,
    sessionDecisions,
    stageCleanup,
    startSession,
    undo,
    type Filter,
  } from './session';
  import {
    loadLibrary,
    saveCheckpoint,
    saveLibrary,
    exportBackup,
  } from './storage';
  import {
    activateYouTubeTab,
    connectScan,
    openWatchLater,
    youtubeTabs,
  } from './bridge';
  import { availabilityLabels, decisionLabels } from './i18n';
  import OperationsPanel from './OperationsPanel.svelte';
  import PlaylistPanel from './PlaylistPanel.svelte';
  import {
    createWorkTab,
    waitForWorkTab,
    cleanupOrphanWorkTabs,
  } from './work-tabs';
  import { discoverPlaylists } from './write-bridge';
  import type { PlaylistChoice } from './operations';
  import {
    formatDialogDiagnostic,
    type DialogDiagnostic,
  } from './dialog-diagnostics';
  import { watchLaterLocation } from './adapter/dom';
  import './style.css';

  let lib = $state.raw<Library>(emptyLibrary());
  let ready = $state(false),
    busy = $state(false),
    importing = $state(false),
    owner = $state(false);
  let error = $state(''),
    feedback = $state(''),
    panel = $state<
      'import' | 'cleanup' | 'queue' | 'archive' | 'settings' | null
    >(null);
  let tabs = $state<Tabs.Tab[]>([]),
    selectedTab = $state('');
  let size = $state(25),
    filter = $state<Filter>('all'),
    archiveInput = $state('');
  let playlistChoices = $state<PlaylistChoice[]>([]);
  let playlistChoice = $state('');
  let manifestVersion = $state<string | null>(null);
  let playlistDiagnostic = $state<DialogDiagnostic | null>(null);
  let playlistDiagnosticFeedback = $state('');
  const playlistDiagnosticJSON = $derived(
    playlistDiagnostic ? formatDialogDiagnostic(playlistDiagnostic) : '',
  );
  let operationsBusy = $state(false);
  let cleanupSelected = $state<string[]>([]),
    cleanupConfirm = $state(false);
  let startPoint: { x: number; y: number } | null = null;
  let port = $state.raw<Runtime.Port | null>(null);
  let connectedTab = $state<number | null>(null);
  let pausing = $state(false);
  let experimentalBackground = $state(true);
  let useExistingTab = $state(false);
  let importWork: Awaited<ReturnType<typeof createWorkTab>> | null = null;
  let disposed = false;
  let now = $state(Date.now());
  const activeScan = (s: Scan) =>
    ['running', 'waiting', 'needs_attention'].includes(s.status);
  let releaseLock: (() => void) | undefined;
  const videos = $derived(catalog(lib));
  const card = $derived(currentVideo(lib));
  const decisions = $derived(sessionDecisions(lib));
  const pending = $derived(
    lib.decisions.filter(
      (d) =>
        d.kind !== 'defer' &&
        ['pending', 'failed', 'unknown'].includes(d.status),
    ),
  );
  const scan = $derived(latestScan(lib));
  const resumable = $derived(scan?.status !== 'complete' ? scan : undefined);
  const confirmedCount = $derived(
    scan?.diagnostics?.confirmedCount ??
      scan?.confirmedVideoIds?.length ??
      scan?.videos.length ??
      0,
  );
  const progressPercent = $derived(
    scan?.expectedCount
      ? Math.min(100, (confirmedCount / scan.expectedCount) * 100)
      : null,
  );
  const progressAge = $derived(
    scan?.diagnostics?.lastProgressAt
      ? Math.max(
          0,
          Math.floor(
            (now - Date.parse(scan.diagnostics.lastProgressAt)) / 1000,
          ),
        )
      : null,
  );
  const scanLabels: Record<string, string> = {
    running: 'Import läuft',
    waiting: 'Warten auf YouTube',
    needs_attention: 'Aufmerksamkeit erforderlich',
    complete: 'Vollständig geprüft',
    interrupted: 'Unterbrochen / pausiert',
    incomplete: 'Teilbestand / Prüfung offen',
    failed: 'Import fehlgeschlagen',
  };
  const diagnosticJSON = $derived.by(() => {
    if (!scan) return '';
    const d = scan.diagnostics;
    return JSON.stringify(
      {
        count: scan.videos.length,
        expectedCount: scan.expectedCount,
        status: scan.status,
        diagnostics: d
          ? {
              lastProgressAt: d.lastProgressAt,
              visibility: d.visibility,
              reason: d.reason,
              highestPosition: d.highestPosition,
              missingPositions: d.missingPositions,
              recoveryAttempts: d.recoveryAttempts,
              recoveryResults: d.recoveryResults,
              positionConflict: d.positionConflict,
              activeMs: d.activeMs,
              attentionMs: d.attentionMs,
              totalAttentionMs:
                'totalAttentionMs' in d ? d.totalAttentionMs : undefined,
              scroll: d.scroll
                ? {
                    container: d.scroll.container,
                    top: d.scroll.top,
                    height: d.scroll.height,
                    viewport: d.scroll.viewport,
                  }
                : null,
              continuation: d.continuation,
              confirmedCount: d.confirmedCount,
              backgroundMode: d.backgroundMode,
              timerThrottling: d.timerThrottling,
            }
          : null,
      },
      null,
      2,
    );
  });
  const cleanup = $derived(videos.filter(safeCandidate));
  const disabled = $derived(
    !ready || !owner || busy || importing || operationsBusy,
  );
  const hasDuration = $derived(videos.some((v) => v.durationSeconds !== null));
  const hasPosition = $derived(videos.some((v) => v.position !== null));

  onMount(() => {
    disposed = false;
    void import('webextension-polyfill')
      .then(({ default: browser }) => {
        const version = browser.runtime.getManifest().version;
        if (!disposed) manifestVersion = version;
      })
      .catch(() => {
        /* Local UI previews have no installed manifest. */
      });
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    void navigator.locks.request(
      'latersift-editor',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          error =
            'LaterSift ist bereits in einem anderen Tab geöffnet. Schließe diesen Tab und verwende die bestehende Ansicht.';
          return;
        }
        owner = true;
        try {
          try {
            await cleanupOrphanWorkTabs();
          } catch (e) {
            error = `Arbeitstab-Bereinigung nicht möglich; lokale Daten bleiben verfügbar: ${String(e)}`;
          }
          const loaded = await loadLibrary();
          const interrupted = latestScan(loaded);
          if (interrupted && activeScan(interrupted)) {
            interrupted.status = 'interrupted';
            interrupted.message =
              'Vorheriger Import unterbrochen. Gesicherter Teilbestand vorhanden.';
            await saveLibrary(loaded);
          }
          if (disposed) return;
          lib = loaded;
          archiveInput = loaded.archivePlaylist;
          ready = true;
          await new Promise<void>((resolve) => {
            releaseLock = resolve;
            if (disposed) resolve();
          });
        } catch (e) {
          error = `Lokale Datenbank nicht verfügbar: ${String(e)}`;
        }
      },
    );
    return () => {
      disposed = true;
      clearInterval(timer);
      port?.disconnect();
      void importWork?.close().catch(() => {
        /* Startup cleanup retains the journal. */
      });
      releaseLock?.();
    };
  });
  async function change(action: (copy: Library) => void) {
    if (disabled) return false;
    busy = true;
    error = '';
    try {
      const copy = structuredClone(lib);
      action(copy);
      await saveLibrary(copy);
      lib = copy;
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      busy = false;
    }
  }
  async function act(kind: DecisionKind) {
    if (disabled || !card) return;
    if (kind === 'archive' && !playlistId(lib.archivePlaylist)) {
      panel = 'archive';
      return;
    }
    const id = card.id;
    if (await change((copy) => decide(copy, id, kind)))
      feedback = `${decisionLabels[kind]} · lokal gespeichert`;
  }
  async function undoLast() {
    if (
      await change((copy) => {
        if (!undo(copy))
          throw new Error('Keine Entscheidung dieser Runde zum Zurücknehmen.');
      })
    )
      feedback = 'Letzte Entscheidung zurückgenommen';
  }
  async function begin() {
    if (await change((copy) => startSession(copy, Number(size), filter)))
      feedback = 'Neue Runde gestartet';
  }
  async function refreshTabs() {
    error = '';
    try {
      tabs = (await youtubeTabs()).filter(
        (t) => t.url && watchLaterLocation(t.url),
      );
      selectedTab = String(tabs[0]?.id ?? '');
    } catch {
      error =
        'Der Import funktioniert in der geladenen Firefox-/Zen-Erweiterung. Öffne dort LaterSift über das Erweiterungssymbol.';
    }
  }
  async function showImport() {
    panel = 'import';
    await refreshTabs();
  }
  async function openYouTube() {
    try {
      await openWatchLater();
    } catch {
      error = 'Bitte die Erweiterung in Zen oder Firefox laden.';
    }
  }
  async function activateTab() {
    const tabId = importing
      ? connectedTab
      : (connectedTab ?? (selectedTab ? Number(selectedTab) : null));
    if (tabId === null) return;
    error = '';
    try {
      await activateYouTubeTab(tabId);
    } catch (e) {
      error = `YouTube-Tab konnte nicht aktiviert werden: ${String(e)}`;
    }
  }
  async function copyDiagnostics() {
    error = '';
    try {
      await navigator.clipboard.writeText(diagnosticJSON);
      feedback = 'Diagnose kopiert · ohne Video-Metadaten';
    } catch (e) {
      error = `Diagnose konnte nicht kopiert werden: ${String(e)}`;
    }
  }
  function pauseImport() {
    if (!port || pausing) return;
    error = '';
    try {
      port.postMessage({ type: 'cancel' });
      pausing = true;
    } catch (e) {
      error = `Import konnte nicht pausiert werden: ${String(e)}`;
    }
  }
  async function importVideos(resume?: Scan) {
    if (disabled || (useExistingTab && !selectedTab)) return;
    importing = true;
    pausing = false;
    feedback = '';
    error = '';
    try {
      let tabId: number;
      if (useExistingTab) tabId = Number(selectedTab);
      else {
        importWork = await createWorkTab('watch-later');
        connectedTab = importWork.tabId;
        await waitForWorkTab(importWork.tabId);
        if (disposed) {
          await importWork.close();
          importWork = null;
          return;
        }
        tabId = importWork.tabId;
      }
      port = await connectScan(
        tabId,
        async (checkpoint) => {
          const copy = structuredClone(lib);
          await saveCheckpoint(copy, checkpoint);
          lib = copy;
        },
        async (message) => {
          try {
            await importWork?.close();
          } catch (e) {
            error = `Arbeitstab konnte nicht bereinigt werden: ${String(e)}`;
          }
          importWork = null;
          connectedTab = null;
          importing = false;
          pausing = false;
          port = null;
          if (message) error = message;
          const last = latestScan(lib);
          if (last && activeScan(last)) {
            busy = true;
            try {
              const copy = structuredClone(lib);
              const s = latestScan(copy)!;
              s.status = 'interrupted';
              s.message = message || 'Import unterbrochen.';
              await saveLibrary(copy);
              lib = copy;
            } catch (e) {
              error = `Speicherung fehlgeschlagen: ${String(e)}`;
            } finally {
              busy = false;
            }
          }
          feedback = message
            ? 'Import unterbrochen; bestätigte Checkpoints bleiben erhalten.'
            : 'Import gespeichert';
        },
        resume ? structuredClone(resume) : undefined,
        experimentalBackground,
      );
      connectedTab = tabId;
    } catch (e) {
      try {
        await importWork?.close();
      } catch (cleanupError) {
        error = `Bereinigung fehlgeschlagen: ${String(cleanupError)}. `;
      }
      importWork = null;
      connectedTab = null;
      importing = false;
      port = null;
      error += `Import konnte nicht gestartet werden: ${String(e)}`;
    }
  }
  function exportJSON() {
    const blob = new Blob([exportBackup(lib)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `latersift-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback = 'JSON-Export erstellt · keine automatische Wiederherstellung';
  }
  async function commitOperations(copy: Library) {
    await saveLibrary(copy);
    lib = copy;
  }
  async function loadPlaylistsFromDialog() {
    if (disabled || !videos[0]) return;
    busy = true;
    error = '';
    playlistChoices = [];
    playlistChoice = '';
    playlistDiagnostic = null;
    playlistDiagnosticFeedback = '';
    try {
      playlistChoices = await discoverPlaylists(videos[0].id, (report) => {
        playlistDiagnostic = report;
      });
      if (!playlistChoices.length)
        error =
          'Keine Playlist-Einträge im unterstützten Save-Dialog gefunden.';
    } catch (e) {
      error = `Playlists konnten nicht aus YouTube geladen werden: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy = false;
    }
  }
  async function copyPlaylistDiagnostic() {
    try {
      await navigator.clipboard.writeText(playlistDiagnosticJSON);
      playlistDiagnosticFeedback = 'Bereinigte Diagnose kopiert.';
    } catch {
      playlistDiagnosticFeedback =
        'Kopieren nicht möglich. Diagnose markieren und manuell kopieren.';
    }
  }
  async function saveArchive() {
    const id = playlistId(archiveInput);
    if (!id) {
      error =
        'Bitte eine gültige YouTube-Playlist-URL oder PL…-ID eingeben. Watch Later ist kein Archivziel.';
      return;
    }
    if (
      await change((copy) => {
        copy.archivePlaylist = id;
      })
    ) {
      panel = null;
      feedback = 'Archivziel lokal hinterlegt · Zugehörigkeit nicht geprüft';
    }
  }
  async function confirmCleanup() {
    if (await change((copy) => stageCleanup(copy, cleanupSelected))) {
      feedback = `${cleanupSelected.length} Kandidaten lokal vorgemerkt`;
      cleanupSelected = [];
      cleanupConfirm = false;
      panel = 'queue';
    }
  }
  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && panel) {
      e.preventDefault();
      closePanel();
      return;
    }
    if (
      (e.target instanceof Element &&
        e.target.closest('input,select,textarea,button,a,[contenteditable]')) ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      e.repeat ||
      panel
    )
      return;
    const actions: Record<string, DecisionKind> = {
      ArrowLeft: 'remove',
      ArrowRight: 'archive',
      ArrowDown: 'defer',
    };
    if (e.key in actions) {
      e.preventDefault();
      void act(actions[e.key]);
    }
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void undoLast();
    }
    if (e.code === 'Space' && lib.session) {
      e.preventDefault();
      void change((copy) => {
        copy.session!.paused = !copy.session!.paused;
      });
    }
  }
  function pointerdown(e: PointerEvent) {
    if (e.target instanceof Element && e.target.closest('a,button')) return;
    startPoint = { x: e.clientX, y: e.clientY };
    if (e.currentTarget instanceof Element)
      e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerup(e: PointerEvent) {
    if (!startPoint) return;
    const dx = e.clientX - startPoint.x,
      dy = e.clientY - startPoint.y;
    startPoint = null;
    if (Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 1.3)
      void act(dx < 0 ? 'remove' : 'archive');
    else if (dy > 85 && dy > Math.abs(dx) * 1.3) void act('defer');
  }
  function closePanel() {
    if (!operationsBusy && !busy) panel = null;
  }
  function focusTrap(node: HTMLElement) {
    const prior = document.activeElement;
    const selector =
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea,summary,[tabindex="0"]';
    queueMicrotask(() => node.querySelector<HTMLElement>(selector)?.focus());
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = [...node.querySelectorAll<HTMLElement>(selector)];
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener('keydown', handler);
    return {
      destroy() {
        node.removeEventListener('keydown', handler);
        if (prior instanceof HTMLElement) queueMicrotask(() => prior.focus());
      },
    };
  }
  const formatDuration = (seconds: number | null) =>
    seconds === null
      ? 'Dauer unbekannt'
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
</script>

<svelte:window onkeydown={keydown} />
<div class="shell" class:has-library={videos.length > 0} inert={panel !== null}>
  <header>
    <a class="brand" href="index.html" aria-label="LaterSift Startseite"
      ><span class="brand-icon" aria-hidden="true">L<span>▸</span></span><span
        class="brand-title"
        >LaterSift<span class="version"
          >{manifestVersion ? `v${manifestVersion}` : 'Version unbekannt'}</span
        ></span
      ></a
    >
    <nav aria-label="Werkzeuge">
      <button
        class="quiet"
        onclick={showImport}
        disabled={!ready || !owner || busy || operationsBusy}>↓ Import</button
      >
      <button
        class="quiet"
        onclick={exportJSON}
        disabled={!ready || importing || operationsBusy || !scan}
        >↗ Backup</button
      >
      <button class="quiet" onclick={() => (panel = 'archive')} {disabled}
        >Playlists</button
      >
      <button
        class="queue-count"
        onclick={() => (panel = 'queue')}
        disabled={!ready}>Vorgemerkt <span>{pending.length}</span></button
      >
    </nav>
  </header>

  <div class="safety-note">
    <span class="dot"></span> Lokal vormerken
    <span class="separator">·</span> YouTube-Änderungen nur im Schreibpilot nach genauer
    Auswahl und ausdrücklicher Freigabe.
  </div>
  {#if error}<div role="alert" class="error">{error}</div>{/if}
  <main>
    <section class="intro">
      <div>
        <p class="eyebrow">DEIN WATCH-LATER-RESET</p>
        <h1>Weniger später.<br /><span>Mehr Überblick.</span></h1>
        <p class="subtitle">
          Eine Karte. Eine Entscheidung. Ein leichterer Stapel.
        </p>
      </div>
      {#if videos.length}<div class="library-count">
          <strong>{videos.length.toLocaleString('de-DE')}</strong><span
            >lokal gesichert</span
          ><small
            >{scan?.status === 'complete'
              ? 'Scan vollständig geprüft'
              : 'Teilbestand · Vollständigkeit offen'}</small
          >
        </div>{/if}
    </section>

    {#if !ready && !error}<div class="empty-state">
        <p>Lokalen Fortschritt laden …</p>
      </div>
    {:else if !videos.length}
      <section class="empty-state">
        <div class="empty-icon" aria-hidden="true">▤</div>
        <h2>Dein „Später“ beginnt hier.</h2>
        <p>
          Bei YouTube angemeldet? LaterSift öffnet einen inaktiven Arbeitstab.<br
          />Es liest deine Watch-Later-Liste und sichert sie lokal.
        </p>
        <button class="primary" onclick={showImport} {disabled}
          >Watch Later importieren <span>↗</span></button
        >
        <small>Kein Konto. Keine Cloud. Keine Telemetrie.</small>
      </section>
    {:else}
      <div class="workspace">
        <section class="swipe-area" aria-label="Videos durchsehen">
          <div class="session-line">
            <span
              >DEINE RUNDE <b
                >{decisions.length} / {lib.session?.videoIds.length ?? size}</b
              ></span
            ><button
              class="quiet"
              onclick={() =>
                change((copy) => {
                  if (copy.session) copy.session.paused = !copy.session.paused;
                })}
              disabled={disabled || !lib.session}
              >{lib.session?.paused ? '▶ Fortsetzen' : 'Ⅱ Pausieren'}</button
            >
          </div>
          <progress
            aria-label="Sitzungsfortschritt"
            value={decisions.length}
            max={lib.session?.videoIds.length || size}
          ></progress>
          {#if card}
            {#key card.id}
              <article
                class="video-card"
                onpointerdown={pointerdown}
                onpointerup={pointerup}
                onpointercancel={() => (startPoint = null)}
              >
                <div class="thumbnail">
                  {#if card.thumbnail}<img
                      src={card.thumbnail}
                      alt=""
                      draggable="false"
                      referrerpolicy="no-referrer"
                    />{:else}<div class="no-thumbnail">
                      <span>▷</span>Kein Thumbnail verfügbar
                    </div>{/if}
                  <span class="duration"
                    >{formatDuration(card.durationSeconds)}</span
                  >
                </div>
                <div class="card-body">
                  <span
                    class:unavailable={safeCandidate(card)}
                    class="availability"
                    >{availabilityLabels[card.availability]}</span
                  >
                  <h2>{card.title || 'Titel unbekannt'}</h2>
                  <p>{card.channel || 'Kanal unbekannt'}</p>
                  <div class="card-meta">
                    <span>Position {card.position ?? '?'}</span><span
                      >Veröffentlicht: {card.publishedAt || 'unbekannt'}</span
                    ><a href={card.url} target="_blank" rel="noreferrer"
                      >Auf YouTube öffnen ↗</a
                    >
                  </div>
                </div>
              </article>
            {/key}
            <div class="swipe-buttons">
              <button
                class="swipe remove"
                onclick={() => act('remove')}
                {disabled}
                ><span aria-hidden="true">×</span>Entfernen<kbd>←</kbd></button
              >
              <button
                class="swipe defer"
                onclick={() => act('defer')}
                {disabled}
                ><span aria-hidden="true">↓</span>Zurückstellen<kbd>↓</kbd
                ></button
              >
              <button
                class="swipe archive"
                onclick={() => act('archive')}
                {disabled}
                ><span aria-hidden="true">↗</span>Archivieren<kbd>→</kbd
                ></button
              >
            </div>
          {:else}
            <div class="session-end">
              <span class="empty-icon" aria-hidden="true"
                >{lib.session?.paused ? 'Ⅱ' : lib.session ? '✓' : '▷'}</span
              >
              <h2>
                {lib.session?.paused
                  ? 'Eine kleine Pause.'
                  : lib.session
                    ? 'Runde abgeschlossen.'
                    : 'Bereit für eine kleine Runde?'}
              </h2>
              <p>
                {lib.session?.paused
                  ? 'Dein Fortschritt ist lokal gespeichert.'
                  : lib.session
                    ? `${decisions.length} Entscheidungen lokal gespeichert. YouTube-Ergebnisse stehen in den Vormerkungen.`
                    : 'Standardmäßig 25 Videos. Du bestimmst das Tempo.'}
              </p>
              {#if lib.session && !lib.session.paused}
                <div
                  class="session-summary"
                  aria-label="Entscheidungen dieser Runde"
                >
                  <span
                    >{decisions.filter((d) => d.kind === 'remove').length} Entfernen</span
                  >
                  <span
                    >{decisions.filter((d) => d.kind === 'archive').length} Archivieren</span
                  >
                  <span
                    >{decisions.filter((d) => d.kind === 'defer').length} Zurückstellen</span
                  >
                </div>
              {/if}
              {#if lib.session && !lib.session.paused && pending.some((d) => d.sessionId === lib.session?.id)}
                <button onclick={() => (panel = 'queue')} {disabled}
                  >{pending.filter((d) => d.sessionId === lib.session?.id)
                    .length} Änderungen auf YouTube anwenden</button
                >
              {/if}
              {#if lib.session?.paused}<button
                  class="primary"
                  onclick={() =>
                    change((copy) => {
                      copy.session!.paused = false;
                    })}
                  {disabled}>Weiter durchsehen</button
                >
              {:else}<button
                  class="primary"
                  onclick={begin}
                  disabled={disabled || candidates(lib, filter).length === 0}
                  >{lib.session ? 'Nächste Runde' : 'Runde starten'}
                  <span>→</span></button
                >{/if}
            </div>
          {/if}
          <div class="under-card">
            <button
              class="quiet"
              onclick={undoLast}
              disabled={disabled || !decisions.length}
              >↶ Rückgängig <kbd>Z</kbd></button
            ><span
              >{candidates(lib, 'all').length} noch nicht abschließend bewertet</span
            >
          </div>
          <div class="workspace-tools">
            <button
              class="quiet"
              onclick={() => (panel = 'settings')}
              {disabled}>Runde anpassen ↗</button
            >
            <button
              class="quiet"
              onclick={() => {
                panel = 'cleanup';
                cleanupConfirm = false;
              }}
              {disabled}>Nicht verfügbare Videos ({cleanup.length})</button
            >
          </div>
          <p role="status" aria-live="polite" class="feedback">
            {feedback || 'Swipen oder Pfeiltasten nutzen · Leertaste pausiert'}
          </p>
        </section>
      </div>
    {/if}
  </main>
  <footer>
    <span>Swipe through your Watch Later backlog.</span><span
      >Local first. Immer.</span
    >
  </footer>
</div>

{#if panel}
  {#key panel}
    <div class="modal-backdrop">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        tabindex="-1"
        use:focusTrap
      >
        <div class="modal-heading">
          <p class="eyebrow">
            LATERSIFT / {panel === 'import'
              ? 'IMPORT'
              : panel === 'queue'
                ? 'VORMERKUNGEN'
                : panel === 'cleanup'
                  ? 'BEREINIGUNG'
                  : panel === 'settings'
                    ? 'RUNDE'
                    : 'ARCHIVZIEL'}
          </p>
          <button
            class="close"
            aria-label="Dialog schließen"
            disabled={operationsBusy || busy}
            onclick={closePanel}>×</button
          >
        </div>
        {#if panel === 'import'}
          <h2 id="panel-title">Watch Later lokal sichern.</h2>
          <p>
            Start öffnet einen inaktiven Arbeitstab ohne Fokuswechsel. Du kannst
            andere Tabs verwenden. Hintergrund-Nachladen ist experimentell: Bei
            Blockaden bleibt der Teilbestand gesichert. Der Arbeitstab wird nach
            Ende oder Pause aufgeräumt; Fortsetzen bestätigt die IDs erneut.
          </p>
          <label
            ><input
              type="checkbox"
              bind:checked={experimentalBackground}
              disabled={importing}
            /> Experimentelles Hintergrund-Scrollen erlauben</label
          >
          <details>
            <summary>Erweitert: vorhandenen YouTube-Tab verwenden</summary>
            <label
              ><input
                type="checkbox"
                bind:checked={useExistingTab}
                disabled={importing}
              /> Eigenen Tab verwenden (wird niemals automatisch geschlossen)</label
            >
            <div class="inline-actions">
              <button onclick={openYouTube} disabled={importing}
                >YouTube öffnen ↗</button
              ><button onclick={refreshTabs} disabled={importing}
                >Tabs aktualisieren</button
              >
            </div>
            <label for="youtube-tab">Verbundener Watch-Later-Tab</label><select
              id="youtube-tab"
              bind:value={selectedTab}
              disabled={importing}
              >{#if !tabs.length}<option value=""
                  >Kein passender Tab gefunden</option
                >{/if}{#each tabs as tab (tab.id)}<option value={String(tab.id)}
                  >{tab.title || `YouTube-Tab ${tab.id}`} (Tab {tab.id})</option
                >{/each}</select
            >
          </details>
          {#if error}<p role="alert" class="error">{error}</p>{/if}
          <button
            onclick={activateTab}
            disabled={importing
              ? connectedTab === null
              : connectedTab === null && !selectedTab}
            >YouTube-Tab aktivieren ↗</button
          >
          {#if importing && !scan}<p>
              Import wird vorbereitet … Noch kein Checkpoint gesichert.
            </p>{/if}
          {#if scan}<div class="scan-status">
              <strong
                >{confirmedCount.toLocaleString('de-DE')} / {scan.expectedCount?.toLocaleString(
                  'de-DE',
                ) ?? '?'} Videos · {progressPercent === null
                  ? 'Prozent unbekannt'
                  : `${progressPercent.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}</strong
              ><span>{scanLabels[scan.status] ?? scan.status}</span>
              <p>
                Letzter Fortschritt: {progressAge !== null &&
                Number.isFinite(progressAge)
                  ? `vor ${progressAge} s`
                  : 'unbekannt'}
              </p>
              <p>{scan.message}</p>
              <small
                >{scan.videos.length} IDs insgesamt lokal erhalten. Nur lokal gesicherte
                Checkpoints werden angezeigt. Im aktuellen Dokument bestätigte IDs:
                {scan.diagnostics?.confirmedCount ??
                  scan.confirmedVideoIds?.length ??
                  0}.</small
              >
              <details>
                <summary>Import-Diagnose (ohne Video-Metadaten)</summary>
                <textarea
                  aria-label="Import-Diagnose JSON"
                  readonly
                  value={diagnosticJSON}
                  rows="14"
                ></textarea>
                <button onclick={copyDiagnostics}>Diagnose kopieren</button>
              </details>
              {#if scan.unidentifiableRows}<p>
                  {scan.unidentifiableRows} Einträge ohne sichere Video-ID erkannt.
                </p>{/if}
            </div>{/if}
          <p class="hint">
            Fehlende Videos? In YouTubes Playlist-Menü gegebenenfalls „Nicht
            verfügbare Videos anzeigen“ aktivieren. Fortsetzen verwendet den
            letzten gesicherten Teilbestand; lokale Entscheidungen und frühere
            vollständige Snapshots bleiben erhalten.
          </p>
          {#if importing}<button
              class="primary"
              onclick={pauseImport}
              disabled={!port || pausing}
              >{pausing
                ? 'Pausieren … Checkpoint wird gesichert'
                : 'Import pausieren'}</button
            >{:else}
            {#if resumable}<button
                class="primary"
                onclick={() => importVideos(resumable)}
                disabled={disabled || (useExistingTab && !selectedTab)}
                >Fortsetzen / erneut versuchen</button
              >{/if}
            <button
              class={resumable ? '' : 'primary'}
              onclick={() => importVideos()}
              disabled={disabled || (useExistingTab && !selectedTab)}
              >Read-only-Import neu starten</button
            >
          {/if}
        {:else if panel === 'settings'}
          <div class="round-settings">
            <div class="section-title">
              <span>01</span>
              <h2 id="panel-title">Deine nächste Runde.</h2>
            </div>
            <p>Mach Platz für das, was dich heute interessiert.</p>
            <label for="session-size">Videos pro Runde</label><input
              id="session-size"
              type="number"
              min="1"
              max="5000"
              bind:value={size}
              disabled={disabled ||
                Boolean(card) ||
                Boolean(lib.session?.paused)}
            />
            <label for="sort">Auswahl für die nächste Runde</label><select
              id="sort"
              bind:value={filter}
              disabled={disabled ||
                Boolean(card) ||
                Boolean(lib.session?.paused)}
              ><option value="all">Noch nicht abschließend bewertet</option
              >{#if hasPosition}<option value="position-asc"
                  >Listenanfang zuerst</option
                ><option value="position-desc">Listenende zuerst</option
                >{/if}{#if hasDuration}<option value="short"
                  >Kurze Videos zuerst</option
                ><option value="long">Lange Videos zuerst</option>{/if}<option
                value="unavailable">Eindeutig privat / gelöscht</option
              ><option value="deferred">Zurückgestellte Videos</option></select
            >
            <p class="hint">
              Listenposition ist kein Veröffentlichungs- oder Hinzufügedatum.
              Unbekannte Werte werden bei Metadatenfiltern ausgelassen.
            </p>
            <div class="tally">
              <div>
                <span class="red-dot"></span>Entfernen<b
                  >{decisions.filter((d) => d.kind === 'remove').length}</b
                >
              </div>
              <div>
                <span class="green-dot"></span>Archivieren<b
                  >{decisions.filter((d) => d.kind === 'archive').length}</b
                >
              </div>
              <div>
                <span class="gray-dot"></span>Zurückstellen<b
                  >{decisions.filter((d) => d.kind === 'defer').length}</b
                >
              </div>
            </div>
            <button
              class="text-button"
              onclick={() => (panel = 'archive')}
              {disabled}>Archivziel hinterlegen <span>↗</span></button
            >
            <p class="hint">
              Alle Entscheidungen werden sofort lokal gespeichert. „Archivieren“
              merkt nur die Absicht samt Ziel vor.
            </p>
          </div>
        {:else if panel === 'archive'}
          <h2 id="panel-title">Ein Zuhause fürs Archiv.</h2>
          <p>
            Hinterlege die URL einer bestehenden YouTube-Playlist. Das Ziel wird
            nur lokal gespeichert; seine Existenz, Schreibbarkeit und
            Video-Zugehörigkeiten sind noch nicht geprüft.
          </p>
          <PlaylistPanel
            {disabled}
            onchoose={(id) => {
              archiveInput = id;
            }}
          />
          <details>
            <summary>Erweitert: bisherigen Save-Dialog untersuchen</summary>
            <button
              onclick={loadPlaylistsFromDialog}
              disabled={disabled || !videos.length}
              >Playlists aus YouTube laden (Save-Dialog, Vordergrund)</button
            >
            <p class="hint">
              Nur auf ausdrücklichen Start: öffnet einen sichtbaren
              Video-Arbeitstab. Keine automatische Rückkehr. Keine
              YouTube-Änderungen.
            </p>
            {#if playlistDiagnostic}
              <details class="dialog-diagnostic">
                <summary>Technische YouTube-Dialogdiagnose</summary>
                <p class="hint">
                  UI-Auswahl und belegte Playlist-Identität werden getrennt
                  erfasst. Ein UI-Zustand beweist keine gespeicherte
                  Mitgliedschaft. Dieser Bericht enthält keine Playlist-Namen,
                  IDs oder Attributwerte.
                </p>
                <textarea
                  aria-label="Bereinigte YouTube-Dialogdiagnose"
                  readonly
                  rows="12"
                  value={playlistDiagnosticJSON}
                ></textarea>
                <button onclick={copyPlaylistDiagnostic}
                  >Diagnose kopieren</button
                >
                {#if playlistDiagnosticFeedback}<p role="status">
                    {playlistDiagnosticFeedback}
                  </p>{/if}
              </details>
            {/if}
            {#if playlistChoices.length}
              <p class="hint">
                {playlistChoices.length} Einträge gelesen. Auswahlzustand ist keine
                bestätigte gespeicherte Mitgliedschaft. Unbestätigte Identitäten sind
                keine Schreibziele.
              </p>
              <ul aria-label="Erkannte YouTube-Playlists">
                {#each playlistChoices as choice (choice)}
                  <li>
                    <strong>{choice.title || 'Name unbekannt'}</strong> ·
                    {choice.checked === true
                      ? 'ausgewählt'
                      : choice.checked === false
                        ? 'nicht ausgewählt'
                        : 'Auswahl unbekannt'} ·
                    {choice.id
                      ? `ID über Zeilenlink belegt: ${choice.id}`
                      : 'Identität unbestätigt'}
                    {#if choice.diagnostic}<p class="hint">
                        {choice.diagnostic}
                      </p>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if playlistChoices.some((p) => p.id && p.id !== 'WL' && p.writable)}
              <label for="archive-choice">Schreibbare YouTube-Playlist</label>
              <select
                id="archive-choice"
                bind:value={playlistChoice}
                onchange={() => {
                  if (
                    playlistChoices.some(
                      (p) => p.id === playlistChoice && p.writable,
                    )
                  )
                    archiveInput = playlistChoice;
                }}
                {disabled}
              >
                <option value="">Bitte wählen</option>
                {#each playlistChoices.filter((p) => p.id && p.id !== 'WL' && p.writable) as choice (choice)}<option
                    value={choice.id}>{choice.title} ({choice.id})</option
                  >{/each}
              </select>
            {/if}
          </details>
          <label for="archive-url">YouTube-Playlist-URL oder PL…-ID</label
          ><input
            id="archive-url"
            type="text"
            bind:value={archiveInput}
            placeholder="https://www.youtube.com/playlist?list=PL…"
          />
          <p class="hint">
            Eine manuelle URL speichert nur das gewünschte Ziel. Sie bestätigt
            keine Zuordnung zu einem Dialogeintrag und schaltet Schreiben nicht
            frei.
          </p>
          <button class="primary" onclick={saveArchive} {disabled}
            >Ziel lokal speichern</button
          >
        {:else if panel === 'queue'}
          <h2 id="panel-title">{pending.length} Änderungen vorgemerkt.</h2>
          <OperationsPanel
            library={lib}
            {disabled}
            oncommit={commitOperations}
            onbusy={(value) => (operationsBusy = value)}
          />
          <button
            id="operations-backup"
            onclick={exportJSON}
            disabled={importing || operationsBusy || !scan}
            >Bestand und Vormerkungen exportieren</button
          >
        {:else if panel === 'cleanup'}
          <h2 id="panel-title">Unverfügbar ist nicht unbekannt.</h2>
          <p>
            {cleanup.length} eindeutig private oder gelöschte Einträge. {videos.filter(
              (v) => v.availability === 'unknown',
            ).length} unbekannt, {videos.filter(
              (v) => v.availability === 'restricted',
            ).length} eingeschränkt. Nicht gelistete Videos werden nicht als unverfügbar
            behandelt.
          </p>
          <div class="queue-list">
            {#each cleanup as v (v.id)}<label class="cleanup-row"
                ><input
                  type="checkbox"
                  value={v.id}
                  bind:group={cleanupSelected}
                  disabled={disabled ||
                    lib.decisions.some(
                      (d) => d.videoId === v.id && d.kind !== 'defer',
                    )}
                /><span
                  ><strong>{v.title || v.id}</strong><small
                    >{availabilityLabels[v.availability]} · {v.evidence ||
                      'Hinweis im Playlist-DOM'}</small
                  ></span
                ><a
                  href={v.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Video ${v.id} auf YouTube öffnen`}>↗</a
                ></label
              >{/each}{#if !cleanup.length}<p>
                Keine eindeutigen Kandidaten im gesicherten Bestand.
              </p>{/if}
          </div>
          {#if cleanupConfirm}<div class="write-gate">
              <p>
                {cleanupSelected.length} Entfernungen lokal vormerken? An YouTube
                wird nichts verändert.
              </p>
              <button class="primary" onclick={confirmCleanup} {disabled}
                >Auswahl lokal vormerken</button
              ><button onclick={() => (cleanupConfirm = false)}
                >Abbrechen</button
              >
            </div>{:else}<button
              onclick={() => (cleanupConfirm = true)}
              disabled={disabled || !cleanupSelected.length}
              >Auswahl prüfen ({cleanupSelected.length})</button
            >{/if}
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </div>
    </div>
  {/key}
{/if}
