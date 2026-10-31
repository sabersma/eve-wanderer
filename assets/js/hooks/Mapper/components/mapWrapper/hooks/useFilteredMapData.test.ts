import { SolarSystemConnection, SolarSystemRawType } from '@/hooks/Mapper/types';
import { computeVisibleSystemIds } from './useFilteredMapData';

const systems = ['1', '2', '3', '4'].map(id => ({ id }) as SolarSystemRawType);
const connections = [
  { source: '1', target: '2' },
  { source: '2', target: '3' },
] as SolarSystemConnection[];

describe('computeVisibleSystemIds', () => {
  it('shows every system in the global view', () => {
    expect([...computeVisibleSystemIds(systems, connections, 'all', [], [], [])].sort()).toEqual(['1', '2', '3', '4']);
  });

  it('renders nothing before the first subscription', () => {
    expect(computeVisibleSystemIds(systems, connections, 'home', [], [], []).size).toBe(0);
  });

  it('walks the connected cluster from a subscription', () => {
    expect([...computeVisibleSystemIds(systems, connections, 'home', ['2'], [], [])].sort()).toEqual(['1', '2', '3']);
  });

  it('keeps a desktop follow seed visible without a subscription', () => {
    expect([...computeVisibleSystemIds(systems, connections, 'home', [], [], [], false, ['2'])].sort()).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('keeps an isolated desktop follow seed visible', () => {
    expect([...computeVisibleSystemIds(systems, connections, 'home', [], [], [], false, ['4'])].sort()).toEqual(['4']);
  });

  it('honours the follow seed even when unsubscribed clusters are hidden', () => {
    expect([...computeVisibleSystemIds(systems, connections, 'home', ['2'], [], [], true, ['4'])].sort()).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  it('leaves the web hide mode unchanged when there is no extra seed', () => {
    expect([...computeVisibleSystemIds(systems, connections, 'home', ['1'], [], [], true)].sort()).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});
