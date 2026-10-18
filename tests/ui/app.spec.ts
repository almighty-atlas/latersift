import { test, expect, type Page } from '@playwright/test';
import type { Scan } from '../../src/model';
import type {
  PlaylistCatalog,
  PlaylistEntry,
} from '../../src/adapter/playlists';

async function seed(
  page: Page,
  scanOverrides: Partial<Scan> = {},
  {
    priorScans = [],
    videoCount = 3,
  }: { priorScans?: Partial<Scan>[]; videoCount?: number } = {},
) {
  await page.goto('/');
  await page.waitForSelector('text=Watch Later importieren');
  await page.evaluate(
    async ({ scanOverrides, priorScans, videoCount }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('latersift', 1);
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(
        {
          schemaVersion: 1,
          archivePlaylist: 'PL1234567890123456',
          session: null,
          decisions: [],
          scans: [...priorScans, scanOverrides].map((overrides) => ({
            id: 'fixture-explicit',
            startedAt: '2026-10-17T00:00:00Z',
            finishedAt: '2026-10-17T00:00:00Z',
            status: 'complete',
            expectedCount: 3,
            unidentifiableRows: 0,
            message: 'TEST FIXTURE, NOT LIVE YOUTUBE',
            videos: Array.from({ length: videoCount }, (_, n) => ({
              id: String(n).padStart(11, '0'),
              url: `https://www.youtube.com/watch?v=${String(n).padStart(11, '0')}`,
              title: n === 2 ? '[Private video]' : `Fixture Video ${n + 1}`,
              channel: 'Fixture Channel',
              thumbnail: null,
              durationSeconds: 600,
              publishedAt: null,
              position: n + 1,
              availability: n === 2 ? 'private' : 'unknown',
              evidence: n === 2 ? '[Private video]' : null,
              scannedAt: '2026-10-17T00:00:00Z',
              originalPlaylist: 'WL',
            })),
            ...overrides,
          })),
        },
        'library',
      );
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { scanOverrides, priorScans, videoCount },
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Runde starten' }),
  ).toBeEnabled();
}
test('empty state is honest, import has no simulated YouTube results', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch Later importieren' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialog = page.getByRole('dialog');
  const start = dialog.getByRole('button', {
    name: 'Read-only-Import neu starten',
  });
  await expect(start).toBeEnabled();
  const existingTab = dialog.getByRole('checkbox', {
    name: 'Eigenen Tab verwenden (wird niemals automatisch geschlossen)',
    exact: true,
  });
  await expect(existingTab).not.toBeVisible();
  await dialog
    .getByText('Erweitert: vorhandenen YouTube-Tab verwenden', { exact: true })
    .click();
  await expect(existingTab).not.toBeChecked();
  await expect(dialog.getByLabel('Verbundener Watch-Later-Tab')).toHaveValue(
    '',
  );
  await expect(dialog.getByText('Kein passender Tab gefunden')).toBeAttached();
  await expect(
    dialog.getByRole('button', { name: 'Tabs aktualisieren' }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole('button', { name: 'YouTube öffnen ↗' }),
  ).toBeEnabled();
  await existingTab.check();
  await expect(start).toBeDisabled();
  await existingTab.uncheck();
  await expect(start).toBeEnabled();
  await expect(page.getByRole('alert').last()).toContainText(
    'geladenen Firefox-/Zen-Erweiterung',
  );
});
for (const status of [
  'incomplete',
  'interrupted',
  'running',
  'waiting',
  'needs_attention',
] as const) {
  test(`persisted ${status} scan preserves partial progress and allows work-tab resume without a selected tab`, async ({
    page,
  }) => {
    await seed(page, {
      status,
      finishedAt: null,
      expectedCount: 8,
      unidentifiableRows: 2,
      message: 'Gesicherter Teilbestand; Vollständigkeit nicht bestätigt.',
    });
    await page.getByRole('button', { name: '↓ Import', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('3 / 8 Videos · 37,5 %')).toBeVisible();
    await expect(
      dialog.getByText(
        status === 'incomplete'
          ? 'Teilbestand / Prüfung offen'
          : 'Unterbrochen / pausiert',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        'Gesicherter Teilbestand; Vollständigkeit nicht bestätigt.',
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText('Letzter Fortschritt: unbekannt'),
    ).toBeVisible();
    await expect(
      dialog.getByText('Nur lokal gesicherte Checkpoints werden angezeigt.'),
    ).toBeVisible();
    await expect(
      dialog.getByText('2 Einträge ohne sichere Video-ID erkannt.'),
    ).toBeVisible();
    const resume = dialog.getByRole('button', {
      name: 'Fortsetzen / erneut versuchen',
    });
    await expect(resume).toBeVisible();
    await expect(resume).toBeEnabled();
    const restart = dialog.getByRole('button', {
      name: 'Read-only-Import neu starten',
    });
    await expect(restart).toBeEnabled();
    await dialog
      .getByText('Erweitert: vorhandenen YouTube-Tab verwenden', {
        exact: true,
      })
      .click();
    await expect(dialog.getByLabel('Verbundener Watch-Later-Tab')).toHaveValue(
      '',
    );
    const existingTab = dialog.getByRole('checkbox', {
      name: 'Eigenen Tab verwenden (wird niemals automatisch geschlossen)',
      exact: true,
    });
    await expect(existingTab).not.toBeChecked();
    await existingTab.check();
    await expect(resume).toBeDisabled();
    await expect(restart).toBeDisabled();
    await existingTab.uncheck();
    await expect(resume).toBeEnabled();
    await expect(restart).toBeEnabled();
    await expect(
      dialog.getByRole('button', { name: 'YouTube-Tab aktivieren ↗' }),
    ).toBeDisabled();
    await expect(
      dialog.getByText('Vollständig geprüft', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Import gespeichert', { exact: true }),
    ).toHaveCount(0);
  });
}

for (const { expectedCount, progress, videoCount = 3 } of [
  { expectedCount: null, progress: '3 / ? Videos · Prozent unbekannt' },
  { expectedCount: 2, progress: '3 / 2 Videos · 100,0 %' },
  { expectedCount: 41, videoCount: 39, progress: '39 / 41 Videos · 95,1 %' },
]) {
  test(`persisted incomplete progress handles expected count ${expectedCount} without claiming completion`, async ({
    page,
  }) => {
    await seed(page, { status: 'incomplete', expectedCount }, { videoCount });
    await page.getByRole('button', { name: '↓ Import', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(progress)).toBeVisible();
    await expect(
      dialog.getByText('Teilbestand / Prüfung offen', { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText('Vollständig geprüft', { exact: true }),
    ).toHaveCount(0);
  });
}

for (const totalAttentionMs of [undefined, 9000]) {
  test(`persisted background-tab warning and technical diagnostics with totalAttentionMs ${totalAttentionMs}`, async ({
    page,
  }) => {
    const message =
      'YouTube lädt momentan nicht weiter. Aktiviere den YouTube-Tab, um das Nachladen fortzusetzen.';
    const diagnostics = {
      lastProgressAt: '2026-10-17T00:00:00Z',
      visibility: 'hidden',
      reason: 'background_tab_stalled',
      highestPosition: 5,
      missingPositions: [2, 4],
      recoveryAttempts: 2,
      recoveryResults: ['scroll_retry_no_progress'],
      positionConflict: false,
      activeMs: 12000,
      attentionMs: 3000,
      ...(totalAttentionMs === undefined ? {} : { totalAttentionMs }),
      scroll: { container: 'document', top: 1200, height: 2400, viewport: 800 },
      continuation: true,
      confirmedCount: 2,
    };
    await seed(page, {
      status: 'needs_attention',
      finishedAt: null,
      expectedCount: 8,
      message,
      diagnostics: { ...diagnostics, documentId: 'private-document-id' },
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Runde starten' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: '↓ Import', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(message, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('Unterbrochen / pausiert', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText('2 / 8 Videos · 25,0 %')).toBeVisible();
    await expect(dialog.getByText('3 / 8 Videos · 37,5 %')).toHaveCount(0);
    await expect(
      dialog.getByText(/3 IDs insgesamt lokal erhalten\./),
    ).toBeVisible();
    await expect(
      dialog.getByText(/Im aktuellen Dokument bestätigte IDs:\s*2\./),
    ).toBeVisible();
    await expect(
      dialog.getByText(/Letzter Fortschritt: vor \d+ s/),
    ).toBeVisible();
    await expect(dialog.getByRole('alert').last()).toContainText(
      'geladenen Firefox-/Zen-Erweiterung',
    );
    await expect(
      dialog.getByRole('button', { name: 'YouTube-Tab aktivieren ↗' }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Fortsetzen / erneut versuchen' }),
    ).toBeEnabled();
    await expect(
      dialog.getByText('Vollständig geprüft', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Import gespeichert', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Diagnose kopiert · ohne Video-Metadaten'),
    ).toHaveCount(0);

    await dialog
      .getByText('Import-Diagnose (ohne Video-Metadaten)', { exact: true })
      .click();
    const output = dialog.getByRole('textbox', {
      name: 'Import-Diagnose JSON',
    });
    await expect(output).toBeVisible();
    await expect(output).toHaveAttribute('readonly', '');
    const json = await output.inputValue();
    expect(JSON.parse(json)).toEqual({
      count: 3,
      expectedCount: 8,
      status: 'interrupted',
      diagnostics,
    });
    for (const privateValue of [
      'fixture-explicit',
      'Fixture Video',
      'Fixture Channel',
      '[Private video]',
      '00000000000',
      '00000000001',
      '00000000002',
      'https://www.youtube.com/watch?v=',
      'private-document-id',
      message,
    ]) {
      expect(json).not.toContain(privateValue);
    }
    expect(json).not.toMatch(
      /"(?:id|documentId|title|channel|url|videos|message)"\s*:/,
    );
  });
}

test('0.2.9 import trace survives reload and copies bounded observations without private data', async ({
  page,
}) => {
  const scroll = {
    container: 'document',
    epoch: 1,
    top: 1000,
    height: 2000,
    viewport: 1000,
  };
  const action = {
    kind: 'advance' as const,
    sequence: 2,
    before: { ...scroll, top: 500 },
    requestedTop: 1000,
    after: scroll,
    outcome: 'target-observed' as const,
    attribution: 'during-call-only' as const,
  };
  const entry = {
    round: 3,
    elapsedMs: 3000,
    visibility: 'hidden' as const,
    scroll,
    distanceToEnd: 0,
    renderedRows: 100,
    visibleRows: 100,
    confirmedCount: 100,
    newConfirmed: 0,
    progressAgeMs: 3000,
    continuation: true,
    loadingArea: {
      visibleElements: 1,
      inViewport: true,
      distanceToViewport: 0,
    },
    atGeometryEnd: true,
    action,
    afterAction: 1,
    laterDelta: 200,
    laterAttribution: 'unknown' as const,
    containerChanged: false,
    title: 'PRIVATE_TRACE_TITLE',
    url: 'https://private.invalid/secret',
  };
  await seed(page, {
    status: 'incomplete',
    expectedCount: 4927,
    diagnostics: {
      lastProgressAt: '2026-10-18T00:00:00.000Z',
      visibility: 'hidden',
      reason: 'background_loading_stalled',
      highestPosition: 100,
      missingPositions: [],
      recoveryAttempts: 3,
      scroll,
      continuation: true,
      confirmedCount: 100,
      documentId: 'PRIVATE_DOCUMENT',
      backgroundMode: 'experimental',
      timerThrottling: {
        requestedMs: 1000,
        lastElapsedMs: 3165,
        maxElapsedMs: 3165,
        delayedWaits: 8,
      },
      scrollTrace: {
        history: Array.from({ length: 40 }, () => entry),
        actionCount: 20,
        containerChanges: 0,
        totalRecoveryAttempts: 3,
        endObservations: 10,
        lastAction: action,
      },
    },
  });
  await page.reload();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) =>
          Reflect.set(globalThis, 'copiedImportDiagnostic', value),
      },
    }),
  );
  await page.getByRole('button', { name: '↓ Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByText('Import-Diagnose (ohne Video-Metadaten)', { exact: true })
    .click();
  const text = await dialog
    .getByRole('textbox', { name: 'Import-Diagnose JSON' })
    .inputValue();
  const report = JSON.parse(text);
  expect(report.diagnostics.scrollTrace.history).toHaveLength(24);
  expect(report.diagnostics.scrollTrace.history[0]).toMatchObject({
    afterAction: 1,
    laterDelta: 200,
    laterAttribution: 'unknown',
    action: { sequence: 2, requestedDelta: 500, observedDelta: 500 },
    loadingArea: { inViewport: true },
  });
  expect(report.diagnostics.reason).toBe('background_loading_stalled');
  expect(report.diagnostics.timerThrottling.delayedWaits).toBe(8);
  expect(text).not.toMatch(
    /PRIVATE_|private.invalid|Fixture Video|Fixture Channel|documentId|watch\?v=/,
  );
  await dialog
    .getByRole('button', { name: 'Diagnose kopieren', exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      Reflect.get(globalThis, 'copiedImportDiagnostic'),
    ),
  ).toBe(text);
  await expect(
    dialog.getByText('Vollständig geprüft', { exact: true }),
  ).toHaveCount(0);
});

test('latest complete scan does not offer resume for an older incomplete scan', async ({
  page,
}) => {
  await seed(
    page,
    {
      id: 'fixture-latest-complete',
      startedAt: '2026-10-17T01:00:00Z',
      finishedAt: '2026-10-17T01:01:00Z',
    },
    {
      priorScans: [
        {
          id: 'fixture-older-incomplete',
          status: 'incomplete',
          finishedAt: null,
          expectedCount: 8,
          message: 'Älterer Teilbestand',
        },
      ],
    },
  );
  await page.getByRole('button', { name: '↓ Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Vollständig geprüft', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('3 / 3 Videos · 100,0 %')).toBeVisible();
  await expect(
    dialog.getByText('Älterer Teilbestand', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Fortsetzen / erneut versuchen' }),
  ).toHaveCount(0);
  const restart = dialog.getByRole('button', {
    name: 'Read-only-Import neu starten',
  });
  await expect(restart).toBeVisible();
  await expect(restart).toBeEnabled();
  await dialog
    .getByText('Import-Diagnose (ohne Video-Metadaten)', { exact: true })
    .click();
  expect(
    JSON.parse(
      await dialog
        .getByRole('textbox', { name: 'Import-Diagnose JSON' })
        .inputValue(),
    ),
  ).toEqual({
    count: 3,
    expectedCount: 3,
    status: 'complete',
    diagnostics: null,
  });
});

test('keyboard swipe, undo, pause, reload and summary', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Runde starten' }).click();
  await page.locator('h1').click();
  await expect(
    page.getByRole('heading', { name: 'Fixture Video 1' }),
  ).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.getByRole('heading', { name: 'Fixture Video 2' }),
  ).toBeVisible();
  await page.keyboard.press('z');
  await expect(
    page.getByRole('heading', { name: 'Fixture Video 1' }),
  ).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('heading', { name: 'Fixture Video 2' }),
  ).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByText('Eine kleine Pause.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Eine kleine Pause.')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter durchsehen' }).click();
  await page.getByRole('button', { name: 'Zurückstellen' }).click();
  await page
    .getByRole('button', { name: 'Entfernen', exact: false })
    .first()
    .click();
  await expect(page.getByText('Runde abgeschlossen.')).toBeVisible();
  await page.getByRole('button', { name: 'Vorgemerkt 2' }).click();
  await expect(
    page.getByRole('region', { name: 'YouTube-Schreibpilot' }),
  ).toBeVisible();
  await expect(
    page.getByText('Pilotlimit: 1 Entscheidung pro Freigabe.'),
  ).toBeVisible();
  await expect(
    page.getByText('Exportbestätigung für aktuellen Snapshot fehlt.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'YouTube-Arbeitstab öffnen und Auswahl ausführen',
    }),
  ).toBeDisabled();
  for (const checkbox of await page
    .getByRole('checkbox', { name: /^Auswählen:/ })
    .all()) {
    await expect(checkbox).not.toBeChecked();
  }
});
test('cleanup is separate, confirmed locally, unknown videos excluded', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Nicht verfügbare Videos' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Auswahl prüfen (1)' }).click();
  await expect(
    page.getByText('1 Entfernungen lokal vormerken?', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Auswahl lokal vormerken' }).click();
  await expect(page.getByText('1 Änderungen vorgemerkt.')).toBeVisible();
});
test('mouse drag and backup export', async ({ page, browserName }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Runde starten' }).click();
  await page.screenshot({
    path: `artifacts/fixture-ui-${browserName}.png`,
    fullPage: true,
    animations: 'disabled',
  });
  const card = page.locator('.video-card');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole('heading', { name: 'Fixture Video 2' }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '↗ Backup' }).click();
  expect((await download).suggestedFilename()).toContain('latersift-backup-');
});
test('mobile layout fits and dialog traps focus', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.getByRole('button', { name: 'Runde starten' }).click();
  await page.screenshot({
    path: `artifacts/fixture-mobile-${browserName}.png`,
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('header nav').evaluate((nav) => {
    (nav as HTMLElement).style.fontSize = '18px';
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const button of await page.locator('header nav button').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button', { name: 'Runde anpassen' }).click();
  await page.getByRole('button', { name: 'Archivziel hinterlegen' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Ziel lokal speichern' }).focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Dialog schließen' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

// UI transport fixtures only; real DOM/content/bridge coverage lives in write-flow.test.ts.
async function fakeDiscovery(page: Page, fail = false, denyCopy = false) {
  await page.addInitScript(
    ({ fail, denyCopy }) => {
      const id = 'synthetic-ui@latersift';
      let url = '';
      const choices = Array.from({ length: 16 }, (_, i) => ({
        id: null,
        title: i < 2 ? 'Same playlist name' : `Fixture playlist ${i}`,
        checked: i === 2 ? null : i % 2 === 0,
        identity: 'unverified',
        variant: 'sheet',
        writable: false,
        diagnostic:
          'Keine belegte Playlist-ID: Namen und Auswahlzustand reichen nicht aus.',
      }));
      const diagnostic = {
        schemaVersion: 1,
        variant: fail ? 'unsupported' : 'sheet',
        playlistRows: 16,
        selectionStates: { valid: 14, unknown: 1, contradictory: 1 },
        provenPlaylistIds: 0,
        unidentifiedRows: 16,
        publicAttributeNames: [
          'aria-pressed',
          'data-playlist-id',
          'data-private-name',
        ],
        failureReason: fail ? 'unsupported-structure' : null,
        rows: Array.from({ length: 16 }, (_, i) => ({
          index: i + 1,
          uiState: i === 0 ? 'unknown' : i === 1 ? 'contradictory' : 'valid',
          identity: 'unverified',
          unsupportedReasons: ['sheet-readonly', 'unproven-identity'],
        })),
        privateText: 'PRIVATE_WIRE_TEXT',
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (denyCopy) throw new Error('denied');
            Object.assign(globalThis, { copiedDiagnostic: text });
          },
        },
      });
      const api = {
        runtime: { id, getManifest: () => ({ version: '9.8.7' }) },
        tabs: {
          create: async (options: { url: string }) => {
            url = options.url;
            return { id: 123 };
          },
          get: async () => ({
            id: 123,
            windowId: 456,
            active: true,
            status: 'complete',
            url,
          }),
          connect: () => {
            let reply: (message: unknown) => void;
            return {
              onMessage: {
                addListener: (listener: typeof reply) => {
                  reply = listener;
                },
              },
              onDisconnect: { addListener: () => {} },
              disconnect: () => {},
              postMessage: (request: { method: string }) => {
                if (request.method !== 'playlists')
                  throw new Error('Fixture forbids writes');
                queueMicrotask(() =>
                  reply(
                    fail
                      ? { ok: false, error: 'PRIVATE_ERROR_NAME', diagnostic }
                      : { ok: true, result: choices, diagnostic },
                  ),
                );
              },
            };
          },
        },
        windows: { get: async () => ({ focused: true }) },
      };
      Object.assign(globalThis, { chrome: api, browser: api });
    },
    { fail, denyCopy },
  );
}

async function fakePlaylistFeed(
  page: Page,
  batches:
    | (Pick<PlaylistEntry, 'id' | 'name'> & Partial<PlaylistEntry>)[][]
    | null = null,
  navigation:
    'delayed' | 'marker-stripped' | 'redirect' | 'consent' | null = null,
  fixture: Partial<PlaylistCatalog> | Record<string, unknown> = {},
) {
  await page.addInitScript(
    ({ batches, navigation, fixture }) => {
      let refreshIndex = 0;
      const tabReads: string[] = [];
      Object.assign(globalThis, {
        playlistTabReads: tabReads,
        playlistTabReady: false,
      });
      const key = 'latersift-playlist-catalog-v1';
      const catalog = {
        entries: [
          {
            id: 'PLfixtureFeed123456',
            name: 'Fixture feed archive',
            url: 'https://www.youtube.com/playlist?list=PLfixtureFeed123456',
            visibility: 'private',
            ownership: 'unknown',
          },
          {
            id: 'WL',
            name: 'Fixture Watch Later',
            url: 'https://www.youtube.com/playlist?list=WL',
            visibility: 'unknown',
            ownership: 'unknown',
          },
        ],
        status: 'partial',
        updatedAt: '2026-10-18T00:00:00Z',
        message: 'Fixture feed: Vollständigkeit bleibt offen.',
        diagnostics: {
          reason: 'feed_exhausted',
          rounds: 2,
          scrollAttempts: 1,
          observedScrolls: 1,
          scroll: null,
          continuation: false,
          continuationSeen: false,
          unsupportedCards: 0,
          expectedCount: null,
          completenessVerified: false,
        },
      };
      const transport = {
        created: [] as { url: string; active: boolean }[],
        connections: [] as { tabId: number; name: string }[],
        requests: [] as unknown[],
        acknowledgedAfterSave: false,
        disconnected: false,
        removed: [] as number[],
      };
      let url = '';
      const api = {
        runtime: { id: 'synthetic-feed@latersift' },
        tabs: {
          create: async (options: { url: string; active: boolean }) => {
            transport.created.push(options);
            url = options.url;
            return { id: 321 };
          },
          get: async () => {
            if (navigation === 'delayed') {
              const index = tabReads.length;
              if (index < 2) {
                tabReads.push('about:blank');
                return {
                  id: 321,
                  url: 'about:blank',
                  active: false,
                  status: 'loading',
                };
              }
              if (index < 4) {
                tabReads.push('missing-url');
                return { id: 321, active: false, status: 'loading' };
              }
              if (!Reflect.get(globalThis, 'playlistTabReady')) {
                tabReads.push('target-loading');
                return { id: 321, url, active: false, status: 'loading' };
              }
            }
            const actualUrl =
              navigation === 'marker-stripped'
                ? url.split('#')[0]
                : navigation === 'redirect'
                  ? 'https://www.youtube.com/feed/library?private_query=QUERY_SECRET#private_hash=HASH_SECRET'
                  : navigation === 'consent'
                    ? 'https://consent.youtube.com/m?continue=QUERY_SECRET#private_hash=HASH_SECRET'
                    : url;
            tabReads.push('complete');
            return {
              id: 321,
              url: actualUrl,
              active: false,
              status: 'complete',
            };
          },
          remove: async (tabId: number) => {
            transport.removed.push(tabId);
          },
          connect: (tabId: number, options: { name: string }) => {
            transport.connections.push({ tabId, name: options.name });
            const checkpoint = {
              ...catalog,
              entries: batches
                ? (batches[refreshIndex++] ?? []).map((entry) => ({
                    ...entry,
                    url: `https://www.youtube.com/playlist?list=${entry.id}`,
                    visibility: 'unknown',
                    ownership: 'unknown',
                  }))
                : catalog.entries,
              ...fixture,
            };
            let reply: (message: unknown) => void;
            return {
              onMessage: {
                addListener: (listener: typeof reply) => {
                  reply = listener;
                },
              },
              onDisconnect: { addListener: () => {} },
              disconnect: () => {
                transport.disconnected = true;
              },
              postMessage: (request: { type?: string; ack?: number }) => {
                transport.requests.push(request);
                if (request.type === 'playlists') {
                  queueMicrotask(() =>
                    reply({ type: 'checkpoint', id: 1, scan: checkpoint }),
                  );
                } else if (request.ack === 1) {
                  transport.acknowledgedAfterSave =
                    localStorage.getItem(key) === JSON.stringify(checkpoint);
                  queueMicrotask(() => reply({ type: 'done' }));
                } else {
                  throw new Error(
                    'Fixture forbids writes and unexpected read requests',
                  );
                }
              },
            };
          },
        },
      };
      Object.assign(globalThis, {
        chrome: api,
        browser: api,
        playlistTransport: transport,
      });
    },
    { batches, navigation, fixture },
  );
}

function rejectedPlaylistFeed(): PlaylistCatalog {
  const reasons = {
    no_playlist_link: 2,
    conflicting_playlist_ids: 1,
    missing_title_node: 1,
    conflicting_titles: 0,
    ambiguous_title_link: 0,
    hidden_card: 0,
    incomplete_rendering: 0,
  };
  return {
    entries: [],
    status: 'failed',
    updatedAt: '2026-10-18T00:00:00Z',
    message: 'Vier Karten erkannt, keine Playlist sicher identifiziert.',
    diagnostics: {
      reason: 'unsupported_dom',
      rounds: 5,
      scrollAttempts: 4,
      observedScrolls: 0,
      scroll: { container: 'document', top: 0, height: 1258, viewport: 1258 },
      continuation: false,
      continuationSeen: false,
      unsupportedCards: 4,
      expectedCount: null,
      completenessVerified: false,
      parser: {
        latest: { ...reasons },
        peaks: { ...reasons },
        sources: { 'yt-lockup-view-model': 4 },
        samplesTruncated: false,
        samples: [
          ['no_playlist_link'],
          ['no_playlist_link'],
          ['conflicting_playlist_ids'],
          ['missing_title_node'],
        ].map((reasons, index) => ({
          index,
          tag: 'yt-lockup-view-model',
          reasons: reasons as NonNullable<
            PlaylistCatalog['diagnostics']['parser']
          >['samples'][number]['reasons'],
          titleNodes: {
            playlistTitle: 0,
            videoTitle: 0,
            lockupTitle: index === 3 ? 0 : 1,
          },
          childTags: { a: 1, h3: 1 },
          links: {
            playlist: index < 2 ? 0 : index === 2 ? 2 : 1,
            watch: index < 2 ? 1 : 0,
            channel: 0,
            external: 0,
            other: 0,
            invalid: 0,
            missing: 0,
          },
          distinctValidIds: index < 2 ? 0 : index === 2 ? 2 : 1,
        })),
      },
      cardCount: {
        initial: 4,
        latest: 4,
        max: 4,
        changes: [{ round: 1, total: 4, accepted: 0, rejected: 4, hidden: 0 }],
      },
      scrollAvailability: 'not_scrollable',
      loadingEvidence: {
        cardGrowths: 0,
        heightGrowths: 0,
        continuationRounds: 0,
        continuationAppearances: 0,
      },
      pagination: { nextAnchors: 0, nextButtons: 0 },
      scrollContainers: {
        inspectedElements: 18,
        truncated: false,
        containers: [
          {
            tag: 'document',
            top: 0,
            height: 1258,
            viewport: 1258,
            selected: true,
            scrollable: false,
          },
        ],
      },
    },
  };
}

function unnamedPlaylist(id: string): PlaylistEntry {
  return {
    id,
    name: null,
    nameStatus: 'unknown',
    nameSource: 'unknown',
    identityEvidence: 'playlist-url',
    writability: 'unknown',
    url: `https://www.youtube.com/playlist?list=${id}`,
    visibility: 'unknown',
    ownership: 'unknown',
  };
}

function unnamedPlaylistFeed(): PlaylistCatalog {
  const fixture = rejectedPlaylistFeed();
  fixture.entries = Array.from({ length: 18 }, (_, index) =>
    unnamedPlaylist(`PLunnamedFixture${index}`),
  );
  fixture.status = 'partial';
  fixture.message = '18 Playlist-IDs belegt; Namen und Vollständigkeit offen.';
  const diagnostics = fixture.diagnostics;
  diagnostics.reason = 'stable_unverified_end';
  diagnostics.unsupportedCards = 0;
  const parser = diagnostics.parser!;
  parser.latest = {
    no_playlist_link: 0,
    conflicting_playlist_ids: 0,
    missing_title_node: 18,
    conflicting_titles: 0,
    ambiguous_title_link: 0,
    hidden_card: 0,
    incomplete_rendering: 0,
  };
  parser.peaks = { ...parser.latest };
  parser.identifiedUnnamed = { latest: 18, peak: 18 };
  parser.sources = { 'yt-lockup-view-model': 18 };
  parser.samplesTruncated = true;
  parser.samples = Array.from({ length: 12 }, (_, index) => ({
    index,
    tag: 'yt-lockup-view-model',
    reasons: ['missing_title_node'],
    titleNodes: { playlistTitle: 0, videoTitle: 0, lockupTitle: 0 },
    childTags: { a: 3 },
    links: {
      playlist: 1,
      watch: 2,
      channel: 0,
      external: 0,
      other: 0,
      invalid: 0,
      missing: 0,
    },
    distinctValidIds: 1,
    titleStructure: {
      canonicalLinkCount: 1,
      linkHeadings: 0,
      metadataHeadings: 0,
      ariaLabelledbyLinks: 0,
      localHeadingReferences: 0,
      missingOrAmbiguousReferences: 0,
      watchLinkedHeadings: 0,
      canonicalLinkHasAriaLabel: 0,
      watchLinksMatchingPlaylist: 2,
      watchLinksMissingPlaylist: 0,
      watchLinksConflictingPlaylist: 0,
      watchLinksUnresolvedPlaylist: 0,
      headingsWithMatchingWatchPlaylist: 0,
      ambiguousHeadings: 0,
      watchHeadingContainsLink: 0,
      watchLinkContainsHeading: 0,
      watchHeadingsInLockupMetadata: 0,
      watchHeadingsWithCanonicalLinkInMetadata: 0,
      watchHeadingsWithCanonicalLinkOutsideMetadata: 0,
    },
  }));
  // Transport fixture only: actual 0 -> 4 -> 18 DOM growth is covered by unit tests.
  diagnostics.cardCount = {
    initial: 0,
    latest: 18,
    max: 18,
    changes: [
      { round: 1, total: 0, accepted: 0, rejected: 0, hidden: 0 },
      { round: 2, total: 4, accepted: 4, rejected: 0, hidden: 0 },
      { round: 3, total: 18, accepted: 18, rejected: 0, hidden: 0 },
    ],
  };
  return fixture;
}

test('0.2.8 shows 18 unconfirmed candidates with IDs collapsed, persists them and keeps gates closed', async ({
  page,
}) => {
  await seed(page);
  const fixture = unnamedPlaylistFeed();
  fixture.entries = fixture.entries.map((entry, index) => ({
    ...entry,
    candidateName: `Fixture candidate ${index + 1}`,
    candidateSource: 'lockup-watch-heading' as const,
  }));
  await fakePlaylistFeed(page, null, null, fixture);
  let panel = await openPlaylistFeed(page);
  for (let pass = 0; pass < 2; pass++) {
    if (pass) {
      await page.reload();
      await page
        .getByRole('button', { name: 'Playlists', exact: true })
        .click();
      panel = page.getByRole('region', { name: 'Playlist-Katalog' });
    }
    const rows = panel
      .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
      .getByRole('listitem');
    await expect(rows).toHaveCount(18);
    for (const [index, entry] of fixture.entries.entries()) {
      const row = rows.nth(index);
      await expect(row.locator('strong')).toHaveText(
        `Fixture candidate ${index + 1}`,
      );
      await expect(row).toContainText(
        'Name: aus Playlist-Karte abgeleitet, noch nicht unabhängig bestätigt',
      );
      await expect(row).toContainText(
        'ID: nachgewiesen · Schreibbarkeit: nicht bestätigt',
      );
      await expect(row.locator('code')).not.toBeVisible();
      await row.getByText('Playlist-Details', { exact: true }).click();
      await expect(row.locator('code')).toBeVisible();
      await expect(row.locator('code')).toHaveText(entry.id);
      await expect(row).toContainText('Eigentümer: unbekannt');
    }
    await expect(
      panel.getByText('Name: bestätigt', { exact: true }),
    ).toHaveCount(0);
  }
  const { text } = await readPlaylistFeedDiagnostic(page);
  expect(text).not.toContain('Fixture candidate');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('latersift-playlist-catalog-v1')!),
    ),
  ).toEqual(fixture);
  const before = await page.evaluate(() =>
    Reflect.get(globalThis, 'playlistTransport'),
  );
  await panel
    .getByRole('button', { name: 'Als lokales Archivziel wählen' })
    .first()
    .click();
  expect(
    await page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
  ).toEqual(before);
});

test('0.2.6 all 18 unnamed URL-backed playlists remain usable locally and persist null names', async ({
  page,
}) => {
  await seed(page);
  const fixture = unnamedPlaylistFeed();
  await fakePlaylistFeed(page, null, null, fixture);
  const panel = await openPlaylistFeed(page);
  const rows = panel
    .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
    .getByRole('listitem');
  await expect(panel.getByRole('status')).toContainText(
    '18 Playlists · Teilbestand / Vollständigkeit offen',
  );
  await expect(panel.getByRole('status')).not.toContainText('unsupported_dom');
  const expectUnnamed = async () => {
    await expect(rows).toHaveCount(18);
    await expect(rows.locator('strong')).toHaveText(
      Array(18).fill('Playlist ohne bestätigten Namen'),
    );
    for (const [index, entry] of fixture.entries.entries()) {
      await expect(rows.nth(index)).toContainText('Name: unbekannt');
      await expect(rows.nth(index)).toContainText(
        `ID aus URL: ${entry.id} (nachgewiesen)`,
      );
      await expect(rows.nth(index).locator('code')).toHaveText(entry.id);
      await expect(rows.nth(index)).toContainText(
        'Schreibbarkeit: nicht bestätigt',
      );
    }
    await expect(
      panel.getByText('Name: bestätigt', { exact: false }),
    ).toHaveCount(0);
  };
  await expectUnnamed();
  const { text } = await readPlaylistFeedDiagnostic(page);
  const report = JSON.parse(text);
  expect(report.parser.identifiedUnnamed).toEqual({ latest: 18, peak: 18 });
  expect(report.parser.latest.missing_title_node).toBe(18);
  expect(report.parser.peaks).toEqual(report.parser.latest);
  expect(report.unsupportedCards).toBe(0);
  expect(report.cardCount).toEqual(fixture.diagnostics.cardCount);
  expect(report.parser.samples).toEqual(fixture.diagnostics.parser!.samples);
  expect(report.parser.samplesTruncated).toBe(true);
  expect(
    report.parser.samples.every(
      (sample: { links: { watch: number }; distinctValidIds: number }) =>
        sample.links.watch === 2 && sample.distinctValidIds === 1,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(globalThis, 'playlistTransport').disconnected,
      ),
    )
    .toBe(true);
  const before = await page.evaluate(() =>
    Reflect.get(globalThis, 'playlistTransport'),
  );
  await rows
    .nth(17)
    .getByRole('button', { name: 'Als lokales Archivziel wählen' })
    .click();
  await expect(page.getByLabel('YouTube-Playlist-URL oder PL…-ID')).toHaveValue(
    fixture.entries[17].id,
  );
  expect(
    await page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
  ).toEqual(before);
  expect(before.requests).toEqual([{ type: 'playlists' }, { ack: 1 }]);
  expect(before.acknowledgedAfterSave).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('latersift-playlist-catalog-v1')!),
    ),
  ).toEqual(fixture);
  await page.reload();
  await page.getByRole('button', { name: 'Playlists', exact: true }).click();
  await expectUnnamed();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('latersift-playlist-catalog-v1')!),
    ),
  ).toEqual(fixture);
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, 'playlistTransport').created,
    ),
  ).toEqual([]);
});

