/**
 * Click a screenshot in the manual to see it enlarged.
 *
 * The manuals are rendered from Markdown at compile time and injected as raw
 * HTML, so the images carry no per-image attributes. They are matched by
 * delegation from the container this hook sits on, which means adding or
 * removing a screenshot in the Markdown needs no change here.
 *
 * Styling lives in assets/css/app.css under `.image-zoom`.
 */

const OPEN_CLASS = 'image-zoom--open';
const ACTUAL_CLASS = 'image-zoom--actual';

// Teardown per element, kept out of the hook object so instances stay
// independent and a LiveView navigation leaves nothing behind.
const teardowns = new WeakMap<HTMLElement, () => void>();

// LiveView supplies `el`; annotating `this` is what types it, since an object
// literal otherwise infers a `this` with no `el` on it. (The sibling hooks hit
// exactly that, which is where their tsc errors come from.)
type ImageZoomHook = {
  el: HTMLElement;
};

type Overlay = {
  root: HTMLDivElement;
  image: HTMLImageElement;
};

export default {
  mounted(this: ImageZoomHook) {
    const el = this.el;

    let ui: Overlay | null = null;
    let scrollHost: HTMLElement | null = null;
    let previousOverflow = '';

    const hide = () => {
      if (!ui) return;
      ui.root.classList.remove(OPEN_CLASS, ACTUAL_CLASS);
      if (scrollHost) {
        scrollHost.style.overflow = previousOverflow;
        scrollHost = null;
      }
    };

    const build = () => {
      const overlay = document.createElement('div');
      overlay.className = 'image-zoom';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '图片预览');

      const image = document.createElement('img');

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'image-zoom__close';
      close.setAttribute('aria-label', '关闭');
      close.textContent = '×';

      overlay.append(image, close);

      // Straight onto <body>: an ancestor with overflow or a transform would
      // otherwise clip, or re-anchor, a position:fixed overlay.
      document.body.append(overlay);

      overlay.addEventListener('click', event => {
        // Clicking the screenshot itself toggles between "whole thing on
        // screen" and "100%", which is the only way to read the UI text in a
        // 2500px-wide screenshot. Anything else (backdrop, ×) closes.
        if (event.target === image) {
          overlay.classList.toggle(ACTUAL_CLASS);
        } else {
          hide();
        }
      });

      return { root: overlay, image };
    };

    const show = (source: HTMLImageElement) => {
      // Built once, on the first screenshot the reader opens.
      const view = ui ?? (ui = build());

      view.image.src = source.currentSrc || source.src;
      view.image.alt = source.alt;
      view.root.classList.remove(ACTUAL_CLASS);
      view.root.classList.add(OPEN_CLASS);

      // The page scrolls in <main>, not <body>, so lock whichever it is.
      scrollHost = el.closest('main') || document.body;
      previousOverflow = scrollHost.style.overflow;
      scrollHost.style.overflow = 'hidden';
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== 'IMG') return;
      // Leave a screenshot alone if the author ever links one somewhere.
      if (target.closest('a')) return;
      show(target as HTMLImageElement);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    el.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);

    teardowns.set(el, () => {
      el.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeydown);
      hide();
      if (ui) {
        ui.root.remove();
        ui = null;
      }
    });
  },

  destroyed(this: ImageZoomHook) {
    teardowns.get(this.el)?.();
    teardowns.delete(this.el);
  },
};
