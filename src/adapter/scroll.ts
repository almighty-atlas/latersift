import { ROW } from './dom';

/** Only scroll geometry is changed; never click playlist controls or mutate rows. */
export function createPlaylistScroller(doc: Document, rootSelector?: string) {
  const container = () => {
    const row = rootSelector
      ? doc.querySelector(rootSelector)
      : (doc.querySelector(ROW) ??
        doc.querySelector('ytd-playlist-video-list-renderer'));
    for (
      let node = rootSelector ? row : row?.parentElement;
      node;
      node = node.parentElement
    ) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (
        style &&
        /^(auto|scroll)$/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight
      )
        return node;
    }
    return doc.scrollingElement as HTMLElement | null;
  };
  return {
    reset() {
      container()?.scrollTo({ top: 0, behavior: 'instant' });
    },
    info() {
      const node = container();
      return node
        ? {
            container:
              node === doc.scrollingElement
                ? 'document'
                : node.tagName.toLowerCase(),
            top: Math.round(node.scrollTop),
            height: node.scrollHeight,
            viewport: node.clientHeight,
          }
        : null;
    },
    advance(recovery = false) {
      const node = container();
      if (!node) return;
      const step = Math.max(400, Math.round(node.clientHeight * 0.85));
      const bottom = Math.max(0, node.scrollHeight - node.clientHeight);
      // At the bottom, move back one viewport. The next ordinary step re-enters
      // the loading boundary, which can re-trigger an IntersectionObserver.
      const top =
        recovery && node.scrollTop >= bottom - 2
          ? Math.max(0, node.scrollTop - step)
          : Math.min(bottom, node.scrollTop + step);
      node.scrollTo({ top, behavior: 'instant' });
    },
  };
}