test('0.2.6 mixed naming evidence and equal names keep distinct playlist IDs', async ({
  page,
}) => {
  await seed(page);
  const fixture = unnamedPlaylistFeed();
  fixture.entries = [
    {
      ...unnamedPlaylist('PLsameNameA'),
      name: 'Same archive',
      nameStatus: 'confirmed',
      nameSource: 'playlist-heading',
    },
    unnamedPlaylist('PLunknownName'),
    {
      ...unnamedPlaylist('PLsameNameB'),
      name: 'Same archive',
      nameStatus: 'confirmed',
      nameSource: 'aria-labelledby',
    },
    {
      ...unnamedPlaylist('PLuntrustedName'),
      name: 'Must not be displayed',
      nameStatus: 'unknown',
    },
  ];
  await fakePlaylistFeed(page, null, null, fixture);
  const panel = await openPlaylistFeed(page);
  const rows = panel
    .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
    .getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('strong')).toHaveText([
    'Same archive',
    'Playlist ohne bestätigten Namen',
    'Same archive',
    'Playlist ohne bestätigten Namen',
  ]);
  for (const [index, entry] of fixture.entries.entries()) {
    await expect(rows.nth(index).locator('code')).toHaveText(entry.id);
    await expect(rows.nth(index)).toContainText(
      index % 2 === 0 ? 'Name: bestätigt' : 'Name: unbekannt',
    );
    await expect(rows.nth(index)).toContainText(
      'Schreibbarkeit: nicht bestätigt',
    );
  }
  await expect(panel).not.toContainText('Must not be displayed');
  for (const index of [0, 2]) {
    await rows
      .nth(index)
      .getByRole('button', { name: 'Als lokales Archivziel wählen' })
      .click();
    await expect(
      page.getByLabel('YouTube-Playlist-URL oder PL…-ID'),
    ).toHaveValue(fixture.entries[index].id);
  }
});

