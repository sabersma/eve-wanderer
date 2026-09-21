import ImageZoom from './imageZoom';

// The manuals are injected as raw HTML, so the hook is driven by a container
// with screenshots inside it. These tests mount it the way LiveView does.
const mount = ({ linked = false, inMain = true } = {}) => {
  const image = linked
    ? '<a href="/elsewhere"><img src="/images/manual/a.png" alt="图 A"></a>'
    : '<img src="/images/manual/a.png" alt="图 A">' +
      '<p><img src="/images/manual/b.png" alt="图 B"></p>';

  document.body.innerHTML = inMain
    ? `<main style="overflow: auto"><article id="manual-body">${image}</article></main>`
    : `<article id="manual-body">${image}</article>`;

  const el = document.querySelector('#manual-body') as HTMLElement;
  const context = { el };
  ImageZoom.mounted.call(context);

  return { el, context };
};

const overlay = () => document.querySelector('.image-zoom') as HTMLElement;
const overlayImage = () => overlay().querySelector('img') as HTMLImageElement;
const click = (target: Element | null) => {
  // querySelector is nullable; failing loudly beats a silent no-op assertion.
  if (!target) throw new Error('nothing to click');
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ImageZoom', () => {
  it('opens the overlay with the screenshot that was clicked', () => {
    mount();
    expect(overlay()).toBeNull();

    click(document.querySelectorAll('img')[1]);

    expect(overlay().classList.contains('image-zoom--open')).toBe(true);
    expect(overlayImage().src).toContain('/images/manual/b.png');
    expect(overlayImage().alt).toBe('图 B');
  });

  it('hijacks clicks on a screenshot nested in a paragraph', () => {
    // The Markdown wraps each image in <p>, so the click target is the <img>
    // but the event bubbles from the paragraph.
    mount();
    const nested = document.querySelector('p img') as HTMLImageElement;

    nested.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(overlay().classList.contains('image-zoom--open')).toBe(true);
  });

  it('leaves a linked screenshot to the link', () => {
    mount({ linked: true });

    click(document.querySelector('img'));

    expect(overlay()).toBeNull();
  });

  it('toggles between fit and 100% when the overlay image is clicked', () => {
    mount();
    click(document.querySelector('img'));

    expect(overlay().classList.contains('image-zoom--actual')).toBe(false);

    click(overlayImage());
    expect(overlay().classList.contains('image-zoom--actual')).toBe(true);

    click(overlayImage());
    expect(overlay().classList.contains('image-zoom--actual')).toBe(false);
  });

  it('closes on a backdrop click and on Escape', () => {
    const { context } = mount();

    click(document.querySelector('img'));
    click(overlay());
    expect(overlay().classList.contains('image-zoom--open')).toBe(false);

    click(document.querySelector('img'));
    press('Escape');
    expect(overlay().classList.contains('image-zoom--open')).toBe(false);

    // The teardown listener is still only registered once.
    ImageZoom.destroyed.call(context);
    expect(document.querySelectorAll('.image-zoom')).toHaveLength(0);
  });

  it('switching tabs keeps one overlay, not one per tab', () => {
    // LiveView replaces the article's contents on a tab switch and keeps the
    // element, so mounted() must not run twice.
    const { el } = mount();
    click(document.querySelector('img'));
    press('Escape');

    el.innerHTML = '<img src="/images/manual/c.png" alt="图 C">';
    click(document.querySelector('img'));

    expect(document.querySelectorAll('.image-zoom')).toHaveLength(1);
    expect(overlayImage().src).toContain('/images/manual/c.png');
  });

  it('locks page scrolling while open and restores it after', () => {
    // <main> scrolls, not <body> — locking body would do nothing.
    mount();
    const main = document.querySelector('main') as HTMLElement;
    main.style.overflow = 'auto';

    click(document.querySelector('img'));
    expect(main.style.overflow).toBe('hidden');

    press('Escape');
    expect(main.style.overflow).toBe('auto');
  });

  it('cleans up its listeners and overlay on destroy', () => {
    const { context } = mount();
    click(document.querySelector('img'));

    ImageZoom.destroyed.call(context);

    expect(document.querySelectorAll('.image-zoom')).toHaveLength(0);

    // A later click must not resurrect it.
    document.body.innerHTML = '<article id="manual-body"><img src="/x.png"></article>';
    click(document.querySelector('img'));
    expect(document.querySelectorAll('.image-zoom')).toHaveLength(0);
  });

  it('falls back to <body> when there is no <main>', () => {
    mount({ inMain: false });
    const body = document.body;
    body.style.overflow = 'visible';

    click(document.querySelector('img'));
    expect(body.style.overflow).toBe('hidden');

    press('Escape');
    expect(body.style.overflow).toBe('visible');
  });
});
