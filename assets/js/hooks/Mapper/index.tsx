import { createRoot } from 'react-dom/client';
import Mapper from './MapRoot';
import { initDesktopBridge } from './desktop';
import type { DesktopWidget } from './desktop/types';

const LAST_VERSION_KEY = 'wandererLastVersion';
const UI_LOADED_EVENT = 'ui_loaded';

export default {
  _rootEl: null,
  _errorCount: 0,

  mounted() {
    // create react root element
    const rootEl = document.getElementById(this.el.id);
    const activeVersion = localStorage.getItem(LAST_VERSION_KEY);
    this._rootEl = createRoot(rootEl!);

    const widget = (this.el.dataset.widget || null) as DesktopWidget | null;

    initDesktopBridge({
      active: this.el.dataset.desktop === 'true',
      mode: widget ? 'widget' : 'main',
      widget,
      mapSlug: this.el.dataset.mapSlug || null,
    });

    const handleError = (error: Error, componentStack: string) => {
      this.pushEvent('log_map_error', { error: error.message, componentStack });
    };

    this.render({
      handleEvent: this.handleEventWrapper.bind(this),
      pushEvent: this.pushEvent.bind(this),
      pushEventAsync: this.pushEventAsync.bind(this),
      onError: handleError,
    });

    void window.__wandererDesktop?.ready();

    this.pushEvent(UI_LOADED_EVENT, { version: activeVersion });
  },

  handleEventWrapper(event: string, handler: (payload: any) => void) {
    this.handleEvent(event, (body: any) => {
      handler(body);
    });
  },

  reconnected() {
    const activeVersion = localStorage.getItem(LAST_VERSION_KEY);
    void window.__wandererDesktop?.ready();
    this.pushEvent(UI_LOADED_EVENT, { version: activeVersion });
  },

  async pushEventAsync(event: string, payload: any) {
    return new Promise((accept, reject) => {
      this.pushEvent(event, payload, reply => {
        accept(reply);
      });
    });
  },

  render(hooks) {
    this._rootEl.render(<Mapper hooks={hooks} />);
  },

  destroyed() {
    this._rootEl.unmount();
  },
};
