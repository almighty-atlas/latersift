import { describe, expect, it, vi } from 'vitest';
import { createPlaylistScroller } from '../src/adapter/scroll';

function geometry(
  node: HTMLElement,
  height: number,
  viewport: number,
  top = 0,
) {
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, value: height },
    clientHeight: { configurable: true, value: viewport },
  });
  node.scrollTop = top;
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    node.scrollTop = options.top ?? node.scrollTop;
  });
  Object.defineProperty(node, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });
  return scrollTo;
}
function fixture() {
  const doc = document.implementation.createHTMLDocument('Watch Later');
  // Keep a real defaultView so computed overflow styles participate in selection.
  Object.defineProperty(doc, 'defaultView', { value: window });
  doc.body.innerHTML =
    '<main style="overflow-y: auto"><aside style="overflow-y: scroll"></aside><section style="overflow-y: auto"><div style="overflow-y: hidden"><ytd-playlist-video-list-renderer><div id="contents"><ytd-playlist-video-renderer><span id="index">1</span><a id="video-title" href="/watch?v=aaaaaaaaaaa">Video</a></ytd-playlist-video-renderer></div></ytd-playlist-video-list-renderer></div></section></main>';
  const root = doc.documentElement;
  Object.defineProperty(doc, 'scrollingElement', {
    configurable: true,
    value: root,
  });
  const outer = doc.querySelector('main')!;
  const inner = doc.querySelector('section')!;
  const hidden = doc.querySelector('section > div') as HTMLElement;
  const unrelated = doc.querySelector('aside')!;
  const rootScroll = geometry(root, 10000, 1000);
  const outerScroll = geometry(outer, 8000, 800);
  const innerScroll = geometry(inner, 3000, 600);
  const hiddenScroll = geometry(hidden, 4000, 500);
  const unrelatedScroll = geometry(unrelated, 2000, 500);
  return {
    doc,
    root,
    outer,
    inner,
    rootScroll,
    outerScroll,
    innerScroll,
    hiddenScroll,
    unrelatedScroll,
  };
}

