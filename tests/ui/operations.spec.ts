import { test, expect, type Page } from '@playwright/test';
import type { Decision } from '../../src/model';

async function seed(
  page: Page,
  persisted = true,
  latestComplete = true,
  statuses: Decision['status'][] = ['pending', 'pending'],
) {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Watch Later importieren' }),
  ).toBeEnabled();
  await page.evaluate(
    async ({ persisted, latestComplete, statuses }) => {
      const library: import('../../src/model').Library = {
        schemaVersion: 2,
        scans: [],
        decisions: [],
        session: null,
        archivePlaylist: '',
      };
      const scan = {
        id: 'operations-fixture',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'complete' as const,
        expectedCount: statuses.length,
        unidentifiableRows: 0,
        message: 'FIXTURE — NOT LIVE YOUTUBE',
        videos: statuses.map((_, n) => ({
          id: String(n).padStart(11, '0'),
          url: `https://www.youtube.com/watch?v=${String(n).padStart(11, '0')}`,
          title: `Operations Fixture ${n + 1}`,
          channel: null,
          thumbnail: null,
          durationSeconds: null,
          publishedAt: null,
          position: n + 1,
          availability: 'available' as const,
          evidence: null,
          scannedAt: new Date().toISOString(),
          originalPlaylist: 'WL' as const,
        })),
      };
      library.scans.push(scan);
      if (!latestComplete)
        library.scans.push({
          ...scan,
          id: 'newer-incomplete',
          status: 'incomplete',
        });
      library.decisions = scan.videos.map((v, n) => ({
        id: `decision-${n}`,
        videoId: v.id,
        sessionId: 'fixture-session',
        kind: 'remove' as const,
        targetPlaylist: null,
        createdAt: new Date().toISOString(),
        status: statuses[n],
        ...(statuses[n] === 'pending'
          ? {}
          : {
              journal: {
                remove: {
                  id: `step-${n}`,
                  status: statuses[n],
                  attempts: 1,
                  message: 'Fixture journal evidence',
                },
              },
            }),
      }));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('latersift', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['state', 'snapshots'], 'readwrite');
      tx.objectStore('state').put(library, 'library');
      if (persisted) tx.objectStore('snapshots').put(scan);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { persisted, latestComplete, statuses },
  );
  await page.reload();
  await page
    .getByRole('button', {
      name: `Vorgemerkt ${statuses.filter((s) => ['pending', 'failed', 'unknown'].includes(s)).length}`,
    })
    .click();
}

// These tests use IndexedDB fixtures only; no authenticated YouTube or write adapter.
test('none selected, export gate, pilot cap, and absent extension blocks before mutation', async ({
  page,
}) => {
  const youtubeRequests: string[] = [];
  await page.route(/https:\/\/([^/]*\.)?youtube\.com\//, async (route) => {
    youtubeRequests.push(route.request().url());
    await route.abort();
  });
  await seed(page);
  const execute = page.getByRole('button', {
    name: 'YouTube-Arbeitstab öffnen und Auswahl ausführen',
  });
  const first = page.getByRole('checkbox', { name: 'Auswählen: 00000000000' });
  const second = page.getByRole('checkbox', { name: 'Auswählen: 00000000001' });
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(execute).toBeDisabled();
  await first.check();
  await expect(second).toBeDisabled();
  await expect(execute).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: /Ich erlaube genau diese/ }),
  ).toBeDisabled();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Bestand und Vormerkungen exportieren' })
    .click();
  await download;
  await page.getByRole('checkbox', { name: /Ich habe den Export/ }).check();
  await page
    .getByRole('button', { name: 'Exportbestätigung speichern' })
    .click();
  await expect(
    page.getByText('Export für aktuellen Snapshot bestätigt.', { exact: true }),
  ).toBeVisible();
  await expect(execute).toBeDisabled();
  await page.getByRole('checkbox', { name: /Ich erlaube genau diese/ }).check();
  await expect(execute).toBeEnabled();
  expect(youtubeRequests).toEqual([]);
  await execute.click();
  await expect(page.getByRole('alert').last()).toBeVisible();
  expect(youtubeRequests).toEqual([]);
  const decisions = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('latersift', 1);
      request.onsuccess = () => resolve(request.result);
    });
    const result = await new Promise<import('../../src/model').Library>(
      (resolve) => {
        const request = db
          .transaction('state')
          .objectStore('state')
          .get('library');
        request.onsuccess = () => resolve(request.result);
      },
    );
    db.close();
    return result.decisions;
  });
  expect(decisions.map((d) => d.status)).toEqual(['pending', 'pending']);
  expect(decisions.every((d) => !d.journal)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Vorgemerkt 2' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Auswählen: 00000000000' }),
  ).not.toBeChecked();
  await expect(execute).toBeDisabled();
  expect(youtubeRequests).toEqual([]);
});

