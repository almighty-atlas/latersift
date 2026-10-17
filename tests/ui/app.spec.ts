import { test, expect, type Page } from '@playwright/test';
import type { Scan } from '../../src/model';

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
  await expect(page.getByText('Kein passender Tab gefunden')).toBeAttached();
  await expect(
    page.getByRole('button', { name: 'Read-only-Import neu starten' }),
  ).toBeDisabled();
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
  test(`persisted ${status} scan shows durable partial progress and disabled resume without an extension tab`, async ({
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
    await expect(resume).toBeDisabled();
    await expect(dialog.getByLabel('Verbundener Watch-Later-Tab')).toHaveValue(
      '',
    );
    await expect(
      dialog.getByRole('button', { name: 'Read-only-Import neu starten' }),
    ).toBeDisabled();
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
      confirmedCount: 8,
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
    await expect(dialog.getByText('3 / 8 Videos · 37,5 %')).toBeVisible();
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
    ).toBeDisabled();
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
  await expect(restart).toBeDisabled();
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
  await expect(page.getByText('0 YouTube-Änderungen ausgeführt')).toBeVisible();
  await expect(
    page.getByText('YouTube-Schreibzugriff gesperrt:', { exact: false }),
  ).toBeVisible();
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