test('0.2.6 legacy names stay historical after unknown refreshes and reload', async ({
  page,
}) => {
  await seed(page);
  const legacy = {
    ...unnamedPlaylist('PLhistoryName'),
    name: 'Legacy preserved archive',
  };
  delete legacy.nameStatus;
  delete legacy.nameSource;
  const fixture = unnamedPlaylistFeed();
  fixture.entries = [legacy];
  await page.evaluate(
    (catalog) =>
      localStorage.setItem(
        'latersift-playlist-catalog-v1',
        JSON.stringify(catalog),
      ),
    fixture,
  );
  await fakePlaylistFeed(page, [
    [unnamedPlaylist(legacy.id)],
    [unnamedPlaylist(legacy.id)],
    [unnamedPlaylist('PLnewCurrent')],
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'Playlists', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Playlist-Katalog' });
  const current = panel
    .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
    .getByRole('listitem');
  await expect(current.locator('strong')).toHaveText(legacy.name);
  await expect(current).toContainText('Name: gespeichert (älterer Katalog)');
  await expect(current).not.toContainText('Name: bestätigt');
  const refresh = panel.getByRole('button', {
    name: 'Playlists aktualisieren',
    exact: true,
  });
  for (let round = 0; round < 2; round++) {
    await refresh.click();
    await expect(current.locator('strong')).toHaveText(
      'Playlist ohne bestätigten Namen',
    );
    await expect(current).toContainText('Name: unbekannt');
    await expect(refresh).toBeEnabled();
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem('latersift-playlist-catalog-v1-previous')!,
        ),
      ),
    ).toEqual([legacy]);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('latersift-playlist-catalog-v1')!)
            .entries[0].name,
      ),
    ).toBeNull();
  }
  await refresh.click();
  await expect(current.locator('code')).toHaveText('PLnewCurrent');
  await expect(refresh).toBeEnabled();
  for (let reload = 0; reload < 2; reload++) {
    const summary = panel.getByText(
      'Vorheriger Katalog (veraltet, vor dieser Aktualisierung)',
      { exact: true },
    );
    await summary.click();
    const stale = panel
      .locator('details')
      .filter({
        has: page.getByText(
          'Vorheriger Katalog (veraltet, vor dieser Aktualisierung)',
          { exact: true },
        ),
      })
      .getByRole('listitem');
    await expect(stale).toHaveText(
      `${legacy.name} · ${legacy.id} · Name: gespeichert (älterer Katalog) · Schreibbarkeit: nicht bestätigt`,
    );
    await expect(stale.getByRole('button')).toHaveCount(0);
    await expect(panel).not.toContainText('Name: bestätigt');
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem('latersift-playlist-catalog-v1-previous')!,
        ),
      ),
    ).toEqual([legacy]);
    await page.reload();
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
  }
});

