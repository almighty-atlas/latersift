// Synthetic contract based on the user's structural observations, not captured live DOM.
export function sheetRow(
  title: string,
  checked = false,
  id: string | null = null,
) {
  return `<toggleable-list-item-view-model><yt-list-item-view-model><button role="menuitem" aria-label="${title}" aria-pressed="${checked}"><yt-collection-thumbnail-view-model></yt-collection-thumbnail-view-model><span>${title}</span></button>${id ? `<a href="/playlist?list=${id}">${title}</a>` : ''}</yt-list-item-view-model></toggleable-list-item-view-model>`;
}
export function saveSheet(rows?: string, heading = 'Save to…') {
  return `<ytd-popup-container><tp-yt-iron-dropdown><yt-sheet-view-model><yt-contextual-sheet-layout><yt-panel-header-view-model><h2>${heading}</h2></yt-panel-header-view-model>${rows ?? Array.from({ length: 16 }, (_, i) => sheetRow(i === 0 ? 'Watch later' : i === 1 ? 'Archive' : `Playlist ${i}`, i % 2 === 0)).join('')}<button>New playlist</button></yt-contextual-sheet-layout></yt-sheet-view-model></tp-yt-iron-dropdown></ytd-popup-container>`;
}
