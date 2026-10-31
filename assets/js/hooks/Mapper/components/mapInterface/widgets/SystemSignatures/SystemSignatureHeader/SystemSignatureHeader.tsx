import { useRef } from 'react';
import {
  InfoDrawer,
  LayoutEventBlocker,
  SystemView,
  TooltipPosition,
  WdCheckbox,
  WdImgButton,
} from '@/hooks/Mapper/components/ui-kit';
import { PrimeIcons } from 'primereact/api';
import { CheckboxChangeEvent } from 'primereact/checkbox';
import { WdTooltipWrapper } from '@/hooks/Mapper/components/ui-kit/WdTooltipWrapper';
import useMaxWidth from '@/hooks/Mapper/hooks/useMaxWidth.ts';
import { COMPACT_MAX_WIDTH } from '@/hooks/Mapper/components/mapInterface/widgets/SystemSignatures/constants.ts';
import { useDesktopActiveSystem } from '@/hooks/Mapper/desktop/useDesktopActiveSystem';

export type HeaderProps = {
  sigCount: number;
  lazyDeleteValue: boolean;
  onLazyDeleteChange: (checked: boolean) => void;
  pendingCount: number;
  undoCountdown?: number;
  onUndoClick: () => void;
  onSettingsClick: () => void;
  onAddSignature: () => void;
  addDisabled?: boolean;
  addDisabledReason?: string;
};

export const SystemSignaturesHeader = ({
  sigCount,
  lazyDeleteValue,
  onLazyDeleteChange,
  pendingCount,
  undoCountdown,
  onUndoClick,
  onSettingsClick,
  onAddSignature,
  addDisabled = false,
  addDisabledReason,
}: HeaderProps) => {
  const { systemId } = useDesktopActiveSystem();
  const isNotSelectedSystem = systemId == null;

  const containerRef = useRef<HTMLDivElement>(null);
  const isCompact = useMaxWidth(containerRef, COMPACT_MAX_WIDTH);

  return (
    <div ref={containerRef} className="w-full">
      <div className="flex justify-between items-center text-xs w-full h-full">
        <div className="flex justify-between items-center gap-1">
          {!isCompact && (
            <div className="flex whitespace-nowrap text-ellipsis overflow-hidden text-stone-400">
              {sigCount ? `[${sigCount}] ` : ''}Signatures {isNotSelectedSystem ? '' : 'in'}
            </div>
          )}
          {!isNotSelectedSystem && <SystemView systemId={systemId} className="select-none text-center" hideRegion />}
        </div>

        <LayoutEventBlocker className="flex gap-2.5">
          <WdTooltipWrapper content={addDisabled ? (addDisabledReason ?? 'No active system') : 'Add signature'}>
            <WdImgButton className={PrimeIcons.PLUS} disabled={addDisabled} onClick={onAddSignature} />
          </WdTooltipWrapper>

          <WdTooltipWrapper content="Lazy delete：粘贴信号后，自动删除本次粘贴中没有、但之前存在的信号（删除前可撤销）">
            <WdCheckbox
              size="xs"
              labelSide="left"
              label={isCompact ? '' : 'Lazy delete'}
              value={lazyDeleteValue}
              classNameLabel="text-stone-400 hover:text-stone-200 transition duration-300 whitespace-nowrap text-ellipsis overflow-hidden"
              onChange={(event: CheckboxChangeEvent) => onLazyDeleteChange(!!event.checked)}
            />
          </WdTooltipWrapper>

          {pendingCount > 0 && (
            <WdImgButton
              className={PrimeIcons.UNDO}
              style={{ color: 'red' }}
              tooltip={{
                content: `Undo pending deletions (${pendingCount})${undoCountdown && undoCountdown > 0 ? ` — ${undoCountdown}s left` : ''}`,
              }}
              onClick={onUndoClick}
            />
          )}

          <WdImgButton
            className={PrimeIcons.QUESTION_CIRCLE}
            tooltip={{
              position: TooltipPosition.left,
              content: (
                <div className="flex flex-col gap-1">
                  <InfoDrawer title={<b className="text-slate-50">如何添加/更新信号？</b>}>
                    在游戏内打开 <b className="text-sky-500">扫描器（Probe scanner）</b>，
                    <br />
                    用 <b className="text-sky-500">Shift + 左键</b> 或 <b className="text-sky-500">Ctrl + 左键</b>
                    <br />
                    选中一个或多个信号，<b className="text-sky-500">Ctrl + A</b> 可全选，
                    <br />
                    然后按 <b className="text-sky-500">Ctrl + C</b> 复制。
                    <br />
                    回到这里，先选好星系，再按 <b className="text-sky-500">Ctrl + V</b> 粘贴。
                  </InfoDrawer>
                  <InfoDrawer title={<b className="text-slate-50">如何选择信号？</b>}>
                    点击信号即可选中，
                    <br />
                    <b className="text-sky-500">Shift + 左键</b> 或 <b className="text-sky-500">Ctrl + 左键</b> 可多选。
                  </InfoDrawer>
                  <InfoDrawer title={<b className="text-slate-50">如何删除信号？</b>}>
                    选中信号后按 <b className="text-sky-500">Del</b> 删除。
                  </InfoDrawer>
                  <InfoDrawer title={<b className="text-slate-50">Lazy delete（粘贴后自动删除）</b>}>
                    勾选 <b className="text-sky-500">Lazy delete</b> 后粘贴：
                    <br />
                    本次粘贴中没有、但之前存在的旧信号会被自动删除。
                    <br />
                    删除前有倒计时（设置中可选 <b className="text-sky-500">0 / 10 / 30 秒</b>），
                    <br />
                    倒计时内点顶部红色撤销按钮或按 <b className="text-sky-500">Ctrl + Z</b> 可恢复。
                    <br />
                    默认只对下一次粘贴生效；在设置中开启
                    <br />
                    <b className="text-sky-500">Keep &quot;Lazy delete&quot; Enabled</b> 可保持常开。
                  </InfoDrawer>
                </div>
              ),
            }}
          />

          <WdImgButton className={PrimeIcons.SLIDERS_H} onClick={onSettingsClick} />
        </LayoutEventBlocker>
      </div>
    </div>
  );
};
