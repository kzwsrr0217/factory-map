/**
 * svgFloorPlan.ts — parses a layered floor-plan SVG (Floor.svg_ref, served via
 * floorService.getFloorSvg) into a background layer plus the "work-centers"
 * and "production-lines" layers' shapes, each carrying its own identity.
 *
 * Mirrors shopfloor_visualizer's mvp-2d-demo/js/svgplan.js convention: a
 * layer is a top-level <g> named by its <title> child; a shape's identity is
 * its own <title> child (falls back to its `id` attribute). Transforms are
 * kept "live" (not flattened) — the shapes are cloned into the DOM as-is, the
 * browser's native SVG rendering handles any nested transforms.
 *
 * This is a read-only, single-purpose parser for the phase-4/5 prototype
 * (see docs/DATA_MODEL_MIGRATION.md) — only the `work-centers` and
 * `production-lines` layers are extracted; `outline`/`walls` (and any other
 * layer) are left inside the background markup untouched.
 */

const WORK_CENTERS_LAYER = 'work-centers';
const PRODUCTION_LINES_LAYER = 'production-lines';

export interface NamedShape {
  code: string;
  markup: string; // outerHTML of the shape element, own fill/stroke stripped (see stripPresentationColors)
}

/** @deprecated use NamedShape — kept as an alias so existing imports keep working */
export type WorkCenterShape = NamedShape;

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedFloorPlan {
  backgroundMarkup: string; // innerHTML of the root <svg>, extracted layers removed
  viewBox: ViewBox | null; // the source file's own viewBox, so the caller can scale it into its world
  workCenterShapes: NamedShape[];
  productionLineShapes: NamedShape[];
}

function layerName(g: Element): string {
  const title = g.querySelector(':scope > title');
  return title?.textContent?.trim() ?? '';
}

function shapeLabel(shape: Element): string {
  const title = shape.querySelector(':scope > title');
  return title?.textContent?.trim() || shape.getAttribute('id') || '';
}

function parseViewBox(svg: Element): ViewBox | null {
  const raw = svg.getAttribute('viewBox');
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

// Removes event-handler attributes (onload, onerror, ...) and <script>
// elements from a parsed, file-sourced SVG subtree before it is ever
// serialized back to markup for dangerouslySetInnerHTML — the file comes
// from disk (Floor.svg_ref), not user upload, but this keeps that assumption
// from being load-bearing for XSS safety.
function sanitize(root: Element): void {
  root.querySelectorAll('script').forEach((el) => el.remove());
  const walker = [root, ...Array.from(root.querySelectorAll('*'))];
  walker.forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });
}

// Strips this shape's own fill/stroke (attribute and inline style) so the
// wrapping <g>'s productionLineColor()/status coloring is what actually
// paints it, instead of whatever the source file happened to author.
function stripPresentationColors(root: Element): void {
  [root, ...Array.from(root.querySelectorAll('*'))].forEach((el) => {
    el.removeAttribute('fill');
    el.removeAttribute('stroke');
    const style = el.getAttribute('style');
    if (style) {
      const cleaned = style.replace(/(?:^|;)\s*(fill|stroke)\s*:[^;]*/gi, '').trim();
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }
  });
}

const SHAPE_TAGS = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse']);

function extractLayerShapes(svg: Element, targetLayerName: string): NamedShape[] {
  const shapes: NamedShape[] = [];
  Array.from(svg.children).forEach((child) => {
    if (child.tagName.toLowerCase() !== 'g') return;
    if (layerName(child) !== targetLayerName) return;

    Array.from(child.children).forEach((shape) => {
      if (!SHAPE_TAGS.has(shape.tagName.toLowerCase())) return;
      const code = shapeLabel(shape);
      if (!code) return;
      stripPresentationColors(shape);
      shapes.push({ code, markup: shape.outerHTML });
    });

    // Remove the layer from the background — it's rendered separately
    // (colored per Production Line) by the caller.
    child.remove();
  });
  return shapes;
}

export function parseFloorPlanSvg(svgText: string): ParsedFloorPlan {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return { backgroundMarkup: '', viewBox: null, workCenterShapes: [], productionLineShapes: [] };

  const viewBox = parseViewBox(svg);

  // Production lines extracted first so their <g> is gone from the DOM
  // before we scan for work-centers (order doesn't matter functionally,
  // just keeps both extractions independent of each other).
  const productionLineShapes = extractLayerShapes(svg, PRODUCTION_LINES_LAYER);
  const workCenterShapes = extractLayerShapes(svg, WORK_CENTERS_LAYER);

  sanitize(svg);
  return { backgroundMarkup: svg.innerHTML, viewBox, workCenterShapes, productionLineShapes };
}
