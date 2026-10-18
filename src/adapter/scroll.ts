import { ROW } from './dom';
import { safePlaylistTag } from '../playlist-diagnostics';
import type { FeedScrollDiagnostic } from './playlists';

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
    diagnostics(): FeedScrollDiagnostic {
      const selected = container();
      const root = doc.scrollingElement;
      const containers: FeedScrollDiagnostic['containers'] = [];
      const seen = new Set<Element>();
      let truncated = false;
      const add = (node: Element) => {
        if (seen.has(node)) return;
        seen.add(node);
        if (containers.length >= 12) {
          truncated = true;
          return;
        }
        containers.push({
          tag: node === root ? 'document' : safePlaylistTag(node.localName),
          top: Math.max(0, Math.round(node.scrollTop)),
          height: node.scrollHeight,
          viewport: node.clientHeight,
          selected: node === selected,
          scrollable:
            node.clientHeight > 0 && node.scrollHeight > node.clientHeight,
        });
      };
      if (selected) add(selected);
      if (root) add(root);
      // Inspect geometry only. Never use arbitrary identifiers or switch the
      // selected scroll target based on these diagnostic-only candidates.
      const walker = doc.createTreeWalker(doc.documentElement, 1);
      let node = walker.currentNode as Element | null;
      let inspectedElements = 0;
      while (node && inspectedElements < 3000) {
        inspectedElements++;
        const style = doc.defaultView?.getComputedStyle(node);
        if (
          style &&
          /^(auto|scroll)$/.test(style.overflowY) &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          !node.closest('[hidden], [aria-hidden="true"]') &&
          node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight
        )
          add(node);
        node = walker.nextNode() as Element | null;
      }
      return {
        containers,
        inspectedElements,
        truncated: truncated || node !== null,
      };
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
