import browser from 'webextension-polyfill';
// No queue execution or timers in the event page. Reopening never performs writes.
browser.action.onClicked.addListener(async () => {
  const url = browser.runtime.getURL('index.html');
  const existing = (await browser.tabs.query({})).find(
    (tab) => tab.url === url,
  );
  if (existing?.id) await browser.tabs.update(existing.id, { active: true });
  else await browser.tabs.create({ url });
});
