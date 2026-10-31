import Topbar from '@/hooks/Mapper/components/topbar/Topbar.tsx';
import { MapInterface } from '@/hooks/Mapper/components/mapInterface/MapInterface.tsx';
import Layout from '@/hooks/Mapper/components/layout/Layout.tsx';
import { MapWrapper } from '@/hooks/Mapper/components/mapWrapper/MapWrapper.tsx';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { useCallback, useEffect, useState } from 'react';
import { OnTheMap, RightBar } from '@/hooks/Mapper/components/mapRootContent/components';
import { MapContextMenu } from '@/hooks/Mapper/components/mapRootContent/components/MapContextMenu/MapContextMenu.tsx';
import { useSkipContextMenu } from '@/hooks/Mapper/hooks/useSkipContextMenu';
import { MapSettings } from '@/hooks/Mapper/components/mapRootContent/components/MapSettings';
import { CharacterActivity } from '@/hooks/Mapper/components/mapRootContent/components/CharacterActivity';
import { WormholeSignaturesDialog } from '@/hooks/Mapper/components/mapRootContent/components/WormholeSignaturesDialog';
import { useCharacterActivityHandlers } from './hooks/useCharacterActivityHandlers';
import { TrackingDialog } from '@/hooks/Mapper/components/mapRootContent/components/TrackingDialog';
import { useMapEventListener } from '@/hooks/Mapper/events';
import { Commands } from '@/hooks/Mapper/types';
import { PingsInterface } from '@/hooks/Mapper/components/mapInterface/components';
import { OldSettingsDialog } from '@/hooks/Mapper/components/mapRootContent/components/OldSettingsDialog.tsx';
import { TopSearch } from '@/hooks/Mapper/components/mapRootContent/components/TopSearch';
import { ViewModeSelector } from '@/hooks/Mapper/components/mapRootContent/components/ViewModeSelector';
import { SubscribeReminderDialog } from '@/hooks/Mapper/components/mapRootContent/components/SubscribeReminderDialog';
import { DEFAULT_WIDGETS, WidgetsIds } from '@/hooks/Mapper/components/mapInterface/constants.tsx';
import { DesktopMainBar } from '@/hooks/Mapper/desktop/DesktopMainBar';
import { DesktopWidgetBar } from '@/hooks/Mapper/desktop/DesktopWidgetBar';
import { DesktopWidget } from '@/hooks/Mapper/desktop/types';
import { useDesktopBridgeState } from '@/hooks/Mapper/desktop/useDesktopBridge';
import { setSharedSelectedSystem } from '@/hooks/Mapper/desktop/selectedSystemStore';

const DESKTOP_WIDGET_IDS: Record<DesktopWidget, WidgetsIds> = {
  signatures: WidgetsIds.signatures,
  jspace: WidgetsIds.jspace,
  bookmarks: WidgetsIds.bookmarks,
  kills: WidgetsIds.kills,
  characters: WidgetsIds.local,
};

export interface MapRootContentProps {}

