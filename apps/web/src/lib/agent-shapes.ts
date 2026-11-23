// Agent body shapes. Each is a closed SVG path in a 100×100 box, plus where its two eyes sit.
// Paths are generated once at module load: rounded polygons and smooth polar curves.

export type ShapeId =
  | "circle"
  | "squircle"
  | "pill"
  | "arch"
  | "ghost"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "cookie"
  | "clover"
  | "burst";

export type AgentShape = {
  id: ShapeId;
  label: string;
  path: string;
  /** Eye centre line (y), distance between eye centres, eye width and height. 100-unit box. */
  eyes: { y: number; gap: number; w: number; h: number };
};

const f = (n: number) => Math.round(n * 100) / 100;

/** Smooth closed curve through points (Catmull-Rom converted to cubic Béziers). */
function smooth(points: [number, number][]): string {
  const n = points.length;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** Curve from a polar radius function, first sample pointing straight up. */
function polar(r: (theta: number) => number, samples = 96, cx = 50, cy = 50): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const a = t - Math.PI / 2;
    const rr = r(t);
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return smooth(pts);
}

/** Polygon with every corner rounded to `radius`. */
function roundedPolygon(vertices: [number, number][], radius: number): string {
  const n = vertices.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const toPrev = [prev[0] - cur[0], prev[1] - cur[1]];
    const toNext = [next[0] - cur[0], next[1] - cur[1]];
    const lp = Math.hypot(toPrev[0], toPrev[1]);
    const ln = Math.hypot(toNext[0], toNext[1]);
    const r = Math.min(radius, lp / 2, ln / 2);
    const a = [cur[0] + (toPrev[0] / lp) * r, cur[1] + (toPrev[1] / lp) * r];
    const b = [cur[0] + (toNext[0] / ln) * r, cur[1] + (toNext[1] / ln) * r];
    d += `${i === 0 ? "M" : "L"}${f(a[0])} ${f(a[1])}Q${f(cur[0])} ${f(cur[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return `${d}Z`;
}

function regular(sides: number, r: number, cx = 50, cy = 50, rotate = -90): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((rotate + (360 / sides) * i) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

const EYES = { y: 46, gap: 24, w: 10, h: 18 };

export const AGENT_SHAPES: AgentShape[] = [
  { id: "circle", label: "Circle", path: polar(() => 47), eyes: EYES },
  {
    id: "squircle",
    label: "Squircle",
    // Superellipse, n = 4.
    path: polar((t) => {
      const a = t - Math.PI / 2;
      const c = Math.abs(Math.cos(a)) ** 4;
      const s = Math.abs(Math.sin(a)) ** 4;
      return 46 / (c + s) ** 0.25;
    }, 128),
    eyes: EYES,
  },
  {
    id: "pill",
    label: "Pill",
    path: "M30 20H70A30 30 0 0 1 70 80H30A30 30 0 0 1 30 20Z",
    eyes: { y: 49, gap: 26, w: 10, h: 18 },
  },
  {
    id: "arch",
    label: "Arch",
    path: "M8 52A42 42 0 0 1 92 52V80Q92 94 78 94H22Q8 94 8 80Z",
    eyes: { y: 52, gap: 24, w: 10, h: 18 },
  },
  {
    id: "ghost",
    label: "Ghost",
    path:
      "M10 48A40 40 0 0 1 90 48V86Q83.3 98 76.7 88Q70 79 63.3 88Q56.7 98 50 88Q43.3 79 36.7 88Q30 98 23.3 88Q16.7 79 10 86Z",
    eyes: { y: 46, gap: 24, w: 10, h: 18 },
  },
  {
    id: "triangle",
    label: "Triangle",
    path: roundedPolygon([[50, 6], [96, 88], [4, 88]], 16),
    eyes: { y: 64, gap: 20, w: 9, h: 16 },
  },
  {
    id: "diamond",
    label: "Diamond",
    path: roundedPolygon([[50, 3], [97, 50], [50, 97], [3, 50]], 18),
    eyes: { y: 49, gap: 22, w: 9, h: 16 },
  },
  {
    id: "pentagon",
    label: "Pentagon",
    path: roundedPolygon(regular(5, 50, 50, 54), 14),
    eyes: { y: 52, gap: 24, w: 10, h: 18 },
  },
  {
    id: "hexagon",
    label: "Hexagon",
    path: roundedPolygon(regular(6, 49, 50, 50, -90), 13),
    eyes: EYES,
  },
  { id: "cookie", label: "Cookie", path: polar((t) => 43 + 4.5 * Math.cos(7 * t), 140), eyes: EYES },
  {
    id: "clover",
    label: "Clover",
    path: polar((t) => 33 + 15 * Math.abs(Math.cos(2 * t)) ** 0.55, 160),
    eyes: { y: 47, gap: 22, w: 9, h: 16 },
  },
  { id: "burst", label: "Burst", path: polar((t) => 42 + 6 * Math.cos(12 * t), 192), eyes: EYES },
];

export const SHAPE_IDS = AGENT_SHAPES.map((s) => s.id) as [ShapeId, ...ShapeId[]];

export function shapeOf(id: string | null | undefined): AgentShape {
  return AGENT_SHAPES.find((s) => s.id === id) ?? AGENT_SHAPES[0];
}
