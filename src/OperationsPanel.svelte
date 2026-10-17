<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Library } from './model';
  import { latestScan } from './model';
  import { catalog } from './session';
  import { loadSnapshot } from './storage';
  import {
    operationState,
    confirmExport,
    approveExecution,
    executeApproved,
    acknowledgeLiveStage,
    type DecisionJournal,
  } from './operations';
  import { createWriteBridge } from './write-bridge';
  import { operationLabels } from './i18n';

  let {
    library,
    disabled,
    oncommit,
    onbusy,
  }: {
    library: Library;
    disabled: boolean;
    oncommit: (copy: Library) => Promise<void>;
    onbusy: (value: boolean) => void;
  } = $props();
  let selected = $state<string[]>([]);
  let exportSaved = $state(false);
  let consent = $state(false);
  let attested = $state(false);
  let working = $state(false);
  let running = $state(false);
  let stop = $state(false);
  let error = $state('');
  let message = $state('');
  let destroyed = false;
  let activeBridge: Awaited<ReturnType<typeof createWriteBridge>> | undefined;
  let runIds = $state<string[]>([]);
  let runStartedAt = $state(0);
  let persistedId = $state('');
  const scan = $derived(latestScan(library));
  const snapshotKey = $derived(JSON.stringify(scan));
  $effect(() => {
    const latest = scan;
    const key = snapshotKey;
    let cancelled = false;
    persistedId = '';
    exportSaved = false;
    consent = false;
    if (latest?.status === 'complete') {
      void loadSnapshot(latest.id)
        .then((stored) => {
          if (
            !cancelled &&
            key &&
            stored?.status === 'complete' &&
            stored.id === latest.id
          )
            persistedId = stored.id;
        })
        .catch(() => {
          /* The explicit confirmation reports storage errors. */
        });
    }
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    // Any committed library change invalidates the old grant, including journal updates.
    if (library) {
      consent = false;
      attested = false;
    }
  });
  onDestroy(() => {
    destroyed = true;
    stop = true;
    activeBridge?.close();
    activeBridge = undefined;
    if (working) onbusy(false);
  });
  async function commitWhileMounted(copy: Library) {
    if (destroyed)
      throw new Error(
        'Schreibpilot geschlossen; Ausgang bitte nach erneutem Öffnen prüfen.',
      );
    await oncommit(copy);
    if (destroyed) throw new Error('Schreibpilot geschlossen.');
  }
  const ops = $derived(operationState(library));
  const videos = $derived(catalog(library));
  const decisions = $derived(
    library.decisions.filter((d) => d.kind !== 'defer'),
  );
  const exportConfirmed = $derived(
    scan?.status === 'complete' &&
      persistedId === scan.id &&
      ops.exportConfirmation?.snapshotId === scan.id,
  );
  const eligible = $derived(
    decisions.filter((d) =>
      ['pending', 'failed', 'unknown'].includes(d.status),
    ),
  );
  const progressIds = $derived(
    runIds.length ? runIds : (ops.lastRun?.decisionIds ?? []),
  );
  const runDecisions = $derived(
    decisions.filter((d) => progressIds.includes(d.id)),
  );

  const freshResults = $derived(
    runDecisions.filter(
      (d) =>
        !running ||
        Object.values(d.journal ?? {}).some(
          (step) =>
            step.status === d.status &&
            Date.parse(step.updatedAt ?? '') >= runStartedAt,
        ),
    ),
  );
  const current = $derived(
    runDecisions.find((d) => d.status === 'running') ??
      (running
        ? runDecisions.find((d) => !freshResults.includes(d))
        : undefined),
  );
  const counts = $derived({
    verified: freshResults.filter((d) => d.status === 'verified').length,
    failed: freshResults.filter((d) => d.status === 'failed').length,
    unknown: freshResults.filter((d) => d.status === 'unknown').length,
  });
  const finished = $derived(counts.verified + counts.failed + counts.unknown);
  const validSelection = $derived(
    selected.length > 0 &&
      selected.length <= ops.limit &&
      selected.every((id) => eligible.some((d) => d.id === id)),
  );
  const nextStage = $derived(ops.limit === 1 ? 5 : ops.limit === 5 ? 25 : null);
  const evidence = $derived(
    decisions.findLast((d) => {
      const journal: DecisionJournal | undefined = d.journal;
      return (
        ops.lastRun?.status === 'complete' &&
        ops.lastRun.decisionIds.length === ops.limit &&
        ops.lastRun.decisionIds.every((id) =>
          decisions.some(
            (item) => item.id === id && item.status === 'verified',
          ),
        ) &&
        ops.lastRun.decisionIds.includes(d.id) &&
        !ops.attestations.some((a) => a.decisionId === d.id) &&
        d.status === 'verified' &&
        journal?.remove.status === 'verified' &&
        (!journal.add || journal.add.status === 'verified') &&
        ((journal.remove.outcome === 'changed' &&
          journal.remove.attempts > 0) ||
          (journal.add?.outcome === 'changed' && journal.add.attempts > 0))
      );
    }),
  );

  function choose(id: string, checked: boolean) {
    selected = checked
      ? [...selected, id]
      : selected.filter((item) => item !== id);
    consent = false;
  }
  async function persistedSnapshot(copy: Library) {
    const latest = latestScan(copy);
    if (!latest || latest.status !== 'complete')
      throw new Error('Der neueste Scan muss vollständig sein.');
    const stored = await loadSnapshot(latest.id);
    if (destroyed) throw new Error('Schreibpilot geschlossen.');
    if (!stored || stored.status !== 'complete' || stored.id !== latest.id)
      throw new Error(
        'Kein tatsächlich gespeicherter vollständiger Snapshot vorhanden. Bitte vollständig importieren und sichern.',
      );
    return latest.id;
  }
  async function guarded(action: () => Promise<void>) {
    if (disabled || working || destroyed) return;
    working = true;
    onbusy(true);
    error = '';
    message = '';
    try {
      await action();
    } catch (e) {
      if (!destroyed) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (!destroyed) {
        running = false;
        working = false;
        onbusy(false);
      }
    }
  }
  async function saveExportConfirmation() {
    if (!exportSaved) return;
    await guarded(async () => {
      const copy = structuredClone(library);
      const id = await persistedSnapshot(copy);
      confirmExport(copy, id);
      await commitWhileMounted(copy);
      message = 'Exportbestätigung für diesen Snapshot gespeichert.';
    });
  }
  async function execute() {
    if (!consent || !validSelection || !exportConfirmed) return;
    // Pin the exact selection before the first asynchronous step.
    const ids = [...selected];
    consent = false;
    await guarded(async () => {
      const copy = structuredClone(library);
      await persistedSnapshot(copy);
      const approval = approveExecution(copy, ids);
      consent = false;
      stop = false;
      runIds = ids;
      runStartedAt = Date.now();
      running = true;
      const bridge = await createWriteBridge(approval);
      if (destroyed) {
        bridge.close();
        return;
      }
      activeBridge = bridge;
      try {
        const result = await executeApproved(
          copy,
          approval,
          bridge.adapter,
          commitWhileMounted,
          () => stop || destroyed,
        );
        await commitWhileMounted(result);
        selected = [];
        message = stop
          ? 'Gestoppt nach der aktuellen Aktion. Einzelstatus beachten.'
          : 'Durchlauf beendet. Einzelstatus beachten.';
      } finally {
        bridge.close();
        if (activeBridge === bridge) activeBridge = undefined;
      }
    });
  }
  async function undoPending(id: string) {
    await guarded(async () => {
      const copy = structuredClone(library);
      const decision = copy.decisions.find((d) => d.id === id);
      if (!decision || decision.status !== 'pending' || decision.journal)
        throw new Error(
          'Nur unberührte lokale Vormerkungen können zurückgenommen werden.',
        );
      copy.decisions = copy.decisions.filter((d) => d.id !== id);
      await commitWhileMounted(copy);
      selected = selected.filter((item) => item !== id);
      consent = false;
    });
  }
  async function upgrade() {
    if (!attested || !nextStage || !evidence) return;
    const limit = nextStage;
    const decisionId = evidence.id;
    await guarded(async () => {
      const copy = structuredClone(library);
      acknowledgeLiveStage(copy, limit, decisionId);
      await commitWhileMounted(copy);
      attested = false;
      consent = false;
    });
  }