async function readPlaylistFeedDiagnostic(page: Page) {
  const panel = page.getByRole('region', { name: 'Playlist-Katalog' });
  const textarea = panel.getByRole('textbox', {
    name: 'Bereinigte Playlist-Feed-Diagnose',
  });
  await expect(textarea).not.toBeVisible();
  await panel
    .getByText('Technische Playlist-Diagnose', { exact: true })
    .click();
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveAttribute('readonly', '');
  return { panel, textarea, text: await textarea.inputValue() };
}

test('0.2.4 four rejected cards report unsupported DOM independently of ready work-tab navigation', async ({
  page,
}) => {
  await seed(page);
  const fixture = rejectedPlaylistFeed();
  await fakePlaylistFeed(page, null, null, fixture);
  const panel = await openPlaylistFeed(page);
  await expect(panel.getByRole('status')).toContainText(
    '0 Playlists · Nicht unterstützte Playlist-Struktur (unsupported_dom)',
  );
  await expect(panel.getByRole('status')).not.toContainText('Teilbestand');
  await expect(
    panel
      .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
      .getByRole('listitem'),
  ).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: 'Playlists aktualisieren', exact: true }),
  ).toBeEnabled();
  const navigation = await readWorkTabDiagnostics(page);
  expect(navigation.at(-1)).toMatchObject({
    phase: 'target-ready',
    reason: 'ready',
    marker: 'matching',
  });
  const { text } = await readPlaylistFeedDiagnostic(page);
  const report = JSON.parse(text);
  expect(report.reason).toBe('unsupported_dom');
  // Latest and peaks are per-round snapshots, not four cards times five rounds.
  expect(report.parser.latest).toEqual({
    no_playlist_link: 2,
    conflicting_playlist_ids: 1,
    missing_title_node: 1,
    conflicting_titles: 0,
    ambiguous_title_link: 0,
    hidden_card: 0,
    incomplete_rendering: 0,
  });
  expect(report.parser.peaks).toEqual(report.parser.latest);
  expect(report.parser.samples).toEqual(fixture.diagnostics.parser!.samples);
  expect(report.parser.sources).toEqual({ 'yt-lockup-view-model': 4 });
  expect(report.cardCount).toEqual({
    initial: 4,
    latest: 4,
    max: 4,
    changes: [{ round: 1, total: 4, accepted: 0, rejected: 4, hidden: 0 }],
  });
  expect(report).toMatchObject({
    rounds: 5,
    scrollAttempts: 4,
    observedScrolls: 0,
    scroll: { container: 'document', top: 0, height: 1258, viewport: 1258 },
    scrollAvailability: 'not_scrollable',
    unsupportedCards: 4,
    loadingEvidence: {
      cardGrowths: 0,
      heightGrowths: 0,
      continuationRounds: 0,
      continuationAppearances: 0,
    },
  });
  expect(report.scrollContainers).toEqual(fixture.diagnostics.scrollContainers);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('latersift-playlist-catalog-v1')!),
    ),
  ).toEqual(fixture);
});

