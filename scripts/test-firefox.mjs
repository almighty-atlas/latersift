// Smoke test: install the real built add-on in a fresh Firefox profile.
// No signed-in profile, YouTube navigation, or playlist mutation is involved.
import { firefox, expect } from '@playwright/test';
import { resolve } from 'node:path';
const { connectWithMaxRetries, findFreeTcpPort } = await import(
  new URL('./lib/firefox/remote.js', import.meta.resolve('web-ext'))
);
const port = await findFreeTcpPort();
const browser = await firefox.launch({
  headless: true,
  args: ['-start-debugger-server', String(port)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
  },
});
let remote;
try {
  remote = await connectWithMaxRetries({ port, maxRetries: 25 });
  await remote.installTemporaryAddon(
    resolve(process.env.LATERSIFT_ADDON_PATH || 'dist'),
    false,
  );
  const addon = await remote.getInstalledAddon(
    'latersift@almighty-atlas.github.io',
  );
  expect(addon.isWebExtension).toBe(true);
  expect(addon.temporarilyInstalled).toBe(true);
  expect(addon.persistentBackgroundScript).toBe(false);
  expect(addon.warnings).toEqual([]);
  expect(addon.manifestURL).toMatch(/^moz-extension:\/\//);
  console.log(
    `PASS Firefox ${browser.version()}: real MV3 add-on installed, nonpersistent background, no manifest warnings. No authenticated YouTube validation; extension-page navigation remains a manual check.`,
  );
} finally {
  remote?.disconnect();
  await browser.close();
}
