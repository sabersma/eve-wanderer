import clsx from 'clsx';
import { getSystemStaticInfo } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { TooltipPosition, WdTooltipWrapper } from '@/hooks/Mapper/components/ui-kit';
import { MARKER_BOOKMARK_BG_STYLES } from '@/hooks/Mapper/components/map/constants';
import { useNodeOverlap } from '@/hooks/Mapper/components/map/MapOverlapProvider';
import classes from './SolarSystemNodeDefault.module.scss';

const labelOf = (id: string) => getSystemStaticInfo(id)?.solar_system_name ?? id;

/**
 * Warning marker shown on a node that visually collides with one or more other
 * systems. This is the catch-all for overlaps the layout could not prevent —
 * manual drags, another user's move, locked systems — so it must never be the
 * thing that blocks the interaction, only the thing that reports it.
 */
export const OverlapBookmark = ({ solarSystemId }: { solarSystemId: string }) => {
  const overlapping = useNodeOverlap(solarSystemId);

  if (!overlapping || overlapping.length === 0) {
    return null;
  }

  const content =
    overlapping.length === 1
      ? `与 ${labelOf(overlapping[0])} 重叠`
      : `与 ${overlapping.map(labelOf).join('、')} 重叠`;

  return (
    <div className={clsx(classes.Bookmark, MARKER_BOOKMARK_BG_STYLES.overlap, '!pr-[3px]')}>
      <WdTooltipWrapper content={content} position={TooltipPosition.top}>
        <span className="block w-[10px] h-[10px] leading-[10px] text-center font-bold text-[10px] [text-shadow:_0_1px_0_rgb(0_0_0_/_40%)]">
          !
        </span>
      </WdTooltipWrapper>
    </div>
  );
};