test('missing playlist card containers have a distinct failure status', async ({
  page,
}) => {
  await seed(page);
  const fixture = rejectedPlaylistFeed();
  fixture.diagnostics.reason = 'no_card_containers';
  fixture.diagnostics.unsupportedCards = 0;
  fixture.diagnostics.parser = {
    latest: {
      no_playlist_link: 0,
      conflicting_playlist_ids: 0,
      missing_title_node: 0,
      conflicting_titles: 0,
      ambiguous_title_link: 0,
      hidden_card: 0,
      incomplete_rendering: 0,
    },
    peaks: {
      no_playlist_link: 0,
      conflicting_playlist_ids: 0,
      missing_title_node: 0,
      conflicting_titles: 0,
      ambiguous_title_link: 0,
      hidden_card: 0,
      incomplete_rendering: 0,
    },
    sources: {},
    samples: [],
    samplesTruncated: false,
  };
  fixture.diagnostics.cardCount = {
    initial: 0,
    latest: 0,
    max: 0,
    changes: [{ round: 1, total: 0, accepted: 0, rejected: 0, hidden: 0 }],
  };
  await fakePlaylistFeed(page, null, null, fixture);
  const panel = await openPlaylistFeed(page);
  await expect(panel.getByRole('status')).toContainText(
    'Keine unterstützten Kartencontainer (no_card_containers)',
  );
  await expect(panel.getByRole('status')).not.toContainText('unsupported_dom');
  await expect(panel.getByRole('status')).not.toContainText('Teilbestand');
  const { text } = await readPlaylistFeedDiagnostic(page);
  expect(JSON.parse(text)).toMatchObject({
    reason: 'no_card_containers',
    unsupportedCards: 0,
    cardCount: { latest: 0 },
    parser: { samples: [], sources: {} },
  });
});

