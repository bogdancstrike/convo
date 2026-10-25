/**
 * Group topics (specs §30.4): named, closeable views inside an existing group. They share the
 * group's membership and keys; messages carry a stable topic ID. Owners/admins define topics with
 * revisioned E2EE events; every member applies the same rule (highest revision per topic wins, ties
 * keep the current value), so all devices converge regardless of delivery order.
 */
export interface Topic { id: string; name: string; closed: boolean; revision: number }

export const MAX_TOPICS = 50;
export const MAX_TOPIC_NAME = 48;

/** Applies a topic definition; returns the same array when nothing changes. */
export function applyTopic(topics: Topic[] | undefined, next: Topic): Topic[] {
  const list = topics ?? [];
  const current = list.find((t) => t.id === next.id);
  if (current && current.revision >= next.revision) return list;
  if (!current && list.length >= MAX_TOPICS) return list;
  const clean = { id: next.id, name: next.name.trim().slice(0, MAX_TOPIC_NAME), closed: next.closed, revision: next.revision };
  return current ? list.map((t) => (t.id === next.id ? clean : t)) : [...list, clean];
}

/** Whether a member may post into a topic (closed topics are read-only for everyone but admins). */
export function canPostInTopic(topic: Topic | undefined, isAdmin: boolean): boolean {
  return !topic || !topic.closed || isAdmin;
}