describe('read-only playlist scroller geometry', () => {
  it('reports selected and alternative scroll containers without changing the scroll target', () => {
    const f = fixture();
    const scroller = createPlaylistScroller(f.doc);
    const html = f.doc.body.innerHTML;
    const diagnostic = scroller.diagnostics();
    expect(diagnostic.containers).toEqual(
      expect.arrayContaining([
        {
          tag: 'section',
          top: 0,
          height: 3000,
          viewport: 600,
          selected: true,
          scrollable: true,
        },
        {
          tag: 'document',
          top: 0,
          height: 10000,
          viewport: 1000,
          selected: false,
          scrollable: true,
        },
        {
          tag: 'main',
          top: 0,
          height: 8000,
          viewport: 800,
          selected: false,
          scrollable: true,
        },
      ]),
    );
    expect(diagnostic.inspectedElements).toBeGreaterThan(0);
    expect(diagnostic.truncated).toBe(false);
    expect(f.innerScroll).not.toHaveBeenCalled();
    expect(f.doc.body.innerHTML).toBe(html);
  });

  it('reports a fitting document as non-scrollable and keeps custom names out of diagnostics', () => {
    const f = fixture();
    geometry(f.root, 1258, 1258);
    const privateNode = f.doc.createElement('private-playlist-title');
    privateNode.style.overflowY = 'auto';
    privateNode.setAttribute('data-private-id', 'PL_secret');
    f.doc.body.append(privateNode);
    geometry(privateNode, 2000, 500);
    const diagnostic = createPlaylistScroller(
      f.doc,
      'ytd-rich-grid-renderer',
    ).diagnostics();
    expect(diagnostic.containers[0]).toEqual({
      tag: 'document',
      top: 0,
      height: 1258,
      viewport: 1258,
      selected: true,
      scrollable: false,
    });
    expect(diagnostic.containers).toContainEqual({
      tag: 'other',
      top: 0,
      height: 2000,
      viewport: 500,
      selected: false,
      scrollable: true,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-playlist-title|PL_secret|data-private-id/,
    );
  });

  it('bounds geometry inspection and the number of reported containers', () => {
    const f = fixture();
    for (let i = 0; i < 3010; i++) {
      const node = f.doc.createElement('div');
      node.style.overflowY = 'auto';
      geometry(node, 2000, 500);
      f.doc.body.append(node);
    }
    const diagnostic = createPlaylistScroller(f.doc).diagnostics();
    expect(diagnostic.containers).toHaveLength(12);
    expect(diagnostic.inspectedElements).toBe(3000);
    expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.containers[0].selected).toBe(true);
  });
  it('scrolls the feed renderer itself when it is the nearest overflowing container', () => {
    const f = fixture();
    const feed = f.doc.createElement('ytd-rich-grid-renderer');
    feed.style.overflowY = 'auto';
    f.doc.body.append(feed);
    const scroll = geometry(feed, 3000, 600);
    const html = f.doc.body.innerHTML;
    const scroller = createPlaylistScroller(
      f.doc,
      'ytd-rich-grid-renderer, ytd-section-list-renderer',
    );
    scroller.advance();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      top: 510,
      behavior: 'instant',
    });
    expect(f.innerScroll).not.toHaveBeenCalled();
    expect(f.rootScroll).not.toHaveBeenCalled();
    expect(f.doc.body.innerHTML).toBe(html);
  });

  it('falls back to document geometry when a feed renderer has not loaded', () => {
    const f = fixture();
    const scroller = createPlaylistScroller(f.doc, 'ytd-rich-grid-renderer');
    scroller.advance();
    expect(f.rootScroll).toHaveBeenCalledExactlyOnceWith({
      top: 850,
      behavior: 'instant',
    });
    expect(f.innerScroll).not.toHaveBeenCalled();
  });
  it.each(['nested', 'document'] as const)(
    'resets only the selected %s container to the beginning of a long loaded list',
    (kind) => {
      const f = fixture();
      const target = kind === 'nested' ? f.inner : f.root;
      if (kind === 'document') {
        geometry(f.inner, 600, 600, 0);
        geometry(f.outer, 800, 800, 0);
      }
      const scroll = geometry(target, 100000, 600, 99400);
      const html = f.doc.body.innerHTML;
      const scroller = createPlaylistScroller(f.doc);
      expect(scroller.info()?.top).toBe(99400);
      scroller.reset();
      expect(scroll).toHaveBeenCalledExactlyOnceWith({
        top: 0,
        behavior: 'instant',
      });
      expect(scroller.info()).toEqual({
        container: kind === 'nested' ? 'section' : 'document',
        top: 0,
        height: 100000,
        viewport: 600,
      });
      scroller.advance();
      expect(target.scrollTop).toBe(510);
      expect(f.unrelatedScroll).not.toHaveBeenCalled();
      expect(f.hiddenScroll).not.toHaveBeenCalled();
      expect(f.doc.body.innerHTML).toBe(html);
    },
  );

  it('reset safely handles a missing scrolling element and discovers a replacement container', () => {
    const f = fixture();
    const scroller = createPlaylistScroller(f.doc);
    f.inner.remove();
    Object.defineProperty(f.doc, 'scrollingElement', {
      configurable: true,
      value: null,
    });
    expect(() => scroller.reset()).not.toThrow();
    const replacement = f.doc.createElement('section');
    replacement.style.overflowY = 'auto';
    replacement.innerHTML =
      '<ytd-playlist-video-list-renderer></ytd-playlist-video-list-renderer>';
    f.outer.append(replacement);
    const scroll = geometry(replacement, 100000, 600, 80000);
    scroller.reset();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      top: 0,
      behavior: 'instant',
    });
    expect(scroller.info()?.top).toBe(0);
  });
  it('uses the nearest scrollable playlist ancestor, not hidden, unrelated or outer containers', () => {
    const f = fixture();
    const html = f.doc.body.innerHTML;
    const click = vi.spyOn(f.doc, 'dispatchEvent');
    const scroller = createPlaylistScroller(f.doc);
    expect(scroller.info()).toEqual({
      container: 'section',
      top: 0,
      height: 3000,
      viewport: 600,
    });
    scroller.advance();
    expect(f.innerScroll).toHaveBeenCalledWith({
      top: 510,
      behavior: 'instant',
    });
    expect(f.outerScroll).not.toHaveBeenCalled();
    expect(f.rootScroll).not.toHaveBeenCalled();
    expect(f.hiddenScroll).not.toHaveBeenCalled();
    expect(f.unrelatedScroll).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(f.doc.body.innerHTML).toBe(html);
  });

  it('ignores overflow:auto without actual overflow and falls back through ancestors to the document', () => {
    const f = fixture();
    geometry(f.inner, 600, 600);
    const scroller = createPlaylistScroller(f.doc);
    scroller.advance();
    expect(f.outerScroll).toHaveBeenCalledWith({
      top: 680,
      behavior: 'instant',
    });
    geometry(f.outer, 800, 800);
    scroller.advance();
    expect(f.rootScroll).toHaveBeenCalledWith({
      top: 850,
      behavior: 'instant',
    });
    expect(scroller.info()).toEqual({
      container: 'document',
      top: 850,
      height: 10000,
      viewport: 1000,
    });
  });

  it('clamps ordinary movement to the bottom and recovery backs up before re-entering it', () => {
    const f = fixture();
    f.inner.scrollTop = 2300;
    const scroller = createPlaylistScroller(f.doc);
    scroller.advance();
    expect(f.inner.scrollTop).toBe(2400);
    scroller.advance();
    expect(f.inner.scrollTop).toBe(2400);
    scroller.advance(true);
    expect(f.inner.scrollTop).toBe(1890);
    scroller.advance();
    expect(f.inner.scrollTop).toBe(2400);
    expect(f.innerScroll.mock.calls.map(([options]) => options.top)).toEqual([
      2400, 2400, 1890, 2400,
    ]);
  });

  it('uses a 400px minimum step, a two-pixel bottom tolerance and never recovers below zero', () => {
    const f = fixture();
    const scroll = geometry(f.inner, 500, 200, 298);
    const scroller = createPlaylistScroller(f.doc);
    scroller.advance(true);
    expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    scroller.advance();
    expect(f.inner.scrollTop).toBe(300);
    expect(scroller.info()?.top).toBe(300);
  });

  it('advances normally during recovery when not yet near the bottom and rounds diagnostics', () => {
    const f = fixture();
    f.inner.scrollTop = 100.4;
    const scroller = createPlaylistScroller(f.doc);
    expect(scroller.info()?.top).toBe(100);
    scroller.advance(true);
    expect(f.innerScroll).toHaveBeenLastCalledWith({
      top: 610.4,
      behavior: 'instant',
    });
  });

  it('finds the list container before any rows have loaded and rediscovers it after replacement', () => {
    const f = fixture();
    f.doc.querySelector('ytd-playlist-video-renderer')!.remove();
    const scroller = createPlaylistScroller(f.doc);
    scroller.advance();
    expect(f.innerScroll).toHaveBeenCalledTimes(1);
    f.inner.replaceWith(f.doc.createElement('article'));
    const replacement = f.doc.querySelector('article')!;
    replacement.style.overflowY = 'scroll';
    replacement.innerHTML =
      '<ytd-playlist-video-list-renderer></ytd-playlist-video-list-renderer>';
    const scroll = geometry(replacement, 2000, 500);
    scroller.advance();
    expect(scroll).toHaveBeenCalledWith({ top: 425, behavior: 'instant' });
    expect(scroller.info()?.container).toBe('article');
  });

  it('handles a missing playlist through document fallback and a missing scrollingElement without throwing', () => {
    const f = fixture();
    f.doc.body.replaceChildren();
    const scroller = createPlaylistScroller(f.doc);
    scroller.advance();
    expect(f.rootScroll).toHaveBeenCalledWith({
      top: 850,
      behavior: 'instant',
    });
    Object.defineProperty(f.doc, 'scrollingElement', {
      configurable: true,
      value: null,
    });
    expect(scroller.info()).toBeNull();
    expect(() => scroller.advance(true)).not.toThrow();
  });
});