// eslint-disable-next-line no-empty-pattern
export const MapRootContent = ({}: MapRootContentProps) => {
  const {
    storedSettings: { interfaceSettings, isReady, hasOldSettings },
    data,
  } = useMapRootState();
  const { isShowMenu } = interfaceSettings;
  const { showCharacterActivity, selectedSystems } = data;
  const { handleHideCharacterActivity } = useCharacterActivityHandlers();
  const { info: desktopInfo } = useDesktopBridgeState();

  // A widget window can switch which widget it shows in place (see
  // DesktopWidgetBar), so the user only needs to pin one small window. The
  // window itself, its route and its Tauri label stay what it was opened with.
  const initialDesktopWidget =
    desktopInfo.active && desktopInfo.mode === 'widget' ? (desktopInfo.widget ?? 'signatures') : null;
  const [desktopWidget, setDesktopWidget] = useState<DesktopWidget | null>(initialDesktopWidget);

  const themeClass = `${interfaceSettings.theme ?? 'default'}-theme`;

  const [showOnTheMap, setShowOnTheMap] = useState(false);
  const [showMapSettings, setShowMapSettings] = useState(false);
  const [showTrackingDialog, setShowTrackingDialog] = useState(false);
  const [showWormholeList, setShowWormholeList] = useState(false);

  // Desktop main window shows widgets as separate Tauri windows, so the web
  // layout stored in `windowsSettings` must not be rendered inline here.
  // Detached widget windows have their own branch below and never mount
  // MapInterface anyway.
  const desktopMain = desktopInfo.active && desktopInfo.mode === 'main';

  // Detached windows have no map, so they cannot know which system the user is
  // looking at in the main window. Publish the main selection for the widgets
  // to use as a follow fallback (see `useDesktopActiveSystem`).
  useEffect(() => {
    if (!desktopMain) {
      return;
    }

    setSharedSelectedSystem(selectedSystems.length === 1 ? selectedSystems[0] : null);
  }, [desktopMain, selectedSystems]);

  /* Important Notice - this solution needs for use one instance of MapInterface */
  const mapInterface = isReady && !desktopMain ? <MapInterface /> : null;

  const handleShowOnTheMap = useCallback(() => setShowOnTheMap(true), []);
  const handleShowMapSettings = useCallback(() => setShowMapSettings(true), []);
  const handleShowTrackingDialog = useCallback(() => setShowTrackingDialog(true), []);
  const handleShowWormholesReference = useCallback(() => setShowWormholeList(true), []);

  useMapEventListener(event => {
    if (event.name === Commands.showTracking) {
      setShowTrackingDialog(true);
      return true;
    }
  });

  useSkipContextMenu();

  if (desktopWidget) {
    const widgetId = DESKTOP_WIDGET_IDS[desktopWidget];
    const widgetProps = DEFAULT_WIDGETS.find(item => item.id === widgetId);

    return (
      <div className={`${themeClass} h-full w-full`}>
        <div className="flex h-full w-full flex-col overflow-hidden bg-stone-950">
          <DesktopWidgetBar widget={desktopWidget} onSwitch={setDesktopWidget} />

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {/* No MapWrapper here: map_event processing lives in MapRoot's
                command handler, so a detached widget gets live data without
                paying for a hidden React Flow graph. */}
            {isReady ? (
              widgetProps ? (
                widgetProps.content(widgetProps)
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-stone-400">
                  Unknown widget
                </div>
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-stone-400">
                Loading map...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={themeClass}>
      <Layout map={<MapWrapper />}>
        {!isShowMenu ? (
          <div className="absolute top-0 left-14 w-[calc(100%-3.5rem)] h-[calc(100%-3.5rem)] pointer-events-none">
            <div className="absolute top-0 left-0 w-[calc(100%-3.5rem)] h-full pointer-events-none">
              <Topbar>
                <div className="flex items-center ml-1 pointer-events-auto">
                  <ViewModeSelector />
                </div>
              </Topbar>
              {mapInterface}
            </div>
            <div className="absolute top-0 right-0 w-14 h-[calc(100%+3.5rem)] pointer-events-auto">
              <RightBar
                onShowOnTheMap={handleShowOnTheMap}
                onShowMapSettings={handleShowMapSettings}
                onShowTrackingDialog={handleShowTrackingDialog}
                onShowWormholesReference={handleShowWormholesReference}
                additionalContent={<PingsInterface hasLeftOffset />}
              />
            </div>
          </div>
        ) : (
          <div className="absolute top-0 left-14 w-[calc(100%-3.5rem)] h-[calc(100%-3.5rem)] pointer-events-none">
            <Topbar>
              <div className="flex items-center ml-1">
                <TopSearch />
                <ViewModeSelector />
                <PingsInterface />
                <MapContextMenu
                  onShowOnTheMap={handleShowOnTheMap}
                  onShowMapSettings={handleShowMapSettings}
                  onShowTrackingDialog={handleShowTrackingDialog}
                  onShowWormholesReference={handleShowWormholesReference}
                />
              </div>
            </Topbar>
            {mapInterface}
          </div>
        )}
        {desktopInfo.active && <DesktopMainBar />}

        <OnTheMap show={showOnTheMap} onHide={() => setShowOnTheMap(false)} />
        {showMapSettings && <MapSettings visible={showMapSettings} onHide={() => setShowMapSettings(false)} />}
        {showCharacterActivity && (
          <CharacterActivity visible={showCharacterActivity} onHide={handleHideCharacterActivity} />
        )}
        {showTrackingDialog && (
          <TrackingDialog visible={showTrackingDialog} onHide={() => setShowTrackingDialog(false)} />
        )}
        <WormholeSignaturesDialog visible={showWormholeList} onHide={() => setShowWormholeList(false)} />

        <SubscribeReminderDialog />

        {hasOldSettings && <OldSettingsDialog />}
      </Layout>
    </div>
  );
};
