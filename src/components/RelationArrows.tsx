/**
 * RelationArrows — SolidWorks-style parent/child reference connectors.
 *
 * Draws orthogonal, rounded-corner connectors between a device and its related
 * devices, routed through side gutters: **parents through the left gutter,
 * children through the right gutter**. Parent connectors stop just before each
 * row's content (never covering the icon/chevron); child connectors stop just
 * past the end of the label text (never crossing it). The anchor's outgoing
 * child segment departs from the row's right edge — outside the trailing
 * hover-action icons — so it never crosses them.
 *
 * The vertical buses clear **every row they pass**, not just the rows they
 * connect: all row-like elements (`data-instance-id` or `data-arrow-row`) are
 * measured as obstacles, and a row's horizontal extent includes its name line
 * (up to `data-role="label-end"`, which sits after any inline badges) plus any
 * `data-arrow-extent` elements (secondary text line, trailing badges). Every
 * endpoint is also guaranteed a straight horizontal run of at least MIN_TIP
 * before the corner, so arrowheads never sit directly on a bend.
 *
 * Two sets can show at once: the **selected** device's relationships are always
 * shown (vivid), and while hovering a *different* device its relationships are
 * also shown (desaturated), with the vertical buses offset so they don't
 * overlap. With nothing selected, the hovered set is shown vivid.
 *
 * Overlay is absolutely positioned inside the scroll container (scrolls with the
 * content) and purely decorative (`pointer-events: none`). Rows are located by
 * `data-instance-id`. A related device hidden inside a collapsed drawer (which
 * keeps its natural rect height — only ancestor clipping hides it) is redirected
 * to the drawer's visible header row (×N group row or category header), deduped
 * per header; connectors approach such headers from outside their right edge.
 * Devices with no visible representative are skipped.
 */

