// Adaptateur de l'aperçu uniquement. Les rendus importent Remotion directement.
// Les attentes appartiennent à leur producteur, jamais à une heure de création.
import React, { forwardRef, useContext, useLayoutEffect, useMemo, useRef } from 'react';
// @ts-ignore résolu par lib/player-build.mjs vers le Remotion du projet
import * as R from '@coulisses-remotion';
// @ts-ignore
export * from '@coulisses-remotion';

type Lease = { unblock: () => void };
type Request = { released: boolean; native: Lease | null };
type Owner = {
  id: number; kind: string; visible: boolean; committed: boolean; disposed: boolean;
  requests: Set<Request>; handles: Set<number>; buffer: { delayPlayback: () => Lease };
  render: { continueRender: (handle: number) => void } | null;
};
const owners = new Map<number, Owner>(), subscribers = new Set<() => void>();
let nextOwner = 0;
const changed = () => {
  for (const fn of subscribers) fn();
  window.dispatchEvent(new CustomEvent('coulisses-readiness'));
};
const snapshot = () => {
  const pending = [...owners.values()].filter((o) => o.requests.size || o.handles.size)
    .map((o) => ({ id: o.id, kind: o.kind, visible: o.visible, handles: [...o.handles], requests: o.requests.size }));
  const tracked = new Set([...owners.values()].flatMap((o) => [...o.handles]));
  const legacy: number[] = Array.isArray((window as any).remotion_delayRenderHandles) ? (window as any).remotion_delayRenderHandles : [];
  return { pending, activePending: pending.filter((o) => o.visible).length, legacyPending: legacy.filter((h) => !tracked.has(h)) };
};
(window as any).__coulissesReadiness = {
  snapshot,
  subscribe(fn: () => void) { subscribers.add(fn); return () => subscribers.delete(fn); },
};
function release(owner: Owner, request: Request) {
  if (request.released) return;
  request.released = true; request.native?.unblock(); request.native = null;
  owner.requests.delete(request); changed();
}
function synchronize(owner: Owner) {
  for (const request of owner.requests) {
    if (owner.committed && owner.visible && !owner.disposed && !request.native) request.native = owner.buffer.delayPlayback();
    else if ((!owner.visible || owner.disposed) && request.native) { request.native.unblock(); request.native = null; }
  }
  changed();
}
function acquire(owner: Owner): Lease {
  if (owner.disposed) return { unblock() {} };
  const request: Request = { released: false, native: null };
  owner.requests.add(request); synchronize(owner);
  return { unblock: () => release(owner, request) };
}
function useOwner(kind: string): Owner {
  // Le contexte interne est isolé ici : Remotion a déjà calculé le prémontage,
  // y compris celui des ancêtres. Les producteurs utilisent des API publiques.
  const sequence: any = useContext((R as any).Internals.SequenceContext);
  const native = (R as any).useBufferState();
  const visible = !sequence?.premounting && !sequence?.postmounting;
  const ref = useRef<Owner | null>(null);
  if (!ref.current) ref.current = { id: ++nextOwner, kind, visible, committed: false, disposed: false, requests: new Set(), handles: new Set(), buffer: native, render: null };
  const owner = ref.current; owner.buffer = native;
  useLayoutEffect(() => {
    owner.committed = true; owner.disposed = false; owners.set(owner.id, owner);
    synchronize(owner);
    return () => {
      owner.disposed = true; owner.committed = false;
      for (const request of [...owner.requests]) release(owner, request);
      for (const handle of owner.handles) owner.render?.continueRender(handle);
      owner.handles.clear(); owners.delete(owner.id); changed();
    };
  }, [owner]);
  useLayoutEffect(() => { owner.visible = visible; synchronize(owner); }, [owner, visible]);
  return owner;
}
// Même forme que l'API publique ; le démontage protège aussi un producteur
// qui aurait oublié unblock() lorsqu'un saut quitte sa scène.
export function useBufferState() {
  const owner = useOwner('playback');
  return useMemo(() => ({ delayPlayback: () => acquire(owner) }), [owner]);
}
// Migration explicite : useDelayRender() remplace les fonctions globales. Chaque
// poignée connue possède une identité et une durée de vie précises.
export function useDelayRender() {
  const native = (R as any).useDelayRender();
  const owner = useOwner('render'); owner.render = native;
  const leases = useRef(new Map<number, Lease>());
  return useMemo(() => ({
    delayRender: (label?: string, options?: any): number => {
      const handle = native.delayRender(label, options);
      if (!owner.disposed) { owner.handles.add(handle); leases.current.set(handle, acquire(owner)); changed(); }
      return handle;
    },
    continueRender: (handle: number) => {
      native.continueRender(handle); leases.current.get(handle)?.unblock(); leases.current.delete(handle);
      owner.handles.delete(handle); changed();
    },
    cancelRender: (error: unknown) => {
      for (const lease of leases.current.values()) lease.unblock(); leases.current.clear();
      return native.cancelRender(error);
    },
  }), [native.delayRender, native.continueRender, native.cancelRender, owner]);
}
const Real: any = (R as any).Sequence;
const PRE = 60, POST = 30;
const Windowed = forwardRef<any, any>(function WindowedSequence(props, ref) {
  const frame: number = (R as any).useCurrentFrame();
  const from = Number.isFinite(props.from) ? props.from : 0, duration = Number.isFinite(props.durationInFrames) ? props.durationInFrames : Infinity;
  const span = props.loop ? Infinity : duration / (props.playbackRate > 0 ? props.playbackRate : 1);
  if (frame < from - PRE || frame >= from + span + POST) return null;
  return <Real {...props} ref={ref} />;
});
// Pas de prémontage ajouté à toutes les scènes : le projet choisit ses frontières.
// Mais une scène QUITTÉE reste montée, cachée et figée, KEEP_S secondes (postmountFor de Remotion, aperçu seulement :
// le rendu n'utilise pas ce lecteur). Revenir en arrière sur un plan lourd ne le reprépare plus (03/11/2026, 宇宙ちゃん
// long07 : chaque gros plan quitté était démonté, et le revoir refigeait l'aperçu 6 s). Un postmountFor du projet prime.
export const KEEP_S = 45;
export const Sequence = forwardRef<any, any>(function Sequence(props, ref) {
  const { fps } = (R as any).useVideoConfig();
  if (props.layout === 'none') return <Windowed {...props} ref={ref} />;
  if (props.loop || props.postmountFor !== undefined || !Number.isFinite(props.durationInFrames)) return <Real {...props} ref={ref} />;
  return <Real {...props} postmountFor={Math.round((fps || 30) * KEEP_S)} ref={ref} />;
});
