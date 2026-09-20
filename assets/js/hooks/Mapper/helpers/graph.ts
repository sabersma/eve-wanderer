import { SolarSystemConnection } from '@/hooks/Mapper/types';

/**
 * Build an undirected adjacency list from connections.
 * Each system ID maps to a Set of connected system IDs.
 */
export function buildAdjacencyList(connections: SolarSystemConnection[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  for (const conn of connections) {
    if (!adj.has(conn.source)) adj.set(conn.source, new Set());
    if (!adj.has(conn.target)) adj.set(conn.target, new Set());
    adj.get(conn.source)!.add(conn.target);
    adj.get(conn.target)!.add(conn.source);
  }

  return adj;
}

/**
 * BFS from all seed nodes, traversing through the adjacency list.
 * Returns the set of all reachable system IDs (including the seeds themselves).
 */
export function bfsReachable(seeds: string[], adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const seed of seeds) {
    if (!visited.has(seed)) {
      visited.add(seed);
      queue.push(seed);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * The connected component containing `startId` — the cluster of systems joined
 * to it by connections, not a rectangular region of the canvas.
 *
 * `allowedIds` restricts the traversal: a system the user cannot currently see
 * is not part of the cluster in front of them, so it is neither selected nor
 * traversed through.
 *
 * Returns an empty set when `startId` itself is not allowed.
 */
export function findConnectedComponent(
  startId: string,
  connections: SolarSystemConnection[],
  allowedIds?: Set<string>,
): Set<string> {
  if (allowedIds != null && !allowedIds.has(startId)) return new Set();

  const adjacency = buildAdjacencyList(connections);
  const blocked = (id: string) => allowedIds != null && !allowedIds.has(id);

  const component = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const neighbor of adjacency.get(current) ?? []) {
      if (component.has(neighbor) || blocked(neighbor)) continue;

      component.add(neighbor);
      queue.push(neighbor);
    }
  }

  return component;
}
