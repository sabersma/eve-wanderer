import { Widget } from '@/hooks/Mapper/components/mapInterface/components';
import { SETTINGS_KEYS, SIGNATURE_WINDOW_ID, SignatureSettingsType } from '@/hooks/Mapper/constants/signatures';
import { useHotkey } from '@/hooks/Mapper/hooks/useHotkey';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { useCallback, useMemo, useState } from 'react';
import { useSignatureUndo } from './hooks/useSignatureUndo';
import { useSystemSignaturesData } from './hooks/useSystemSignaturesData';
import { SystemSignaturesHeader } from './SystemSignatureHeader';
import { SystemSignaturesContent } from './SystemSignaturesContent';
import { SystemSignatureSettingsDialog } from './SystemSignatureSettingsDialog';
import { SignatureSettings } from '@/hooks/Mapper/components/mapRootContent/components/SignatureSettings';
import { useDesktopActiveSystem } from '@/hooks/Mapper/desktop/useDesktopActiveSystem';

export const SystemSignatures = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [showAddSignature, setShowAddSignature] = useState(false);

  const {
    outCommand,
    storedSettings: { settingsSignatures, settingsSignaturesUpdate },
  } = useMapRootState();

  // Follows the last active EVE client inside a desktop widget window; on the
  // web (and with follow disabled) this is the current map selection. A
  // detached widget also falls back to the main window's selection.
  const { systemId, lastEve, followEnabled, matchedCharacter } = useDesktopActiveSystem();
  const isSystemSelected = systemId != null;

  // The widget has no map of its own, so "no system" is expected until EVE
  // follow resolves (or the user selects a system in the main window). Explain
  // it instead of leaving the + button silently doing nothing.
  const noSystemHint = (() => {
    if (!followEnabled) {
      return '跟随已关闭。请在顶部工具条开启“跟随”，或在主图选择一个星系。';
    }
    if (!lastEve) {
      return '等待 EVE 客户端激活；也可以先在主图选择一个星系。';
    }
    if (!matchedCharacter) {
      return `未在地图中匹配到角色「${lastEve.title}」；请在主图选择一个星系。`;
    }
    if (!matchedCharacter.location?.solar_system_id) {
      return `${matchedCharacter.name} 的位置还未同步，请稍候，或先在主图选择一个星系。`;
    }
    return '请先在主图选择一个星系。';
  })();

  const handleLazyDeleteToggle = useCallback(
    (value: boolean) => {
      settingsSignaturesUpdate(prev => ({
        ...prev,
        [SETTINGS_KEYS.LAZY_DELETE_SIGNATURES]: value,
      }));
    },
    [settingsSignaturesUpdate],
  );

  const {
    signatures,
    selectedSignatures,
    setSelectedSignatures,
    handleDeleteSelected,
    handleDeleteSignatures,
    handleSelectAll,
    handlePaste,
    hasUnsupportedLanguage,
  } = useSystemSignaturesData({
    systemId: systemId ?? '',
    settings: settingsSignatures,
    onLazyDeleteChange: handleLazyDeleteToggle,
  });

  const sigCount = useMemo(() => signatures.length, [signatures]);
  const deletedSignatures = useMemo(() => signatures.filter(s => s.deleted), [signatures]);

  const { countdown, handleUndo } = useSignatureUndo(systemId, settingsSignatures, deletedSignatures, outCommand);

  useHotkey(true, ['z', 'Z'], (event: KeyboardEvent) => {
    if (deletedSignatures.length > 0 && countdown > 0) {
      event.preventDefault();
      event.stopPropagation();
      handleUndo();
    }
  });

  const handleSettingsSave = useCallback(
    (newSettings: SignatureSettingsType) => {
      settingsSignaturesUpdate(newSettings);
      setShowSettings(false);
    },
    [settingsSignaturesUpdate],
  );

  const openSettings = useCallback(() => setShowSettings(true), []);

  return (
    <Widget
      label={
        <SystemSignaturesHeader
          sigCount={sigCount}
          lazyDeleteValue={settingsSignatures[SETTINGS_KEYS.LAZY_DELETE_SIGNATURES] as boolean}
          pendingCount={deletedSignatures.length}
          undoCountdown={countdown}
          onLazyDeleteChange={handleLazyDeleteToggle}
          onUndoClick={handleUndo}
          onSettingsClick={openSettings}
          onAddSignature={() => setShowAddSignature(true)}
          addDisabled={!isSystemSelected}
          addDisabledReason={noSystemHint}
        />
      }
      windowId={SIGNATURE_WINDOW_ID}
    >
      {!isSystemSelected ? (
        <div className="w-full h-full flex flex-col gap-2 justify-center items-center select-none text-center px-3">
          <span className="text-stone-400/80 text-sm">System is not selected</span>
          <span className="text-stone-500 text-xs leading-relaxed">{noSystemHint}</span>
        </div>
      ) : (
        <SystemSignaturesContent
          systemId={systemId}
          signatures={signatures}
          selectedSignatures={selectedSignatures}
          onSelectSignatures={setSelectedSignatures}
          onDeleteSelected={handleDeleteSelected}
          onDeleteSignatures={handleDeleteSignatures}
          onSelectAll={handleSelectAll}
          onPaste={handlePaste}
          hasUnsupportedLanguage={hasUnsupportedLanguage}
          settings={settingsSignatures}
        />
      )}

      {showSettings && (
        <SystemSignatureSettingsDialog
          settings={settingsSignatures}
          onCancel={() => setShowSettings(false)}
          onSave={handleSettingsSave}
        />
      )}

      {showAddSignature && isSystemSelected && (
        <SignatureSettings
          systemId={systemId}
          show
          onHide={() => setShowAddSignature(false)}
          signatureData={undefined}
        />
      )}
    </Widget>
  );
};

export default SystemSignatures;