import type { Component } from 'solid-js';
import { For, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { relationIndex, selectedId, hoveredId } from '~/lib/device-store';

type ColorKey = 'parent-v' | 'parent-m' | 'child-v' | 'child-m';

const COLORS: Record<ColorKey, string> = {
  'parent-v': '#f59e0b', // amber-500
  'parent-m': '#a8916f', // desaturated amber
  'child-v': '#06b6d4', // cyan-500
  'child-m': '#759aa1', // desaturated cyan
};

interface Segment {
  d: string;
  color: ColorKey;
  vivid: boolean;
}

interface RowBox {
  midY: number;
  height: number;
  /** X where a parent connector stops — just left of the row's content. */
  leftStop: number;
  /** X where a child connector stops — just past the end of the label text. */
  rightStop: number;
  /** X just past the row's full right edge — outside the trailing hover-action
   *  icons, used as the departure point for the anchor's outgoing segment. */
  rowRight: number;
  /** True when this box is a stand-in header (group/category) for a related
   *  device hidden inside its collapsed drawer. Tips then stop at rowRight —
   *  a header's right side holds badges/actions a shaft must not cross. */
  proxy?: boolean;
}

const PAD = 5;
const RADIUS = 6;
/** Minimum straight horizontal run between a bend and an endpoint, so every
 *  arrow tip has a visible shaft instead of sprouting off a corner. */
const MIN_TIP = 12;

/**
 * An orthogonal connector from (ax,ay) to (bx,by) that detours through a vertical
 * bus at `busX`, with rounded corners. Both endpoints are on the same side of the
 * bus (parents: right of the left bus; children: left of the right bus).
 */
function elbowPath(ax: number, ay: number, bx: number, by: number, busX: number, baseR: number): string {
  const side = ax >= busX ? 1 : -1;
  const vdir = by >= ay ? 1 : -1;
  const r = Math.max(0, Math.min(baseR, Math.abs(by - ay) / 2, Math.abs(ax - busX), Math.abs(bx - busX)));
  return [
    `M ${ax} ${ay}`,
    `L ${busX + side * r} ${ay}`,
    `Q ${busX} ${ay} ${busX} ${ay + vdir * r}`,
    `L ${busX} ${by - vdir * r}`,
    `Q ${busX} ${by} ${busX + side * r} ${by}`,
    `L ${bx} ${by}`,
  ].join(' ');
}

const RelationArrows: Component<{ container: () => HTMLElement | undefined }> = props => {
  const [segments, setSegments] = createSignal<Segment[]>([]);
  const [dims, setDims] = createSignal({ w: 0, h: 0 });

  const recompute = () => {
    const container = props.container();
    const sel = selectedId();
    const hov = hoveredId();
    if (!container || (!sel && !hov)) {
      setSegments([]);
      return;
    }

    const { childrenByParent, parentByChild } = relationIndex();

    const rows = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>('[data-instance-id]').forEach(el => {
      const id = el.dataset.instanceId;
      if (id && !rows.has(id)) rows.set(id, el);
    });

    const cRect = container.getBoundingClientRect();
    const sx = container.scrollLeft;
    const sy = container.scrollTop;
    const clientW = container.clientWidth;

    /** Height of `el` actually visible after ancestor overflow clipping. Rows
     *  inside a collapsed (grid 0fr) drawer keep their natural rect height —
     *  the raw rect can't tell hidden rows apart from rendered ones. */
    const visibleHeight = (el: HTMLElement): number => {
      const r = el.getBoundingClientRect();
      let top = r.top;
      let bottom = r.bottom;
      for (let p = el.parentElement; p && p !== container; p = p.parentElement) {
        if (!p.classList.contains('overflow-hidden')) continue;
        const pr = p.getBoundingClientRect();
        top = Math.max(top, pr.top);
        bottom = Math.min(bottom, pr.bottom);
      }
      return bottom - top;
    };

    /** Nearest *visible* row that can stand in for `el`: the row itself, or —
     *  when it's clipped inside a collapsed drawer — that drawer's header row
     *  (the ×N group row or the category header). Null if nothing visible
     *  represents it (e.g. the whole category is hidden). */
    const representative = (el: HTMLElement): HTMLElement | null => {
      for (let hops = 0; hops < 6; hops++) {
        if (visibleHeight(el) > 3) return el;
        // Find the collapsed wrapper doing the clipping…
        let clip = el.parentElement;
        while (clip && clip !== container && clip.getBoundingClientRect().height > 3) {
          clip = clip.parentElement;
        }
        if (!clip || clip === container) return null;
        // …whose drawer's previous sibling is the header row standing in for it.
        const header = clip.parentElement?.previousElementSibling;
        if (!(header instanceof HTMLElement) || !header.matches('[data-instance-id], [data-arrow-row]')) {
          return null;
        }
        el = header;
      }
      return null;
    };

    const measure = (el: HTMLElement): RowBox => {
      const rr = el.getBoundingClientRect();
      const firstChild = (el.firstElementChild as HTMLElement | null) ?? el;
      // Rightmost always-visible content: the name line's end marker plus any
      // tagged extents (secondary text, trailing badges). Extents are clamped
      // to their parent box so truncated text doesn't over-report its width.
      let right = -Infinity;
      const labelEnd = el.querySelector<HTMLElement>('[data-role="label-end"]');
      if (labelEnd) right = labelEnd.getBoundingClientRect().right;
      el.querySelectorAll<HTMLElement>('[data-arrow-extent]').forEach(ex => {
        const exr = ex.getBoundingClientRect();
        const boxRight = (ex.parentElement ?? ex).getBoundingClientRect().right;
        right = Math.max(right, Math.min(exr.right, boxRight));
      });
      if (right === -Infinity) right = rr.right;
      const lr = firstChild.getBoundingClientRect();
      return {
        midY: (rr.top + rr.bottom) / 2 - cRect.top + sy,
        height: visibleHeight(el),
        leftStop: lr.left - cRect.left + sx - PAD,
        rightStop: right - cRect.left + sx + PAD,
        rowRight: rr.right - cRect.left + sx + PAD,
      };
    };

    // Every row-like element is an obstacle the vertical buses must clear —
    // including category and group headers, which have no instance id.
    const obstacles = [...container.querySelectorAll<HTMLElement>('[data-instance-id], [data-arrow-row]')]
      .map(measure)
      .filter(b => b.height > 3);
    const obstaclesBetween = (ys: number[]): RowBox[] => {
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      return obstacles.filter(o => o.midY >= lo && o.midY <= hi);
    };

    const out: Segment[] = [];

    const HUG_GAP = MIN_TIP + RADIUS; // bus offset beyond the farthest content it must clear
    const SET_GAP = 9; // extra offset so a second set's bus nests outside the first

    const buildSet = (
      id: string,
      vivid: boolean,
      outer: { busL?: number; busR?: number },
      /** Right-edge clamp for this set's bus — the primary set leaves a lane
       *  free when a second (hover) set will nest outside it. */
      rightClamp: number,
    ): { busL?: number; busR?: number } => {
      const anchorSrc = rows.get(id);
      const anchorEl = anchorSrc ? representative(anchorSrc) : null;
      if (!anchorEl) return {};
      const a = measure(anchorEl);
      // Hidden related devices resolve to their collapsed drawer's header row;
      // several can share one header, so dedupe by resolved element.
      const boxesFor = (ids: Iterable<string>): RowBox[] => {
        const seen = new Set<HTMLElement>();
        const boxes: RowBox[] = [];
        for (const rid of ids) {
          if (rid === id) continue;
          const src = rows.get(rid);
          const el = src ? representative(src) : null;
          if (!el || el === anchorEl || seen.has(el)) continue;
          seen.add(el);
          const b = measure(el);
          if (b.height <= 3) continue;
          b.proxy = el !== src;
          boxes.push(b);
        }
        return boxes;
      };

      const used: { busL?: number; busR?: number } = {};

      // Parents: bus sits left of everything it passes vertically.
      const parentId = parentByChild.get(id);
      const parents = parentId ? boxesFor([parentId]) : [];
      if (parents.length) {
        const passed = obstaclesBetween([a.midY, ...parents.map(p => p.midY)]);
        let busL = Math.min(a.leftStop, ...parents.map(p => p.leftStop), ...passed.map(o => o.leftStop)) - HUG_GAP;
        if (outer.busL !== undefined) busL = Math.min(busL, outer.busL - SET_GAP);
        busL = Math.max(busL, 2);
        used.busL = busL;
        // If the bus got clamped against the container edge, pull endpoints in
        // rather than shrinking the tip below MIN_TIP.
        const tipX = busL + MIN_TIP + RADIUS;
        for (const p of parents) {
          out.push({
            color: vivid ? 'parent-v' : 'parent-m',
            vivid,
            d: elbowPath(Math.max(a.leftStop, tipX), a.midY, Math.max(p.leftStop, tipX), p.midY, busL, RADIUS),
          });
        }
      }

      // Children: bus sits right of everything it passes vertically. The
      // anchor's outgoing segment departs from the row's right EDGE (outside
      // the hover-action icons) rather than its label end — a shaft from the
      // label to the bus would have to cross those icons.
      const children = boxesFor(childrenByParent.get(id) ?? []);
      if (children.length) {
        // Header stand-ins are approached from outside: their right side holds
        // badges and action icons a shaft must not cross.
        const endX = (c: RowBox) => (c.proxy ? c.rowRight : c.rightStop);
        const passed = obstaclesBetween([a.midY, ...children.map(c => c.midY)]);
        let busR = Math.max(a.rowRight, ...children.map(endX), ...passed.map(o => o.rightStop)) + HUG_GAP;
        if (outer.busR !== undefined) busR = Math.max(busR, outer.busR + SET_GAP);
        busR = Math.min(busR, rightClamp);
        used.busR = busR;
        // If the bus got clamped against the container edge, pull endpoints in
        // rather than shrinking the tip below MIN_TIP.
        const tipX = busR - (MIN_TIP + RADIUS);
        for (const c of children) {
          out.push({
            color: vivid ? 'child-v' : 'child-m',
            vivid,
            d: elbowPath(Math.min(a.rowRight, tipX), a.midY, Math.min(endX(c), tipX), c.midY, busR, RADIUS),
          });
        }
      }
      return used;
    };

    // Selected set always shown (vivid). A different hovered device adds a second
    // (desaturated) set, nested just outside the first so the buses don't overlap.
    // With both buses now living near the right edge, the primary set leaves a
    // SET_GAP lane free so the nested one still fits inside the clamp.
    const twoSets = !!(sel && rows.has(sel) && hov && hov !== sel && rows.has(hov));
    let primary: { busL?: number; busR?: number } = {};
    if (sel && rows.has(sel)) primary = buildSet(sel, true, {}, clientW - 4 - (twoSets ? SET_GAP : 0));
    if (hov && hov !== sel && rows.has(hov)) buildSet(hov, !sel, primary, clientW - 4);

    setDims({ w: container.scrollWidth, h: container.scrollHeight });
    setSegments(out);
  };

  createEffect(() => {
    selectedId();
    hoveredId();
    relationIndex();
    recompute();
  });

  onMount(() => {
    const container = props.container();
    if (!container) return;
    const onChange = () => recompute();
    container.addEventListener('scroll', onChange, { passive: true });
    container.addEventListener('transitionend', onChange);
    const ro = new ResizeObserver(onChange);
    ro.observe(container);
    onCleanup(() => {
      container.removeEventListener('scroll', onChange);
      container.removeEventListener('transitionend', onChange);
      ro.disconnect();
    });
  });

  return (
    <svg class="pointer-events-none absolute top-0 left-0 z-20" width={dims().w} height={dims().h}>
      <defs>
        <For each={Object.keys(COLORS) as ColorKey[]}>
          {key => (
            <marker
              id={`arr-${key}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill={COLORS[key]} />
            </marker>
          )}
        </For>
      </defs>
      <For each={segments()}>
        {seg => (
          <path
            d={seg.d}
            fill="none"
            stroke={COLORS[seg.color]}
            stroke-width={seg.vivid ? 1.75 : 1.5}
            stroke-linecap="round"
            stroke-linejoin="round"
            marker-end={`url(#arr-${seg.color})`}
          />
        )}
      </For>
    </svg>
  );
};

export default RelationArrows;
