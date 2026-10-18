<script lang="ts">
  import { onMount } from 'svelte';
  import type { Runtime } from 'webextension-polyfill';
  import type { PlaylistCatalog, PlaylistEntry } from './adapter/playlists';
  import { connectRead, activateYouTubeTab } from './bridge';
  import {
    createWorkTab,
    waitForWorkTab,
    type WorkTabDiagnostic,
  } from './work-tabs';
  import WorkTabDiagnostics from './WorkTabDiagnostics.svelte';
  import { formatPlaylistDiagnostic } from './playlist-diagnostics';
  import {
    mergePlaylistHistory,
    playlistDisplayName,
    playlistNameLabel,
  } from './playlist-catalog';

  let {
    disabled = false,
    onchoose,
  }: { disabled?: boolean; onchoose: (id: string) => void } = $props();
  let catalog = $state<PlaylistCatalog | null>(null);
  let previous = $state<PlaylistEntry[]>([]);
  let busy = $state(false);
  let error = $state('');
  let diagnosticFeedback = $state('');
  const diagnosticJSON = $derived(
    catalog ? formatPlaylistDiagnostic(catalog.diagnostics) : '',
  );
  const catalogStatus = $derived(
    catalog?.status === 'running'
      ? 'Aktualisierung läuft'
      : catalog?.diagnostics.reason === 'unsupported_dom'
        ? 'Nicht unterstützte Playlist-Struktur (unsupported_dom)'
        : catalog?.diagnostics.reason === 'no_card_containers'
          ? 'Keine unterstützten Kartencontainer (no_card_containers)'
          : catalog?.status === 'failed'
            ? 'Playlist-Erkennung fehlgeschlagen'
            : catalog?.status === 'interrupted'
              ? 'Aktualisierung unterbrochen'
              : 'Teilbestand / Vollständigkeit offen',
  );
  async function copyDiagnostic() {
    try {
      await navigator.clipboard.writeText(diagnosticJSON);
      diagnosticFeedback = 'Bereinigte Playlist-Diagnose kopiert.';
    } catch {
      diagnosticFeedback =
        'Kopieren nicht möglich. Diagnose markieren und manuell kopieren.';
    }
  }
  let workTabReports = $state<WorkTabDiagnostic[]>([]);
  function recordWorkTab(report: WorkTabDiagnostic) {
    if (JSON.stringify(workTabReports.at(-1)) !== JSON.stringify(report))
      workTabReports = [...workTabReports.slice(-11), report];
  }
  let tabId = $state<number | null>(null);
  let port = $state.raw<Runtime.Port | null>(null);
  let disposed = false;
  const key = 'latersift-playlist-catalog-v1';
  onMount(() => {
    try {
      const prior = localStorage.getItem(`${key}-previous`);
      if (prior) previous = JSON.parse(prior) as PlaylistEntry[];
      const stored = localStorage.getItem(key);
      if (stored) {
        catalog = JSON.parse(stored) as PlaylistCatalog;
        if (catalog.status === 'running') {
          catalog.status = 'interrupted';
          catalog.message =
            'Vorherige Aktualisierung unterbrochen. Gesicherter Katalog bleibt erhalten.';
          localStorage.setItem(key, JSON.stringify(catalog));
        }
      }
    } catch (e) {
      error = `Katalog konnte nicht geladen werden: ${String(e)}`;
    }
    return () => {
      disposed = true;
      port?.disconnect();
    };
  });
  async function refresh() {
    if (busy || disabled) return;
    busy = true;
    error = '';
    workTabReports = [];
    diagnosticFeedback = '';
    previous = mergePlaylistHistory(previous, catalog?.entries ?? []);
    let work: Awaited<ReturnType<typeof createWorkTab>> | undefined;
    try {
      localStorage.setItem(`${key}-previous`, JSON.stringify(previous));
      work = await createWorkTab('playlists');
      tabId = work.tabId;
      await waitForWorkTab(work.tabId, recordWorkTab);
      if (disposed) return;
      await new Promise<void>((resolve, reject) => {
        void connectRead<PlaylistCatalog>(
          work!.tabId,
          async (checkpoint) => {
            localStorage.setItem(key, JSON.stringify(checkpoint));
            catalog = checkpoint;
          },
          (message) => {
            port = null;
            if (message) reject(new Error(message));
            else resolve();
          },
          { type: 'playlists' },
        )
          .then((connected) => {
            port = connected;
            if (disposed) port.disconnect();
          })
          .catch(reject);
      });
    } catch (e) {
      error = `Playlist-Aktualisierung unterbrochen: ${String(e)}`;
    } finally {
      if (catalog?.status === 'running') {
        catalog = {
          ...catalog,
          status: 'interrupted',
          message:
            'Aktualisierung unterbrochen; bestätigter Teilkatalog gesichert.',
        };
        try {
          localStorage.setItem(key, JSON.stringify(catalog));
        } catch (e) {
          error = `Speicherung fehlgeschlagen: ${String(e)}`;
        }
      }
      try {
        await work?.close();
      } catch (e) {
        error = `Arbeitstab konnte nicht bereinigt werden: ${String(e)}`;
      }
      tabId = null;
      busy = false;
    }
  }
