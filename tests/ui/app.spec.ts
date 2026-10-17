import { test, expect, type Page } from '@playwright/test';
async function seed(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Watch Later importieren');
  await page.evaluate(async () => {
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
        scans: [
          {
            id: 'fixture-explicit',
            startedAt: '2026-10-17T00:00:00Z',
            finishedAt: '2026-10-17T00:00:00Z',
            status: 'complete',
            expectedCount: 3,
            unidentifiableRows: 0,
            message: 'TEST FIXTURE, NOT LIVE YOUTUBE',
            videos: Array.from({ length: 3 }, (_, n) => ({
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
          },
        ],
      },
      'library',
    );
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
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
    page.getByRole('button', { name: 'Read-only-Import starten' }),
  ).toBeDisabled();
  await expect(page.getByRole('alert').last()).toContainText(
    'geladenen Firefox-/Zen-Erweiterung',
  );
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
