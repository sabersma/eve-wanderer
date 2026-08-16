import usePageVisibility from '@/hooks/Mapper/hooks/usePageVisibility.ts';
import debounce from 'lodash.debounce';

import { MapHandlers } from '@/hooks/Mapper/types/mapHandlers.ts';
import { RefObject, useCallback, useEffect, useRef } from 'react';

// const inIndex = 0;
// const prevEventTime = +new Date();
const LAST_VERSION_KEY = 'wandererLastVersion';

// @ts-ignore
export const useMapperHandlers = (handlerRefs: RefObject<MapHandlers>[], hooksRef: RefObject<any>) => {
  const visible = usePageVisibility();

  const wasHiddenOnce = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // TODO - do not delete THIS code it needs for debug
  // const [record, setRecord] = useLocalStorageState<boolean>('record', {
  //   defaultValue: false,
  // });
  // const [recordsList, setRecordsList] = useLocalStorageState<{ type; data }[]>('recordsList', {
  //   defaultValue: [],
  // });
  //
  // const ref = useRef({ record, setRecord, recordsList, setRecordsList });
  // ref.current = { record, setRecord, recordsList, setRecordsList };
  //
  // const recordBufferRef = useRef<{ type; data }[]>([]);
  // useEffect(() => {
  //   if (record || recordBufferRef.current.length === 0) {
  //     return;
  //   }
  //
  //   ref.current.setRecordsList([...recordBufferRef.current]);
  //   recordBufferRef.current = [];
  // }, [record]);

  const handleCommand = useCallback(
    // @ts-ignore
    async ({ type, data }) => {
      if (!hooksRef.current) {
        return;
      }

      // TODO - do not delete THIS code it needs for debug
      // console.log('JOipP', `OUT`, ref.current.record, { type, data });
      // if (ref.current.record) {
      //   recordBufferRef.current.push({ type, data });
      // }

      // 'ui_loaded'
      return await hooksRef.current.pushEventAsync(type, data);
    },
    [hooksRef.current],
  );

  // @ts-ignore
  const eventsBufferRef = useRef<{ type; body }[]>([]);

  const eventTick = useCallback(
    debounce(() => {
      if (eventsBufferRef.current.length === 0) {
        return;
      }

      const { type, body } = eventsBufferRef.current.shift()!;
      handlerRefs.forEach(ref => {
        if (!ref.current) {
          return;
        }

        ref.current?.command(type, body);
      });

      // TODO - do not delete THIS code it needs for debug
      // console.log('JOipP', `Tick Buff`, eventsBufferRef.current.length);

      if (eventsBufferRef.current.length > 0) {
        eventTick();
      }
    }, 10),
    [],
  );
  const eventTickRef = useRef(eventTick);
  eventTickRef.current = eventTick;

  // @ts-ignore
  const handleMapEvent = useCallback(({ type, body }) => {
    // TODO - do not delete THIS code it needs for debug
    // const currentTime = +new Date();
    // const timeDiff = currentTime - prevEventTime;
    // prevEventTime = currentTime;
    // console.log('JOipP', `IN [${inIndex++}] [${timeDiff}] ${getFormattedTime()}`, { type, body });

    if (!eventTickRef.current) {
      return;
    }

    // Always process full-reset "init" events (e.g. the re-fetch pushed after
    // the window regains focus) even while hidden, so a restore that races with
    // the visibility flag never drops the fresh map state. Everything else is
    // still dropped while hidden to avoid rendering work in a background tab.
    if (!visibleRef.current && type !== 'init') {
      return;
    }

    eventsBufferRef.current.push({ type, body });
    eventTickRef.current();
  }, []);

  useEffect(() => {
    if (!visible && !wasHiddenOnce.current) {
      wasHiddenOnce.current = true;
      return;
    }

    if (!wasHiddenOnce.current) {
      return;
    }

    if (!visible) {
      return;
    }

    hooksRef.current.pushEventAsync('ui_loaded', { version: localStorage.getItem(LAST_VERSION_KEY) });
  }, [hooksRef.current, visible]);

  // `document.hidden` (visibilitychange) does not change when the browser window
  // is minimized (only on tab switch). Use blur/focus as an additional trigger so
  // minimizing + restoring the window also re-fetches the map via ui_loaded.
  const windowBlurred = useRef(false);

  useEffect(() => {
    const handleBlur = () => {
      windowBlurred.current = true;
    };

    const handleFocus = () => {
      if (!windowBlurred.current) return;
      windowBlurred.current = false;
      hooksRef.current.pushEventAsync('ui_loaded', { version: localStorage.getItem(LAST_VERSION_KEY) });
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [hooksRef.current]);

  return { handleCommand, handleMapEvent };
};