for (const clipboard of ['success', 'denied', 'unavailable'] as const) {
  test(`playlist feed diagnostic is sanitized and copy handles clipboard ${clipboard}`, async ({
    page,
  }) => {
    await seed(page);
    const fixture = rejectedPlaylistFeed();
    const privateText =
      'PRIVATE_NAME PLprivateDiagnostic123 https://private.example/playlist?list=SECRET <script>PRIVATE_SCRIPT</script>';
    const diagnostics = fixture.diagnostics;
    await fakePlaylistFeed(page, null, null, {
      ...fixture,
      diagnostics: {
        ...diagnostics,
        name: privateText,
        id: privateText,
        url: privateText,
        raw: { privateText },
        rawErrors: [privateText],
        checkpointError: privateText,
        scroll: {
          ...diagnostics.scroll,
          container: privateText,
          raw: privateText,
        },
        parser: {
          ...diagnostics.parser,
          raw: privateText,
          latest: { ...diagnostics.parser!.latest, [privateText]: 99 },
          sources: { 'yt-lockup-view-model': 4, [privateText]: 99 },
          samples: diagnostics.parser!.samples.map((sample) => ({
            ...sample,
            name: privateText,
            id: privateText,
            url: privateText,
            rawErrors: [privateText],
            tag: privateText,
            childTags: { a: 1, [privateText]: 99 },
            reasons: [...sample.reasons, privateText],
            links: { ...sample.links, [privateText]: 99 },
            titleStructure: {
              canonicalLinkCount: 1,
              linkHeadings: 0,
              metadataHeadings: 1,
              ariaLabelledbyLinks: 0,
              localHeadingReferences: 0,
              missingOrAmbiguousReferences: 0,
              watchLinkedHeadings: 2,
              canonicalLinkHasAriaLabel: 0,
              watchLinksMatchingPlaylist: 2,
              watchLinksMissingPlaylist: privateText,
              watchLinksConflictingPlaylist: 1,
              watchLinksUnresolvedPlaylist: { raw: privateText },
              headingsWithMatchingWatchPlaylist: 1,
              ambiguousHeadings: 2,
              watchHeadingContainsLink: 2,
              watchLinkContainsHeading: 0,
              watchHeadingsInLockupMetadata: 2,
              watchHeadingsWithCanonicalLinkInMetadata: 0,
              watchHeadingsWithCanonicalLinkOutsideMetadata: 2,
              name: privateText,
              id: privateText,
              url: privateText,
              ariaLabel: privateText,
              headingText: privateText,
              [privateText]: 99,
            },
          })),
        },
        scrollContainers: {
          ...diagnostics.scrollContainers,
          containers: [
            {
              tag: privateText,
              top: 0,
              height: 1258,
              viewport: 1258,
              selected: true,
              scrollable: false,
              raw: privateText,
            },
          ],
        },
      },
    });
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value:
          mode === 'unavailable'
            ? undefined
            : {
                writeText: async (text: string) => {
                  Object.assign(globalThis, { attemptedPlaylistCopy: text });
                  if (mode === 'denied')
                    throw new DOMException(
                      'PRIVATE_CLIPBOARD_ERROR',
                      'NotAllowedError',
                    );
                  Object.assign(globalThis, { copiedPlaylistDiagnostic: text });
                },
              },
      });
    }, clipboard);
    await openPlaylistFeed(page);
    const { panel, textarea, text } = await readPlaylistFeedDiagnostic(page);
    expect(text).not.toMatch(
      /PRIVATE_|PLprivate|https?:|private\.example|SECRET|<script>|rawErrors|"raw"|"name"|"id"|"url"/,
    );
    const report = JSON.parse(text);
    expect(report.checkpointError).toBe('checkpoint_failed');
    expect(report.scroll.container).toBe('other');
    expect(report.parser.latest).toEqual(diagnostics.parser!.latest);
    expect(report.parser.sources).toEqual({ 'yt-lockup-view-model': 4 });
    expect(report.parser.samples).toEqual(
      diagnostics.parser!.samples.map((sample) => ({
        ...sample,
        tag: 'other',
        childTags: { a: 1 },
        reasons: [...sample.reasons, 'unknown'],
        titleStructure: {
          canonicalLinkCount: 1,
          linkHeadings: 0,
          metadataHeadings: 1,
          ariaLabelledbyLinks: 0,
          localHeadingReferences: 0,
          missingOrAmbiguousReferences: 0,
          watchLinkedHeadings: 2,
          canonicalLinkHasAriaLabel: 0,
          watchLinksMatchingPlaylist: 2,
          watchLinksMissingPlaylist: 0,
          watchLinksConflictingPlaylist: 1,
          watchLinksUnresolvedPlaylist: 0,
          headingsWithMatchingWatchPlaylist: 1,
          ambiguousHeadings: 2,
          watchHeadingContainsLink: 2,
          watchLinkContainsHeading: 0,
          watchHeadingsInLockupMetadata: 2,
          watchHeadingsWithCanonicalLinkInMetadata: 0,
          watchHeadingsWithCanonicalLinkOutsideMetadata: 2,
        },
      })),
    );
    expect(report.scrollContainers.containers).toEqual([
      {
        tag: 'other',
        top: 0,
        height: 1258,
        viewport: 1258,
        selected: true,
        scrollable: false,
      },
    ]);
    await panel
      .getByRole('button', { name: 'Playlist-Diagnose kopieren', exact: true })
      .click();
    await expect(
      panel.getByRole('status').filter({
        hasText:
          clipboard === 'success'
            ? 'Bereinigte Playlist-Diagnose kopiert.'
            : 'Diagnose markieren und manuell kopieren',
      }),
    ).toBeVisible();
    if (clipboard !== 'unavailable')
      expect(
        await page.evaluate(() =>
          Reflect.get(globalThis, 'attemptedPlaylistCopy'),
        ),
      ).toBe(text);
    expect(
      await page.evaluate(() =>
        Reflect.get(globalThis, 'copiedPlaylistDiagnostic'),
      ),
    ).toBe(clipboard === 'success' ? text : undefined);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(text);
    await textarea.selectText();
    expect(
      await textarea.evaluate((element: HTMLTextAreaElement) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
    ).toBe(text);
    await expect(panel).not.toContainText('PRIVATE_CLIPBOARD_ERROR');
  });
}

test('0.2.4 legacy playlist catalog and stale entries survive reload without optional diagnostics', async ({
  page,
}) => {
  await seed(page);
  const entry = {
    id: 'PLlegacyArchive123',
    name: '<img src=x onerror="window.legacyInjected=true"> Legacy archive',
    url: 'https://www.youtube.com/playlist?list=PLlegacyArchive123',
    visibility: 'private',
    ownership: 'unknown',
  };
  const stale = [
    { ...entry, id: 'PLlegacyStale123', name: 'Legacy stale archive' },
  ];
  const legacy = {
    entries: [entry],
    status: 'partial',
    updatedAt: '2026-10-17T00:00:00Z',
    message: 'Gesicherter 0.2.4-Teilbestand.',
    diagnostics: {
      reason: 'stable_unverified_end',
      rounds: 2,
      scrollAttempts: 1,
      observedScrolls: 0,
      scroll: null,
      continuation: false,
      continuationSeen: false,
      unsupportedCards: 0,
      expectedCount: null,
      completenessVerified: false,
    },
  };
  await page.evaluate(
    ({ legacy, stale }) => {
      localStorage.setItem(
        'latersift-playlist-catalog-v1',
        JSON.stringify(legacy),
      );
      localStorage.setItem(
        'latersift-playlist-catalog-v1-previous',
        JSON.stringify(stale),
      );
    },
    { legacy, stale },
  );
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Playlist-Katalog' });
    await expect(panel.getByRole('status')).toContainText(
      '1 Playlists · Teilbestand / Vollständigkeit offen',
    );
    await expect(
      panel
        .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
        .getByRole('listitem'),
    ).toContainText(entry.name);
    await expect(panel.locator('img')).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, 'legacyInjected')),
    ).toBeUndefined();
    await panel
      .getByText('Vorheriger Katalog (veraltet, vor dieser Aktualisierung)', {
        exact: true,
      })
      .click();
    await expect(
      panel.getByText(
        'Legacy stale archive · PLlegacyStale123 · Name: gespeichert (älterer Katalog) · Schreibbarkeit: nicht bestätigt',
        { exact: true },
      ),
    ).toBeVisible();
    const { text } = await readPlaylistFeedDiagnostic(page);
    expect(JSON.parse(text)).toEqual(legacy.diagnostics);
    expect(text).not.toMatch(/PLlegacy|Legacy archive|youtube|onerror/);
    expect(
      await page.evaluate(() => ({
        catalog: JSON.parse(
          localStorage.getItem('latersift-playlist-catalog-v1')!,
        ),
        previous: JSON.parse(
          localStorage.getItem('latersift-playlist-catalog-v1-previous')!,
        ),
      })),
    ).toEqual({ catalog: legacy, previous: stale });
  }
});