test('library complete flag alone cannot confirm export without stored snapshot', async ({
  page,
}) => {
  await seed(page, false);
  await page.getByRole('checkbox', { name: /Ich habe den Export/ }).check();
  await page
    .getByRole('button', { name: 'Exportbestätigung speichern' })
    .click();
  await expect(page.getByRole('alert').last()).toContainText(
    'Kein tatsächlich gespeicherter vollständiger Snapshot',
  );
  await expect(
    page.getByRole('button', {
      name: 'YouTube-Arbeitstab öffnen und Auswahl ausführen',
    }),
  ).toBeDisabled();
});

test('newer incomplete scan blocks even with an older persisted complete snapshot', async ({
  page,
}) => {
  await seed(page, true, false);
  await expect(
    page.getByRole('button', { name: 'Exportbestätigung speichern' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', {
      name: 'YouTube-Arbeitstab öffnen und Auswahl ausführen',
    }),
  ).toBeDisabled();
});

async function confirmBackup(page: Page) {
  await page.getByRole('checkbox', { name: /Ich habe den Export/ }).check();
  await page
    .getByRole('button', { name: 'Exportbestätigung speichern' })
    .click();
  await expect(
    page.getByText('Export für aktuellen Snapshot bestätigt.', { exact: true }),
  ).toBeVisible();
}

const executeName = 'YouTube-Arbeitstab öffnen und Auswahl ausführen';

test('failed and unknown require new consent, count toward pilot cap, verified stays locked', async ({
  page,
}) => {
  await seed(page, true, true, ['pending', 'failed', 'unknown', 'verified']);
  await confirmBackup(page);
  const choose = (n: number) =>
    page.getByRole('checkbox', {
      name: `Auswählen: ${String(n).padStart(11, '0')}`,
    });
  await expect(choose(3)).toBeDisabled();
  await expect(
    page.getByText(/Ausgang unklar: Bitte zuerst manuell/),
  ).toBeVisible();
  await expect(
    page.getByText('Remove: unknown Fixture journal evidence'),
  ).toBeVisible();
  const consent = page.getByRole('checkbox', {
    name: /Ich erlaube genau diese/,
  });
  const execute = page.getByRole('button', { name: executeName });
  await choose(1).check();
  await expect(choose(2)).toBeDisabled();
  await consent.check();
  await expect(execute).toBeEnabled();
  await choose(1).uncheck();
  await choose(2).check();
  await expect(consent).not.toBeChecked();
  await expect(execute).toBeDisabled();
  await consent.check();
  await page
    .getByRole('button', { name: 'Vormerkung für 00000000000 zurücknehmen' })
    .click();
  await expect(consent).not.toBeChecked();
  await expect(execute).toBeDisabled();
  await expect(
    page.getByText('Export für aktuellen Snapshot bestätigt.', { exact: true }),
  ).toBeVisible();
  await consent.check();
  await execute.click();
  await expect(page.getByRole('alert').last()).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(execute).toBeDisabled();
});

