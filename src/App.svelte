<script lang="ts">
  import { onMount } from 'svelte';
  import type { Runtime, Tabs } from 'webextension-polyfill';
  import {
    emptyLibrary,
    latestScan,
    safeCandidate,
    type DecisionKind,
    type Library,
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
    WRITE_GATE,
    type Filter,
  } from './session';
  import {
    loadLibrary,
    saveCheckpoint,
    saveLibrary,
    exportBackup,
  } from './storage';
  import { connectScan, openWatchLater, youtubeTabs } from './bridge';
  import { availabilityLabels, decisionLabels, operationLabels } from './i18n';
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
  let cleanupSelected = $state<string[]>([]),
    cleanupConfirm = $state(false);
  let startPoint: { x: number; y: number } | null = null;
  let port: Runtime.Port | null = null;
  let releaseLock: (() => void) | undefined;
  const videos = $derived(catalog(lib));
  const card = $derived(currentVideo(lib));
  const decisions = $derived(sessionDecisions(lib));
  const pending = $derived(
    lib.decisions.filter((d) => d.kind !== 'defer' && d.status === 'pending'),
  );
  const scan = $derived(latestScan(lib));
  const cleanup = $derived(videos.filter(safeCandidate));
  const disabled = $derived(!ready || !owner || busy || importing);
  const hasDuration = $derived(videos.some((v) => v.durationSeconds !== null));
  const hasPosition = $derived(videos.some((v) => v.position !== null));

  onMount(() => {
    let disposed = false;
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
          const loaded = await loadLibrary();
          const interrupted = latestScan(loaded);
          if (interrupted?.status === 'running') {
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
      port?.disconnect();
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
  async function importVideos() {
    if (disabled || !selectedTab) return;
    importing = true;
    feedback = '';
    error = '';
    try {
      port = await connectScan(
        Number(selectedTab),
        async (checkpoint) => {
          const copy = structuredClone(lib);
          await saveCheckpoint(copy, checkpoint);
          lib = copy;
        },
        async (message) => {
          importing = false;
          port = null;
          if (message) error = message;
          const last = latestScan(lib);
          if (last?.status === 'running') {
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
      );
    } catch (e) {
      importing = false;
      error = String(e);
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
  function focusTrap(node: HTMLElement) {
    const prior = document.activeElement;
    const selector =
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]';
    queueMicrotask(() => node.querySelector<HTMLElement>(selector)?.focus());
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        panel = null;
        return;
      }
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
      ><span class="brand-icon" aria-hidden="true">L<span>▸</span></span
      >LaterSift<span class="version">LOCAL / 0.1</span></a
    >
    <nav aria-label="Werkzeuge">
      <button
        class="quiet"
        onclick={showImport}
        disabled={!ready || !owner || busy}>↓ Import</button
      >
      <button
        class="quiet"
        onclick={exportJSON}
        disabled={!ready || importing || !scan}>↗ Backup</button
      >
      <button
        class="queue-count"
        onclick={() => (panel = 'queue')}
        disabled={!ready}>Vorgemerkt <span>{pending.length}</span></button
      >
    </nav>
  </header>

  <div class="safety-note">
    <span class="dot"></span> Read-only-Vorabversion
    <span class="separator">·</span> Entscheidungen bleiben lokal. YouTube wird nicht
    verändert.
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
          Verbinde einen angemeldeten YouTube-Tab.<br />LaterSift liest deine
          Watch-Later-Liste und sichert sie lokal.
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
                    ? `${decisions.length} Entscheidungen gespeichert. Noch keine Änderungen an YouTube.`
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
            onclick={() => (panel = null)}>×</button
          >
        </div>
        {#if panel === 'import'}
          <h2 id="panel-title">Watch Later lokal sichern.</h2>
          <p>
            Öffne YouTube, melde dich an und zeige die Playlist „Später
            ansehen“. Der Scan scrollt den ausgewählten Tab. Nutze ihn
            währenddessen nicht anderweitig.
          </p>
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
          {#if scan}<div class="scan-status">
              <strong
                >{scan.videos.length.toLocaleString('de-DE')} / {scan.expectedCount?.toLocaleString(
                  'de-DE',
                ) ?? '?'} Videos</strong
              ><span
                >{scan.status === 'complete'
                  ? 'Vollständig geprüft'
                  : scan.status === 'running'
                    ? 'Import läuft'
                    : 'Teilbestand / Prüfung offen'}</span
              >
              <p>{scan.message}</p>
              {#if scan.unidentifiableRows}<p>
                  {scan.unidentifiableRows} Einträge ohne sichere Video-ID erkannt.
                </p>{/if}
            </div>{/if}
          <p class="hint">
            Fehlende Videos? In YouTubes Playlist-Menü gegebenenfalls „Nicht
            verfügbare Videos anzeigen“ aktivieren. Ein erneuter Import startet
            oben; lokale Entscheidungen und frühere vollständige Snapshots
            bleiben erhalten. Maximal 20 Minuten pro Versuch.
          </p>
          {#if importing}<button
              class="primary"
              onclick={() => port?.postMessage({ type: 'cancel' })}
              >Import pausieren</button
            >{:else}<button
              class="primary"
              onclick={importVideos}
              disabled={disabled || !selectedTab}
              >Read-only-Import starten</button
            >{/if}
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
          <label for="archive-url">YouTube-Playlist-URL oder PL…-ID</label
          ><input
            id="archive-url"
            type="text"
            bind:value={archiveInput}
            placeholder="https://www.youtube.com/playlist?list=PL…"
          />
          <p class="hint">
            Kein Zugriff auf fremde Zugangsdaten. Es werden keine Playlists
            erstellt oder verändert.
          </p>
          <button class="primary" onclick={saveArchive} {disabled}
            >Ziel lokal speichern</button
          >
        {:else if panel === 'queue'}
          <h2 id="panel-title">{pending.length} Änderungen vorgemerkt.</h2>
          <p>{WRITE_GATE}</p>
          <div class="write-gate">
            <strong>0 YouTube-Änderungen ausgeführt</strong><span
              >Kein „Anwenden“-Schalter in dieser Vorabversion.</span
            >
          </div>
          <div class="queue-list">
            {#each lib.decisions
              .filter((d) => d.kind !== 'defer')
              .toReversed() as d (d.id)}<div class="queue-row">
                <div>
                  <strong>{decisionLabels[d.kind]}</strong><span
                    >{videos.find((v) => v.id === d.videoId)?.title ||
                      d.videoId}</span
                  ><small
                    >{operationLabels[d.status]} · {d.id}{d.targetPlaylist
                      ? ` · Ziel ${d.targetPlaylist}`
                      : ''}</small
                  >
                </div>
                <button
                  aria-label={`Vormerkung für ${d.videoId} zurücknehmen`}
                  onclick={() =>
                    change((copy) => {
                      copy.decisions = copy.decisions.filter(
                        (item) => item.id !== d.id,
                      );
                    })}
                  disabled={disabled || d.status !== 'pending'}>↶</button
                >
              </div>{/each}
          </div>
          <button onclick={exportJSON} disabled={importing || !scan}
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