test('playlist feed uses an inactive read-only work tab and persists checkpoints before acknowledging', async ({
  page,
}) => {
  await seed(page);
  await fakePlaylistFeed(page);
  await page.reload();
  await page.getByRole('button', { name: 'Runde starten' }).click();
  const openArchive = async () => {
    await page.getByRole('button', { name: 'Runde anpassen' }).click();
    await page.getByRole('button', { name: 'Archivziel hinterlegen' }).click();
  };
  await openArchive();
  const panel = page.getByRole('region', { name: 'Playlist-Katalog' });
  await expect(
    panel.getByText(/Read-only im inaktiven Arbeitstab/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Playlists aus YouTube laden (Save-Dialog, Vordergrund)',
      exact: true,
    }),
  ).not.toBeVisible();
  await panel
    .getByRole('button', { name: 'Playlists aktualisieren', exact: true })
    .click();
  await expect(panel.getByRole('status')).toContainText(
    '2 Playlists · Teilbestand / Vollständigkeit offen',
  );
  await expect(
    panel.getByRole('button', { name: 'Playlists aktualisieren', exact: true }),
  ).toBeEnabled();
  const list = panel.getByRole('list', { name: 'Verifizierte Playlist-IDs' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  const archive = list
    .getByRole('listitem')
    .filter({ hasText: 'Fixture feed archive' });
  await expect(archive).toContainText(
    'Sichtbarkeit: private · Eigentümer: unbekannt',
  );
  await expect(
    list
      .getByRole('listitem')
      .filter({ hasText: 'Fixture Watch Later' })
      .getByRole('button', { name: 'Als lokales Archivziel wählen' }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
    )
    .toEqual({
      created: [
        {
          url: expect.stringMatching(
            /^https:\/\/www\.youtube\.com\/feed\/playlists#latersift-work=[\da-f-]{36}$/,
          ),
          active: false,
        },
      ],
      connections: [{ tabId: 321, name: 'latersift-readonly-v1' }],
      requests: [{ type: 'playlists' }, { ack: 1 }],
      acknowledgedAfterSave: true,
      disconnected: true,
      removed: [321],
    });
  await archive
    .getByRole('button', { name: 'Als lokales Archivziel wählen' })
    .click();
  await expect(page.getByLabel('YouTube-Playlist-URL oder PL…-ID')).toHaveValue(
    'PLfixtureFeed123456',
  );
  // Choosing from the feed only fills the local form; it does not save the target.
  await page.reload();
  await openArchive();
  await expect(page.getByLabel('YouTube-Playlist-URL oder PL…-ID')).toHaveValue(
    'PL1234567890123456',
  );
  await expect(panel.getByRole('status')).toContainText(
    '2 Playlists · Teilbestand / Vollständigkeit offen',
  );
  await expect(list.getByRole('listitem')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, 'playlistTransport').created,
    ),
  ).toEqual([]);
});

async function openPlaylistFeed(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'Runde starten' }).click();
  await page.getByRole('button', { name: 'Runde anpassen' }).click();
  await page.getByRole('button', { name: 'Archivziel hinterlegen' }).click();
  const panel = page.getByRole('region', { name: 'Playlist-Katalog' });
  await panel
    .getByRole('button', { name: 'Playlists aktualisieren', exact: true })
    .click();
  return panel;
}

async function readWorkTabDiagnostics(page: Page) {
  await page
    .getByText('Arbeitstab-Diagnose (ohne URL-Parameter)', { exact: true })
    .click();
  const textarea = page.getByRole('textbox', {
    name: 'Bereinigte Arbeitstab-Diagnose',
  });
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveAttribute('readonly', '');
  const text = await textarea.inputValue();
  const reports = JSON.parse(text) as Record<string, string>[];
  expect(Array.isArray(reports)).toBe(true);
  expect(reports.length).toBeGreaterThan(0);
  expect(reports.length).toBeLessThanOrEqual(12);
  const allowed: Record<string, string[]> = {
    source: ['playlists', 'watch-later', 'unknown'],
    tabStatus: ['loading', 'complete', 'unknown'],
    phase: ['initial', 'target-loading', 'target-ready', 'foreign-navigation'],
    targetPath: ['/feed/playlists', '/playlist', 'unknown'],
    actualPath: [
      '/feed/playlists',
      '/feed/library',
      '/playlist',
      '/watch',
      '/m',
      '[other]',
      'unknown',
    ],
    origin: ['youtube', 'consent', 'sign-in', 'other', 'unknown', 'about'],
    marker: ['absent', 'matching', 'different'],
    reason: [
      'waiting',
      'ready',
      'marker_lost',
      'unexpected_youtube_destination',
      'foreign_destination',
      'consent_required',
      'sign_in_required',
      'pending_navigation',
      'timeout',
      'tab_lost',
      'inactive',
      'ownership_persistence_failed',
    ],
  };
  for (const [index, report] of reports.entries()) {
    for (const key of [
      'tabStatus',
      'phase',
      'targetPath',
      'actualPath',
      'origin',
      'marker',
      'reason',
    ]) {
      expect(report).toHaveProperty(key);
    }
    for (const [key, value] of Object.entries(report)) {
      expect(allowed).toHaveProperty(key);
      expect(allowed[key]).toContain(value);
    }
    if (index > 0) expect(report).not.toEqual(reports[index - 1]);
  }
  for (const secret of [
    'QUERY_SECRET',
    'HASH_SECRET',
    'private_query',
    'private_hash',
    'continue=',
    'https://',
    'latersift-work=',
  ]) {
    expect(text).not.toContain(secret);
  }
  return reports;
}

test('playlist feed waits through initial blank, missing URL and loading target before scanning and acknowledging', async ({
  page,
}) => {
  await seed(page);
  await fakePlaylistFeed(page, null, 'delayed');
  const panel = await openPlaylistFeed(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (Reflect.get(globalThis, 'playlistTabReads') as string[]).filter(
            (step) => step === 'target-loading',
          ).length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
  ).toMatchObject({
    connections: [],
    requests: [],
    removed: [],
    acknowledgedAfterSave: false,
  });
  await page.evaluate(() => Reflect.set(globalThis, 'playlistTabReady', true));
  await expect(
    panel.getByRole('button', { name: 'Playlists aktualisieren', exact: true }),
  ).toBeEnabled();
  const reads = (await page.evaluate(() =>
    Reflect.get(globalThis, 'playlistTabReads'),
  )) as string[];
  expect(reads.slice(0, 4)).toEqual([
    'about:blank',
    'about:blank',
    'missing-url',
    'missing-url',
  ]);
  expect(reads.slice(4, -2).every((step) => step === 'target-loading')).toBe(
    true,
  );
  expect(reads.slice(-2)).toEqual(['complete', 'complete']);
  expect(
    await page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
  ).toMatchObject({
    connections: [{ tabId: 321, name: 'latersift-readonly-v1' }],
    requests: [{ type: 'playlists' }, { ack: 1 }],
    acknowledgedAfterSave: true,
    disconnected: true,
    removed: [321],
  });
  await expect(
    panel
      .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
      .getByRole('listitem'),
  ).toHaveCount(2);
  expect(await readWorkTabDiagnostics(page)).toEqual([
    expect.objectContaining({
      phase: 'initial',
      origin: 'about',
      tabStatus: 'loading',
      reason: 'waiting',
    }),
    expect.objectContaining({
      phase: 'initial',
      origin: 'unknown',
      actualPath: 'unknown',
      tabStatus: 'loading',
      reason: 'waiting',
    }),
    expect.objectContaining({
      phase: 'target-loading',
      origin: 'youtube',
      actualPath: '/feed/playlists',
      marker: 'matching',
      reason: 'waiting',
    }),
    expect.objectContaining({
      phase: 'target-ready',
      targetPath: '/feed/playlists',
      tabStatus: 'complete',
      marker: 'matching',
      reason: 'ready',
    }),
  ]);
});

test('playlist feed reads a target with a stripped marker but never closes its tab', async ({
  page,
}) => {
  await seed(page);
  await fakePlaylistFeed(page, null, 'marker-stripped');
  const panel = await openPlaylistFeed(page);
  await expect(
    panel.getByRole('button', { name: 'Playlists aktualisieren', exact: true }),
  ).toBeEnabled();
  await expect(
    panel
      .getByRole('list', { name: 'Verifizierte Playlist-IDs' })
      .getByRole('listitem'),
  ).toHaveCount(2);
  expect(
    await page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
  ).toMatchObject({
    connections: [{ tabId: 321, name: 'latersift-readonly-v1' }],
    requests: [{ type: 'playlists' }, { ack: 1 }],
    acknowledgedAfterSave: true,
    disconnected: true,
    removed: [],
  });
  expect(await readWorkTabDiagnostics(page)).toEqual([
    expect.objectContaining({
      phase: 'target-ready',
      marker: 'absent',
      reason: 'marker_lost',
    }),
    expect.objectContaining({
      phase: 'target-ready',
      marker: 'absent',
      reason: 'ready',
    }),
  ]);
  await expect(
    panel.getByText(/Dieser Tab bleibt zur manuellen Bereinigung erhalten/),
  ).toBeVisible();
});

for (const navigation of ['redirect', 'consent'] as const) {
  test(`playlist feed rejects a completed ${navigation} without scanning or closing and exposes sanitized diagnostics without a catalog`, async ({
    page,
  }) => {
    await seed(page);
    await fakePlaylistFeed(page, null, navigation);
    const panel = await openPlaylistFeed(page);
    await expect(
      panel.getByRole('button', {
        name: 'Playlists aktualisieren',
        exact: true,
      }),
    ).toBeEnabled();
    await expect(panel.getByRole('alert')).toContainText(
      'Playlist-Aktualisierung unterbrochen',
    );
    await expect(
      panel.getByRole('list', { name: 'Verifizierte Playlist-IDs' }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(globalThis, 'playlistTransport')),
    ).toMatchObject({
      created: [
        {
          url: expect.stringMatching(
            /^https:\/\/www\.youtube\.com\/feed\/playlists#latersift-work=/,
          ),
          active: false,
        },
      ],
      connections: [],
      requests: [],
      acknowledgedAfterSave: false,
      removed: [],
    });
    expect(
      await page.evaluate(() =>
        localStorage.getItem('latersift-playlist-catalog-v1'),
      ),
    ).toBeNull();
    expect(await readWorkTabDiagnostics(page)).toEqual([
      expect.objectContaining({
        tabStatus: 'complete',
        phase: 'foreign-navigation',
        targetPath: '/feed/playlists',
        actualPath: navigation === 'redirect' ? '/feed/library' : '/m',
        origin: navigation === 'redirect' ? 'youtube' : 'consent',
        marker: 'different',
        reason:
          navigation === 'redirect'
            ? 'unexpected_youtube_destination'
            : 'consent_required',
      }),
    ]);
    if (navigation === 'consent') {
      await expect(
        panel.getByText(
          /LaterSift bestätigt nichts und aktiviert keinen Tab\s+automatisch/,
        ),
      ).toBeVisible();
    }
  });
}