// Fake extension API only: no tab navigation, DOM adapter, account or YouTube network.
async function fakeExtension(page: Page) {
  await page.route(/https:\/\/([^/]*\.)?youtube\.com\//, (route) =>
    route.abort(),
  );
  await page.addInitScript(() => {
    const fixture = {
      requests: [] as string[],
      release: undefined as undefined | (() => void),
      disconnected: false,
    };
    const host = window as unknown as {
      chrome: unknown;
      browser: unknown;
      writeFixture: typeof fixture;
    };
    host.writeFixture = fixture;
    let present = true;
    let url = '';
    let status: 'loading' | 'complete' = 'complete';
    function tabEvent<Args extends unknown[]>() {
      const listeners = new Set<(...args: Args) => void>();
      return {
        addListener: (listener: (...args: Args) => void) => {
          listeners.add(listener);
        },
        removeListener: (listener: (...args: Args) => void) => {
          listeners.delete(listener);
        },
        emit: (...args: Args) => {
          for (const listener of [...listeners]) listener(...args);
        },
      };
    }
    const onUpdated = tabEvent<[number, { status: 'loading' | 'complete' }]>();
    const onRemoved = tabEvent<[number]>();
    async function navigate() {
      status = 'loading';
      onUpdated.emit(42, { status });
      await Promise.resolve();
      status = 'complete';
      onUpdated.emit(42, { status });
    }
    host.chrome = { runtime: { id: 'local-fixture' } };
    host.browser = {
      runtime: { id: 'local-fixture' },
      windows: { get: async () => ({ focused: true }) },
      tabs: {
        onUpdated,
        onRemoved,
        create: async (options: { url: string }) => {
          url = options.url;
          return { id: 42 };
        },
        get: async () => ({
          active: true,
          windowId: 1,
          status,
          url,
        }),
        update: async (_id: number, options: { url: string }) => {
          url = options.url;
          await navigate();
        },
        reload: navigate,
        connect: () => {
          let receive: (message: unknown) => void;
          let disconnect: () => void;
          let closed = false;
          return {
            onMessage: {
              addListener: (fn: typeof receive) => {
                receive = fn;
              },
            },
            onDisconnect: {
              addListener: (fn: typeof disconnect) => {
                disconnect = fn;
              },
            },
            disconnect: () => {
              if (!closed) {
                closed = true;
                fixture.disconnected = true;
                disconnect?.();
              }
            },
            postMessage: (request: { method: string }) => {
              fixture.requests.push(request.method);
              if (request.method === 'remove') {
                fixture.release = () => {
                  if (!closed) {
                    present = false;
                    receive({ ok: true, result: { changed: true } });
                  }
                };
              } else {
                queueMicrotask(() =>
                  receive({
                    ok: true,
                    result: {
                      state: present ? 'present' : 'absent',
                      source: 'native-dialog',
                      observedAt: new Date().toISOString(),
                    },
                  }),
                );
              }
            },
          };
        },
      },
    };
  });
}

async function startFixtureRun(
  page: Page,
  statuses: Decision['status'][] = ['pending', 'pending'],
) {
  await fakeExtension(page);
  await seed(page, true, true, statuses);
  await confirmBackup(page);
  await page.getByRole('checkbox', { name: 'Auswählen: 00000000000' }).check();
  await page.getByRole('checkbox', { name: /Ich erlaube genau diese/ }).check();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { writeFixture: { requests: string[] } })
          .writeFixture.requests,
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: executeName }).click();
  await expect(
    page.getByText('Aktuell: Operations Fixture 1 · Video-ID: 00000000000'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { writeFixture: { requests: string[] } }
        ).writeFixture.requests.includes('remove'),
      ),
    )
    .toBe(true);
}

for (const status of ['failed', 'unknown'] as const) {
  test(`explicit ${status} retry reads fresh membership before any mutation`, async ({
    page,
  }) => {
    await startFixtureRun(page, [status, 'pending']);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { writeFixture: { requests: string[] } })
            .writeFixture.requests,
      ),
    ).toEqual(['membership', 'membership', 'remove']);
    await expect(
      page.getByText('Verified: 0 · Failed: 0 · Unknown: 0'),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { writeFixture: { release?: () => void } }
      ).writeFixture.release?.(),
    );
    await expect(page.getByText('Remove: verified')).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Auswählen: 00000000000' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('checkbox', { name: /Ich erlaube genau diese/ }),
    ).not.toBeChecked();
  });
}

test('running progress retains stop ownership across close, Escape and backdrop attempts', async ({
  page,
}) => {
  await startFixtureRun(page);
  await expect(
    page.getByRole('button', { name: 'Dialog schließen' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('.modal-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Ausführungsfortschritt' }),
  ).toHaveAttribute('max', '1');

  await expect(
    page.getByRole('button', {
      name: 'Vormerkung für 00000000000 zurücknehmen',
    }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Nach aktueller Aktion stoppen' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Stopp angefordert' }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { writeFixture: { release?: () => void } }
    ).writeFixture.release?.(),
  );
  await expect(
    page.getByText('Verified: 1 · Failed: 0 · Unknown: 0'),
  ).toBeVisible();
  await expect(page.getByText('Remove: verified')).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Ausführungsfortschritt' }),
  ).toHaveAttribute('value', '1');
  await expect(
    page.getByRole('button', { name: 'Dialog schließen' }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('closing the actual app during a mutation leaves an unknown journal on reload, never auto-retries', async ({
  page,
}) => {
  await startFixtureRun(page);
  await page.reload();
  await page.getByRole('button', { name: 'Vorgemerkt 2' }).click();
  await expect(page.getByText('Remove: unknown')).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Auswählen: 00000000000' }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: /Ich erlaube genau diese/ }),
  ).not.toBeChecked();
  await expect(page.getByRole('button', { name: executeName })).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { writeFixture: { requests: string[] } })
          .writeFixture.requests,
    ),
  ).toEqual([]);
});
