import { ROW } from './dom';
import type {
  LoadingAreaObservation,
  ScrollActionObservation,
  ScrollPosition,
} from '../model';
import { safePlaylistTag } from '../playlist-diagnostics';
import type { FeedScrollDiagnostic } from './playlists';

/** Only scroll geometry is changed; never click playlist controls or mutate rows. */
export function createPlaylistScroller(doc: Document, rootSelector?: string) {
  const isHidden = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (
        node.matches('[hidden], [aria-hidden="true"]') ||
        style?.display === 'none' ||
        style?.visibility === 'hidden'
      )
        return true;
    }
    return false;
  };
  const container = (observed = false) => {
    const row = rootSelector
      ? doc.querySelector(rootSelector)
      : observed
        ? ([...doc.querySelectorAll(ROW)].find((node) => !isHidden(node)) ??
          [...doc.querySelectorAll('ytd-playlist-video-list-renderer')].find(
            (node) => !isHidden(node),
          ))
        : (doc.querySelector(ROW) ??
          doc.querySelector('ytd-playlist-video-list-renderer'));
    for (
      let node =
        rootSelector ||
        (observed && row?.matches('ytd-playlist-video-list-renderer'))
          ? row
          : row?.parentElement;
      node;
      node = node.parentElement
    ) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (
        style &&
        /^(auto|scroll)$/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight &&
        (!observed || (node.clientHeight > 0 && !isHidden(node)))
      )
        return node;
    }
    return doc.scrollingElement as HTMLElement | null;
  };
  const epochs = new WeakMap<Element, number>();
  let nextEpoch = 0;
  const position = (node: Element | null): ScrollPosition | null => {
    if (!node) return null;
    if (!epochs.has(node)) epochs.set(node, ++nextEpoch);
    return {
      container: node === doc.scrollingElement ? 'document' : node.localName,
      epoch: epochs.get(node)!,
      top: Math.round(node.scrollTop),
      height: node.scrollHeight,
      viewport: node.clientHeight,
    };
  };
  const observe = (
    kind: ScrollActionObservation['kind'],
  ): ScrollActionObservation => {
    const node = container(true);
    const before = position(node);
    const report: ScrollActionObservation = {
      kind,
      before,
      requestedTop: null,
      after: before,
      outcome: 'unavailable',
      attribution: 'during-call-only',
    };
    if (!node || !before || before.viewport <= 0) return report;
    const step = Math.max(400, Math.round(node.clientHeight * 0.85));
    const bottom = Math.max(0, node.scrollHeight - node.clientHeight);
    const top =
      kind === 'reset'
        ? 0
        : kind === 'recovery' && node.scrollTop >= bottom - 2
          ? Math.max(0, node.scrollTop - step)
          : Math.min(bottom, node.scrollTop + step);
    report.requestedTop = top;
    try {
      node.scrollTo({ top, behavior: 'instant' });
      report.after = position(node);
      const reached = Math.abs(report.after!.top - top) <= 2;
      report.outcome = reached
        ? 'target-observed'
        : report.after!.top === before.top
          ? 'no-movement'
          : 'partial-or-divergent';
    } catch {
      report.after = position(node);
      report.outcome = 'error';
    }
    return report;
  };
  return {
    // Watch Later uses the instrumented path; feed behavior stays unchanged.
    observedInfo: () => position(container(true)),
    observedLoadingArea(): LoadingAreaObservation {
      const node = container(true);
      const elements = [
        ...doc.querySelectorAll(
          'ytd-playlist-video-list-renderer ytd-continuation-item-renderer',
        ),
      ].filter((element) => !isHidden(element));
      const result: LoadingAreaObservation = {
        visibleElements: elements.length,
        inViewport: null,
        distanceToViewport: null,
      };
      if (!node || node.clientHeight <= 0 || !elements.length) return result;
      const viewportTop =
        node === doc.scrollingElement
          ? 0
          : node.getBoundingClientRect().top + node.clientTop;
      const viewportBottom = viewportTop + node.clientHeight;
      const rects = elements
        .slice(0, 16)
        .map((element) => element.getBoundingClientRect())
        .filter(
          (rect) =>
            rect.height > 0 &&
            Number.isFinite(rect.top) &&
            Number.isFinite(rect.bottom),
        );
      if (!rects.length) return result;
      result.inViewport = rects.some(
        (rect) => rect.bottom > viewportTop && rect.top < viewportBottom,
      );
      result.distanceToViewport = Math.round(
        Math.min(
          ...rects.map((rect) =>
            Math.max(0, rect.top - viewportBottom, viewportTop - rect.bottom),
          ),
        ),
      );
      return result;
    },
    observedAdvance: (recovery = false) =>
      observe(recovery ? 'recovery' : 'advance'),
    observedReset: () => observe('reset'),
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