test('successive partial playlist refreshes retain older IDs without duplicating current entries, including after reload', async ({
  page,
}) => {
  await seed(page);
  await fakePlaylistFeed(page, [
    [
      { id: 'PLfixtureA', name: 'Older archive A' },
      { id: 'PLfixtureB', name: 'Original archive B' },
    ],
    [
      { id: 'PLfixtureB', name: 'Updated archive B' },
      { id: 'PLfixtureC', name: 'Original archive C' },
    ],
    [
      { id: 'PLfixtureC', name: 'Updated archive C' },
      { id: 'PLfixtureD', name: 'Current archive D' },
    ],
  ]);
  await page.reload();
  const openArchive = async () => {
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
  };
  await openArchive();
  const panel = page.getByRole('region', { name: 'Playlist-Katalog' });
  const current = panel.getByRole('list', {
    name: 'Verifizierte Playlist-IDs',
  });
  const staleSummary = panel.getByText(
    'Vorheriger Katalog (veraltet, vor dieser Aktualisierung)',
    { exact: true },
  );
  const stale = panel.locator('details').filter({
    has: page.getByText(
      'Vorheriger Katalog (veraltet, vor dieser Aktualisierung)',
      { exact: true },
    ),
  });
  const refresh = panel.getByRole('button', {
    name: 'Playlists aktualisieren',
    exact: true,
  });
  const refreshAndExpect = async (names: string[]) => {
    await refresh.click();
    await expect(current.getByRole('listitem').locator('strong')).toHaveText(
      names,
    );
    await expect(refresh).toBeEnabled();
    await expect(panel.getByRole('status')).toContainText(
      '2 Playlists · Teilbestand / Vollständigkeit offen',
    );
  };
  await refreshAndExpect(['Older archive A', 'Original archive B']);
  await expect(staleSummary).toHaveCount(0);
  await refreshAndExpect(['Updated archive B', 'Original archive C']);
  await staleSummary.click();
  await expect(stale.getByRole('listitem')).toHaveText([
    'Older archive A · PLfixtureA · Name: gespeichert (älterer Katalog) · Schreibbarkeit: nicht bestätigt',
  ]);
  await refreshAndExpect(['Updated archive C', 'Current archive D']);
  const expectRetainedCatalog = async () => {
    if ((await stale.getAttribute('open')) === null) await staleSummary.click();
    await expect(stale).toHaveAttribute('open', '');
    await expect(current.getByRole('listitem').locator('strong')).toHaveText([
      'Updated archive C',
      'Current archive D',
    ]);
    await expect(stale.getByRole('listitem')).toHaveText([
      'Older archive A · PLfixtureA · Name: gespeichert (älterer Katalog) · Schreibbarkeit: nicht bestätigt',
      'Updated archive B · PLfixtureB · Name: gespeichert (älterer Katalog) · Schreibbarkeit: nicht bestätigt',
    ]);
    await expect(stale.getByRole('button')).toHaveCount(0);
    await expect(
      panel.getByText('Original archive B', { exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByText('Original archive C', { exact: true }),
    ).toHaveCount(0);
  };
  await expectRetainedCatalog();
  await page.reload();
  await openArchive();
  await staleSummary.click();
  await expectRetainedCatalog();
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, 'playlistTransport').created,
    ),
  ).toEqual([]);
});

for (const [kind, journal] of [
  ['malformed JSON', '{invalid-json'],
  ['invalid entries', JSON.stringify([{ tabId: 321 }])],
]) {
  test(`invalid work journal (${kind}) reports cleanup failure but keeps the local library and backup available`, async ({
    page,
  }) => {
    await seed(page);
    await page.evaluate((journal) => {
      localStorage.setItem('latersift.work-tabs.v1', journal);
    }, journal);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(
      'Arbeitstab-Bereinigung nicht möglich; lokale Daten bleiben verfügbar:',
    );
    await expect(
      page.getByText(/Lokale Datenbank nicht verfügbar:/),
    ).toHaveCount(0);
    const start = page.getByRole('button', {
      name: 'Runde starten →',
      exact: true,
    });
    await expect(start).toBeEnabled();
    const backup = page.getByRole('button', { name: '↗ Backup', exact: true });
    await expect(backup).toBeEnabled();
    const downloadEvent = page.waitForEvent('download');
    await backup.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toContain('latersift-backup-');
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = Buffer.concat(chunks).toString('utf8');
    expect(exported).toContain('fixture-explicit');
    expect(exported).toContain('Fixture Video 1');
    await start.click();
    await expect(
      page.getByRole('heading', { name: 'Fixture Video 1' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('latersift.work-tabs.v1')),
    ).toBe(journal);
  });
}

test('header displays the installed manifest version on desktop and mobile', async ({
  page,
}) => {
  await fakeDiscovery(page);
  await page.goto('/');
  await expect(page.locator('header .version')).toHaveText('v9.8.7');
  await expect(page.locator('header .version')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('header .version')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('header is honest when no WebExtension manifest API is available', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('header .version')).toHaveText('Version unbekannt');
});

for (const fail of [false, true])
  test(`read-only discovery shows a copyable sanitized diagnostic (failure=${fail})`, async ({
    page,
  }) => {
    await seed(page);
    await fakeDiscovery(page, fail);
    await page.reload();
    await page.getByRole('button', { name: 'Runde starten' }).click();
    await page.getByRole('button', { name: 'Runde anpassen' }).click();
    await page.getByRole('button', { name: 'Archivziel hinterlegen' }).click();
    await expect(
      page.getByRole('button', {
        name: 'Playlists aktualisieren',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByText('Erweitert: bisherigen Save-Dialog untersuchen', {
        exact: true,
      })
      .click();
    await page
      .getByRole('button', {
        name: 'Playlists aus YouTube laden (Save-Dialog, Vordergrund)',
        exact: true,
      })
      .click();

    if (!fail) {
      const list = page.getByRole('list', {
        name: 'Erkannte YouTube-Playlists',
      });
      await expect(list.getByRole('listitem')).toHaveCount(16);
      await expect(
        list.getByText('Same playlist name', { exact: true }),
      ).toHaveCount(2);
      await expect(
        list.getByText('Identität unbestätigt', { exact: false }),
      ).toHaveCount(16);
      await expect(
        list.getByText('Auswahl unbekannt', { exact: false }),
      ).toHaveCount(1);
      await expect(page.getByLabel('Schreibbare YouTube-Playlist')).toHaveCount(
        0,
      );
      await expect(
        page.getByLabel('YouTube-Playlist-URL oder PL…-ID'),
      ).toHaveValue('PL1234567890123456');
    } else {
      await expect(
        page.getByRole('list', { name: 'Erkannte YouTube-Playlists' }),
      ).toHaveCount(0);
    }
    const textarea = page.getByRole('textbox', {
      name: 'Bereinigte YouTube-Dialogdiagnose',
    });
    await expect(textarea).not.toBeVisible();
    await page
      .getByText('Technische YouTube-Dialogdiagnose', { exact: true })
      .click();
    await expect(textarea).toBeVisible();
    const text = await textarea.inputValue();
    const report = JSON.parse(text);
    expect(report).toMatchObject({
      variant: fail ? 'unsupported' : 'sheet',
      playlistRows: 16,
      provenPlaylistIds: 0,
      unidentifiedRows: 16,
      selectionStates: { valid: 14, unknown: 1, contradictory: 1 },
    });
    expect(report.publicAttributeNames).toEqual([
      'aria-pressed',
      'data-playlist-id',
    ]);
    expect(text).not.toMatch(
      /PRIVATE_|Same playlist name|Fixture playlist|00000000000|PL1234567890123456|youtube\.com/,
    );
    await page
      .getByRole('button', { name: 'Diagnose kopieren', exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      'Bereinigte Diagnose kopiert.',
    );
    expect(
      await page.evaluate(() => Reflect.get(globalThis, 'copiedDiagnostic')),
    ).toBe(text);
  });

test('clipboard denial keeps the sanitized report available for manual copying', async ({
  page,
}) => {
  await seed(page);
  await fakeDiscovery(page, true, true);
  await page.reload();
  await page.getByRole('button', { name: 'Runde starten' }).click();
  await page.getByRole('button', { name: 'Runde anpassen' }).click();
  await page.getByRole('button', { name: 'Archivziel hinterlegen' }).click();
  await page
    .getByText('Erweitert: bisherigen Save-Dialog untersuchen', { exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Playlists aus YouTube laden (Save-Dialog, Vordergrund)',
      exact: true,
    })
    .click();

  await page
    .getByText('Technische YouTube-Dialogdiagnose', { exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Diagnose kopieren', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    'Diagnose markieren und manuell kopieren',
  );
  await expect(
    page.getByRole('textbox', { name: 'Bereinigte YouTube-Dialogdiagnose' }),
  ).toBeVisible();
});