</script>

<section aria-label="Playlist-Katalog">
  <button onclick={refresh} disabled={disabled || busy}
    >{busy ? 'Playlists werden gelesen …' : 'Playlists aktualisieren'}</button
  >
  <p class="hint">
    Read-only im inaktiven Arbeitstab. Kein Fokuswechsel, keine
    YouTube-Änderungen. Anmeldung bei YouTube erforderlich. Vollständigkeit und
    Eigentümerschaft bleiben ungeprüft.
  </p>
  {#if busy && tabId !== null}
    <button
      onclick={() =>
        activateYouTubeTab(tabId!).catch((e) => {
          error = String(e);
        })}>YouTube bei Bedarf ausdrücklich aktivieren ↗</button
    >
    <button
      onclick={() => port?.postMessage({ type: 'cancel' })}
      disabled={!port}>Aktualisierung abbrechen</button
    >
  {/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <WorkTabDiagnostics reports={workTabReports} />
  {#if catalog}
    <p role="status">
      {catalog.entries.length} Playlists · {catalogStatus} · Stand: {catalog.updatedAt}
    </p>
    <p>{catalog.message}</p>
    <ul aria-label="Verifizierte Playlist-IDs">
      {#each catalog.entries as entry (entry.id)}
        <li>
          <strong>{playlistDisplayName(entry)}</strong> · {playlistNameLabel(
            entry,
          )} · ID aus URL: <code>{entry.id}</code> (nachgewiesen) ·
          Sichtbarkeit: {entry.visibility} · Eigentümer: unbekannt · Schreibbarkeit:
          nicht bestätigt
          <button
            onclick={() => onchoose(entry.id)}
            disabled={disabled || busy || !/^PL[\w-]+$/.test(entry.id)}
            >Als lokales Archivziel wählen</button
          >
        </li>
      {/each}
    </ul>
    <details class="dialog-diagnostic">
      <summary>Technische Playlist-Diagnose</summary>
      <p class="hint">
        Identitätsfehler und Namenswarnungen werden getrennt vom Katalogbestand
        erfasst. Ein fehlender oder mehrdeutiger Name verwirft keine belegte
        Playlist-ID. Latest zählt die letzte Runde, Peaks den höchsten
        gleichzeitig beobachteten Wert, nicht die Summe wiederholter Versuche.
        Struktursamples enthalten auch identifizierte Karten ohne Namen. Keine
        Playlist-Namen, IDs oder URL-Werte. Ein nicht scrollbares Dokument kann
        regulär sein.
      </p>
      <textarea
        aria-label="Bereinigte Playlist-Feed-Diagnose"
        readonly
        rows="18"
        value={diagnosticJSON}
      ></textarea>
      <button onclick={copyDiagnostic}>Playlist-Diagnose kopieren</button>
      {#if diagnosticFeedback}<p role="status">{diagnosticFeedback}</p>{/if}
    </details>
  {/if}
  {#if previous.some((entry) => !catalog?.entries.some((current) => current.id === entry.id))}
    <details>
      <summary>Vorheriger Katalog (veraltet, vor dieser Aktualisierung)</summary
      >
      <ul>
        {#each previous.filter((entry) => !catalog?.entries.some((current) => current.id === entry.id)) as entry (entry.id)}
          <li>
            {playlistDisplayName(entry)} · {entry.id} · {playlistNameLabel(
              entry,
            )} · Schreibbarkeit: nicht bestätigt
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>
