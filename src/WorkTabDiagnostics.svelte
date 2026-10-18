<script lang="ts">
  import type { WorkTabDiagnostic } from './work-tabs';
  let { reports }: { reports: WorkTabDiagnostic[] } = $props();
</script>

{#if reports.length}
  <details>
    <summary>Arbeitstab-Diagnose (ohne URL-Parameter)</summary>
    <p class="hint">
      Ladephasen und freigegebene Pfadkategorien, keine vollständigen URLs oder
      Markerwerte. „unknown“ bedeutet, dass der Browser keinen passenden
      URL-Kontext geliefert hat. Fremde Zielseiten werden nicht als Playlist
      akzeptiert.
    </p>
    {#if reports.some((report) => report.reason === 'consent_required' || report.reason === 'sign_in_required')}
      <p class="hint">
        YouTube hat eine Zustimmungs- oder Anmeldeseite angezeigt. Bitte den
        erhaltenen Arbeitstab selbst prüfen und anschließend die Aktualisierung
        neu starten. LaterSift bestätigt nichts und aktiviert keinen Tab
        automatisch.
      </p>
    {/if}
    {#if reports.some((report) => report.reason === 'marker_lost')}
      <p class="hint">
        Der Zielkontext ist lesbar, aber der Eigentumsmarker wurde verändert.
        Dieser Tab bleibt zur manuellen Bereinigung erhalten.
      </p>
    {/if}
    <textarea
      aria-label="Bereinigte Arbeitstab-Diagnose"
      readonly
      rows="12"
      value={JSON.stringify(reports, null, 2)}
    ></textarea>
  </details>
{/if}