</script>

<section aria-label="YouTube-Schreibpilot" class="operations">
  <p>
    Entscheidungen sind zunächst nur lokal vorgemerkt. Der Schreibpilot ändert
    YouTube erst nach deiner ausdrücklichen Freigabe. Prüfe das Ergebnis des
    ersten Piloten zusätzlich direkt in YouTube, bevor du das Limit erhöhst.
  </p>
  <p>
    <strong
      >Pilotlimit: {ops.limit} Entscheidung{ops.limit === 1 ? '' : 'en'} pro Freigabe.</strong
    > Zunächst genau eine; Archivieren umfasst Hinzufügen und erst danach Entfernen.
  </p>
  {#if running || progressIds.length}
    <div aria-label="Schreibfortschritt" role="status" class="run-progress">
      <p>
        {running ? 'Durchlauf läuft' : 'Letzter Durchlauf'} · {finished} / {progressIds.length}
        Ergebnisse
      </p>
      <p>
        Verified: {counts.verified} · Failed: {counts.failed} · Unknown: {counts.unknown}
      </p>
      <progress
        aria-label="Ausführungsfortschritt"
        value={finished}
        max={progressIds.length || 1}
      ></progress>
      {#if running}
        <p>
          {#if current}Aktuell: {videos.find((v) => v.id === current.videoId)
              ?.title || 'Titel unbekannt'} · Video-ID: {current.videoId}{:else}Vorbereitung
            / frischer YouTube-Preflight{/if}
        </p>
        <button onclick={() => (stop = true)} disabled={stop}
          >{stop
            ? 'Stopp angefordert'
            : 'Nach aktueller Aktion stoppen'}</button
        >
      {/if}
    </div>
  {/if}
  <div class="queue-list">
    {#each decisions.toReversed() as d (d.id)}
      {@const video = videos.find((v) => v.id === d.videoId)}
      <article class="operation-row">
        <label>
          <input
            type="checkbox"
            aria-label={`Auswählen: ${d.videoId}`}
            checked={selected.includes(d.id)}
            onchange={(e) => choose(d.id, e.currentTarget.checked)}
            disabled={disabled ||
              working ||
              !eligible.some((item) => item.id === d.id) ||
              (!selected.includes(d.id) && selected.length >= ops.limit)}
          />
          <span
            ><strong>{video?.title || 'Titel unbekannt'}</strong><br />Video-ID:
            <code>{d.videoId}</code></span
          >
        </label>
        <p>
          {d.kind === 'archive'
            ? 'Zum Archiv hinzufügen, danach aus Watch Later entfernen'
            : 'Aus Watch Later entfernen'}
        </p>
        {#if d.kind === 'archive'}<p>
            Hinzufügen → <a
              href={`https://www.youtube.com/playlist?list=${encodeURIComponent(d.targetPlaylist || '')}`}
              target="_blank"
              rel="noreferrer"
              >https://www.youtube.com/playlist?list={d.targetPlaylist}</a
            >
          </p>{/if}
        <p>
          Entfernen → <a
            href="https://www.youtube.com/playlist?list=WL"
            target="_blank"
            rel="noreferrer">https://www.youtube.com/playlist?list=WL</a
          >
        </p>
        <p>Gesamt: {operationLabels[d.status]} ({d.status})</p>
        {#if d.status === 'unknown' || d.status === 'failed'}
          <p class="hint">
            {d.status === 'unknown'
              ? 'Ausgang unklar: Bitte zuerst manuell in YouTube prüfen.'
              : 'Fehlgeschlagen: Ergebnis vor einer Wiederholung prüfen.'} Nur nach
            neuer Auswahl und neuer ausdrücklicher Freigabe erneut starten. Der Preflight
            liest den aktuellen YouTube-Zustand frisch; keine automatische Wiederholung.
          </p>
        {/if}
        {#if d.kind === 'archive'}<p>
            Add: {d.journal?.add?.status || 'pending'}
            {d.journal?.add?.message || ''}
          </p>{/if}
        <button
          aria-label={`Vormerkung für ${d.videoId} zurücknehmen`}
          onclick={() => undoPending(d.id)}
          disabled={disabled ||
            working ||
            d.status !== 'pending' ||
            !!d.journal}>↶ Lokal zurücknehmen</button
        >
        <p>
          Remove: {d.journal?.remove.status || 'pending'}
          {d.journal?.remove.message || ''}
        </p>
      </article>
    {/each}
    {#if !decisions.length}<p>Keine Änderungen vorgemerkt.</p>{/if}
  </div>
  <p class="hint">
    Verified = einzeln geprüft; failed = fehlgeschlagen; unknown = unklar, nicht
    automatisch erneut ausführen. Lokales Rückgängigmachen ist keine
    YouTube-Wiederherstellung.
  </p>
  <p>{selected.length} ausgewählt · keine automatische Vorauswahl.</p>
  {#if scan?.status !== 'complete'}<p role="status">
      Schreibzugriff gesperrt: Der neueste Scan ist nicht vollständig.
    </p>{/if}
  <a href="#operations-backup">Zum bestehenden Backup-Export ↓</a>
  <p class="hint">
    Backup zuerst herunterladen und lokal speichern. Der Export ist keine
    Garantie für eine automatische Wiederherstellung.
  </p>
  <label
    ><input
      type="checkbox"
      bind:checked={exportSaved}
      disabled={disabled || working}
    /> Ich habe den Export dieses vollständigen Snapshots lokal gespeichert.</label
  >
  <button
    onclick={saveExportConfirmation}
    disabled={disabled ||
      working ||
      !exportSaved ||
      scan?.status !== 'complete'}>Exportbestätigung speichern</button
  >
  <p role="status">
    {exportConfirmed
      ? 'Export für aktuellen Snapshot bestätigt.'
      : 'Exportbestätigung für aktuellen Snapshot fehlt.'}
  </p>
  <label
    ><input
      type="checkbox"
      bind:checked={consent}
      disabled={disabled || working || !validSelection || !exportConfirmed}
    />
    Ich erlaube genau diese {selected.length} ausgewählten Entscheidungen mit den
    oben genannten Video-IDs, Aktionen und Ziel-URLs.</label
  >
  <button
    class="primary"
    onclick={execute}
    disabled={disabled ||
      working ||
      !validSelection ||
      !exportConfirmed ||
      !consent}>YouTube-Arbeitstab öffnen und Auswahl ausführen</button
  >
  <p class="hint">
    Dieser Button öffnet einen eigenen YouTube-Arbeitstab. Keine Schreibaktion
    ohne die genaue Freigabe; der angemeldete YouTube-Zugang wird benötigt.
  </p>

  {#if nextStage && evidence}
    <label
      ><input
        type="checkbox"
        bind:checked={attested}
        disabled={disabled || working}
      />
      Ich habe die tatsächlich geänderte und verifizierte Entscheidung {evidence.id}
      in YouTube geprüft und bestätige den erfolgreichen {ops.limit}er-Piloten.</label
    >
    <button onclick={upgrade} disabled={disabled || working || !attested}
      >Pilotlimit ausdrücklich auf {nextStage} erhöhen</button
    >
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .operations {
    display: grid;
    gap: 12px;
  }
  .operation-row {
    border-bottom: 1px solid var(--line);
    padding: 12px 0;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
  label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 8px 0;
  }
  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }
  .queue-list {
    margin: 0;
  }
  a {
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
</style>
