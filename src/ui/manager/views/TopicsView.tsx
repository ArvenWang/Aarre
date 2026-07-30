import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KnowledgeDashboard,
  TopicGraph,
  TopicGraphNode
} from "../../../lib/types";

const CLOUD_RADIUS = 205;
const FOCAL_LENGTH = 620;
const DEPTH_OFFSET = 300;
const RADIUS_UNIT = 3.2;
const ROW_CAP = 5;

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface ProjectedPoint extends Point3D {
  index: number;
  scale: number;
}

interface GraphAnalysis {
  degree: Map<string, number>;
  clusters: Map<string, number>;
  communities: Array<{
    id: number;
    name: string;
    total: number;
    members: TopicGraphNode[];
  }>;
  isolated: TopicGraphNode[];
  underconnected: Array<{
    node: TopicGraphNode;
    degree: number;
  }>;
}

interface GraphReadout {
  topic: string;
  count: number;
  degree: number;
  community: string;
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () =>
    ((state = (state * 1_664_525 + 1_013_904_223) >>> 0) /
      4_294_967_296);
}

export function screenRadius(count: number, scale: number): number {
  return Math.max(
    2,
    RADIUS_UNIT * Math.sqrt(count) * Math.pow(scale, 0.45) * 1.3
  );
}

export function analyzeTopicGraph(graph: TopicGraph): GraphAnalysis {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(
    graph.nodes.map((node) => [
      node.id,
      [] as Array<{ id: string; weight: number }>
    ])
  );
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    adjacency.get(edge.source)!.push({
      id: edge.target,
      weight: edge.weight
    });
    adjacency.get(edge.target)!.push({
      id: edge.source,
      weight: edge.weight
    });
  }

  const labels = new Map(
    graph.nodes.map((node, index) => [node.id, index])
  );
  const order = graph.nodes.map((node) => node.id).sort();
  for (let pass = 0; pass < 30; pass += 1) {
    let changed = false;
    for (const id of order) {
      const neighbours = adjacency.get(id) || [];
      if (!neighbours.length) continue;
      const tally = new Map<number, number>();
      for (const neighbour of neighbours) {
        const label = labels.get(neighbour.id)!;
        tally.set(label, (tally.get(label) || 0) + neighbour.weight);
      }
      let best = labels.get(id)!;
      let bestWeight = -1;
      for (const [label, weight] of [...tally].sort(
        (left, right) => left[0] - right[0]
      )) {
        if (weight > bestWeight) {
          best = label;
          bestWeight = weight;
        }
      }
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const connectedLabels = [
    ...new Set(
      graph.nodes
        .filter((node) => (degree.get(node.id) || 0) > 0)
        .map((node) => labels.get(node.id)!)
    )
  ].sort((left, right) => left - right);
  const remap = new Map(
    connectedLabels.map((label, index) => [label, index])
  );
  const clusters = new Map<string, number>();
  for (const [index, node] of graph.nodes.entries()) {
    clusters.set(
      node.id,
      (degree.get(node.id) || 0) > 0
        ? remap.get(labels.get(node.id)!) || 0
        : connectedLabels.length + index
    );
  }

  const groups = new Map<number, TopicGraphNode[]>();
  for (const node of graph.nodes) {
    if ((degree.get(node.id) || 0) === 0) continue;
    const cluster = clusters.get(node.id)!;
    const members = groups.get(cluster) || [];
    members.push(node);
    groups.set(cluster, members);
  }
  const communities = [...groups.entries()]
    .map(([id, members]) => {
      const sorted = [...members].sort(
        (left, right) => right.count - left.count
      );
      return {
        id,
        name: sorted[0]?.label || "未命名主题",
        total: members.reduce((sum, node) => sum + node.count, 0),
        members: sorted
      };
    })
    .sort((left, right) => right.total - left.total);

  const isolated = graph.nodes
    .filter((node) => (degree.get(node.id) || 0) === 0)
    .sort((left, right) => right.count - left.count);
  const underconnected = graph.nodes
    .filter((node) => (degree.get(node.id) || 0) > 0)
    .map((node) => ({
      node,
      degree: degree.get(node.id) || 0
    }))
    .sort(
      (left, right) =>
        right.node.count / right.degree -
        left.node.count / left.degree
    )
    .slice(0, 3);

  return {
    degree,
    clusters,
    communities,
    isolated,
    underconnected
  };
}

export function layoutGraph(
  graph: TopicGraph,
  degree: Map<string, number>
): Point3D[] {
  const count = graph.nodes.length;
  if (!count) return [];
  const index = new Map(
    graph.nodes.map((node, nodeIndex) => [node.id, nodeIndex])
  );
  const radius = 190;
  const idealDistance =
    Math.cbrt((radius * radius * radius * 8) / count) * 0.92;
  const cutoff = idealDistance * 3.2;
  const random = seeded(20_260_730);
  const positions = graph.nodes.map(() => ({
    x: (random() - 0.5) * radius,
    y: (random() - 0.5) * radius,
    z: (random() - 0.5) * radius
  }));
  const displacement = graph.nodes.map(() => ({ x: 0, y: 0, z: 0 }));
  const iterations = 620;
  let temperature = radius * 0.16;
  const cooling = temperature / (iterations + 1);

  for (let step = 0; step < iterations; step += 1) {
    for (const delta of displacement) {
      delta.x = 0;
      delta.y = 0;
      delta.z = 0;
    }
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        const dx = positions[left].x - positions[right].x;
        const dy = positions[left].y - positions[right].y;
        const dz = positions[left].z - positions[right].z;
        const distance = Math.hypot(dx, dy, dz) || 0.01;
        // 截断远距离斥力，否则零连接主题会被整团节点推到无限远。
        if (distance >= cutoff) continue;
        const repulsion =
          ((idealDistance * idealDistance) / distance) *
          (1 - distance / cutoff);
        displacement[left].x += (dx / distance) * repulsion;
        displacement[left].y += (dy / distance) * repulsion;
        displacement[left].z += (dz / distance) * repulsion;
        displacement[right].x -= (dx / distance) * repulsion;
        displacement[right].y -= (dy / distance) * repulsion;
        displacement[right].z -= (dz / distance) * repulsion;
      }
    }
    for (const edge of graph.edges) {
      const source = index.get(edge.source);
      const target = index.get(edge.target);
      if (source === undefined || target === undefined) continue;
      const dx = positions[source].x - positions[target].x;
      const dy = positions[source].y - positions[target].y;
      const dz = positions[source].z - positions[target].z;
      const distance = Math.hypot(dx, dy, dz) || 0.01;
      const pull =
        ((distance * distance) / idealDistance) *
        Math.min(2, 0.45 + edge.weight * 0.26);
      displacement[source].x -= (dx / distance) * pull;
      displacement[source].y -= (dy / distance) * pull;
      displacement[source].z -= (dz / distance) * pull;
      displacement[target].x += (dx / distance) * pull;
      displacement[target].y += (dy / distance) * pull;
      displacement[target].z += (dz / distance) * pull;
    }
    for (let nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
      displacement[nodeIndex].x -= positions[nodeIndex].x * 0.02;
      displacement[nodeIndex].y -= positions[nodeIndex].y * 0.02;
      displacement[nodeIndex].z -= positions[nodeIndex].z * 0.02;
      const magnitude =
        Math.hypot(
          displacement[nodeIndex].x,
          displacement[nodeIndex].y,
          displacement[nodeIndex].z
        ) || 0.01;
      const limited = Math.min(magnitude, temperature);
      positions[nodeIndex].x +=
        (displacement[nodeIndex].x / magnitude) * limited;
      positions[nodeIndex].y +=
        (displacement[nodeIndex].y / magnitude) * limited;
      positions[nodeIndex].z +=
        (displacement[nodeIndex].z / magnitude) * limited;
    }
    temperature -= cooling;
  }

  const centre = positions.reduce(
    (result, point) => ({
      x: result.x + point.x / count,
      y: result.y + point.y / count,
      z: result.z + point.z / count
    }),
    { x: 0, y: 0, z: 0 }
  );
  const centred = positions.map((point) => ({
    x: point.x - centre.x,
    y: point.y - centre.y,
    z: point.z - centre.z
  }));
  // 只用连通节点定标；孤岛主题应该留在外围，不能把主体压成一团。
  const connectedSpread = centred
    .filter(
      (_, nodeIndex) =>
        (degree.get(graph.nodes[nodeIndex].id) || 0) > 0
    )
    .map((point) => Math.hypot(point.x, point.y, point.z));
  const extent = Math.max(1, ...connectedSpread);
  const factor = CLOUD_RADIUS / extent;
  return centred.map((point) => {
    const scaled = {
      x: point.x * factor,
      y: point.y * factor,
      z: point.z * factor
    };
    const distance = Math.hypot(scaled.x, scaled.y, scaled.z);
    const outerLimit = CLOUD_RADIUS * 1.45;
    if (distance <= outerLimit) return scaled;
    const clamp = outerLimit / distance;
    return {
      x: scaled.x * clamp,
      y: scaled.y * clamp,
      z: scaled.z * clamp
    };
  });
}

function withAlpha(color: string, alpha: number): string {
  const value = color.trim();
  if (/^#[\da-f]{6}$/i.test(value)) {
    const red = Number.parseInt(value.slice(1, 3), 16);
    const green = Number.parseInt(value.slice(3, 5), 16);
    const blue = Number.parseInt(value.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return value;
}

function TopicGraphCanvas({
  graph,
  analysis
}: {
  graph: TopicGraph;
  analysis: GraphAnalysis;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<GraphReadout | null>(null);
  const positions = useMemo(
    () => layoutGraph(graph, analysis.degree),
    [analysis.degree, graph]
  );

  useEffect(() => {
    const mountedCanvas = canvasRef.current;
    if (!mountedCanvas) return;
    const mountedContext = mountedCanvas.getContext("2d");
    if (!mountedContext) return;
    // 显式收窄给后续事件回调；React ref 本身在清理阶段可能重新变为空。
    const canvas: HTMLCanvasElement = mountedCanvas;
    const context: CanvasRenderingContext2D = mountedContext;
    const index = new Map(
      graph.nodes.map((node, nodeIndex) => [node.id, nodeIndex])
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
    let yaw = 0.6;
    let pitch = -0.26;
    let zoom = 1.55;
    let dragging = false;
    let lastPointer: { x: number; y: number } | null = null;
    let hoverIndex = -1;
    let projected: ProjectedPoint[] = [];
    let animationFrame = 0;
    let pixelRatio = window.devicePixelRatio || 1;

    function cssTokens() {
      const style = getComputedStyle(canvas);
      return {
        surface: style.getPropertyValue("--surface").trim(),
        ink: style.getPropertyValue("--ink").trim(),
        inkMuted: style.getPropertyValue("--ink-muted").trim(),
        inkFaint: style.getPropertyValue("--ink-faint").trim(),
        palette: [1, 2, 3, 4, 5].map((position) =>
          style.getPropertyValue(`--chart-${position}`).trim()
        ),
        font: style.getPropertyValue("--font-ui").trim()
      };
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function project() {
      const rect = canvas.getBoundingClientRect();
      const centreX = rect.width / 2;
      const centreY = rect.height / 2;
      const cosineYaw = Math.cos(yaw);
      const sineYaw = Math.sin(yaw);
      const cosinePitch = Math.cos(pitch);
      const sinePitch = Math.sin(pitch);
      projected = positions.map((point, nodeIndex) => {
        const x1 = point.x * cosineYaw + point.z * sineYaw;
        const z1 = -point.x * sineYaw + point.z * cosineYaw;
        const y1 = point.y * cosinePitch - z1 * sinePitch;
        const z2 = point.y * sinePitch + z1 * cosinePitch;
        // 未归一化时分母可能转负；下界可保证 arc 永远收到正半径。
        const denominator = Math.max(
          1,
          FOCAL_LENGTH + z2 + DEPTH_OFFSET
        );
        const scale = (FOCAL_LENGTH / denominator) * zoom;
        return {
          index: nodeIndex,
          x: centreX + x1 * scale,
          y: centreY + y1 * scale,
          z: z2,
          scale
        };
      });
    }

    function draw() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const tokens = cssTokens();
      const palette = tokens.palette;
      context.clearRect(0, 0, rect.width, rect.height);
      const depths = projected.map((point) => point.z);
      const nearest = Math.min(...depths);
      const farthest = Math.max(...depths);
      const span = farthest - nearest || 1;
      const nearness = (z: number) => 1 - (z - nearest) / span;

      const neighbours = new Set<string>();
      if (hoverIndex >= 0) {
        neighbours.add(graph.nodes[hoverIndex].id);
        for (const edge of graph.edges) {
          if (edge.source === graph.nodes[hoverIndex].id) {
            neighbours.add(edge.target);
          }
          if (edge.target === graph.nodes[hoverIndex].id) {
            neighbours.add(edge.source);
          }
        }
      }

      const drawableEdges = graph.edges
        .map((edge) => {
          const source = projected[index.get(edge.source)!];
          const target = projected[index.get(edge.target)!];
          return source && target
            ? {
                edge,
                source,
                target,
                depth: (source.z + target.z) / 2
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((left, right) => right.depth - left.depth);

      for (const { edge, source, target, depth } of drawableEdges) {
        const sameCommunity =
          analysis.clusters.get(edge.source) ===
          analysis.clusters.get(edge.target);
        const depthWeight = nearness(depth);
        const dimmed =
          hoverIndex >= 0 &&
          !(
            neighbours.has(edge.source) &&
            neighbours.has(edge.target)
          );
        const base = sameCommunity
          ? palette[
              analysis.clusters.get(edge.source)! % palette.length
            ]
          : tokens.inkFaint;
        context.strokeStyle = withAlpha(
          base,
          dimmed
            ? 0.05
            : (0.13 + depthWeight * 0.37) *
                (sameCommunity ? 1 : 0.6)
        );
        context.lineWidth =
          (0.5 + edge.weight * 0.16) * (0.55 + depthWeight * 0.7);
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }

      const drawableNodes = [...projected].sort(
        (left, right) => right.z - left.z
      );
      const labelled = new Set(
        drawableNodes.slice(-11).map((point) => point.index)
      );
      for (const point of drawableNodes) {
        const node = graph.nodes[point.index];
        const depthWeight = nearness(point.z);
        const isolated = (analysis.degree.get(node.id) || 0) === 0;
        const dimmed = hoverIndex >= 0 && !neighbours.has(node.id);
        const radius = screenRadius(node.count, point.scale);
        const colour =
          palette[analysis.clusters.get(node.id)! % palette.length];
        if (!dimmed && depthWeight > 0.45 && !isolated) {
          context.fillStyle = withAlpha(
            colour,
            0.09 * (depthWeight - 0.45) * 2
          );
          context.beginPath();
          context.arc(
            point.x,
            point.y,
            Math.max(1, radius * 1.9),
            0,
            Math.PI * 2
          );
          context.fill();
        }

        context.beginPath();
        context.arc(
          point.x,
          point.y,
          Math.max(1, radius),
          0,
          Math.PI * 2
        );
        if (isolated) {
          context.fillStyle = withAlpha(tokens.surface, 1);
          context.fill();
          context.strokeStyle = withAlpha(
            tokens.inkFaint,
            dimmed ? 0.12 : 0.35 + depthWeight * 0.3
          );
          context.lineWidth = 1.2;
          context.setLineDash([3, 2.5]);
          context.stroke();
          context.setLineDash([]);
        } else {
          context.fillStyle = withAlpha(
            colour,
            dimmed ? 0.1 : 0.42 + depthWeight * 0.58
          );
          context.fill();
          context.strokeStyle = withAlpha(
            tokens.surface,
            dimmed ? 0.2 : 0.9
          );
          context.lineWidth = Math.max(1, 1.4 * point.scale);
          context.stroke();
        }
      }

      // 标签独立第二遍绘制，避免被前排节点盖住。
      context.textAlign = "center";
      context.textBaseline = "top";
      for (const point of drawableNodes) {
        const node = graph.nodes[point.index];
        const isolated = (analysis.degree.get(node.id) || 0) === 0;
        const emphasized = hoverIndex === point.index;
        if (!labelled.has(point.index) && !emphasized && !isolated) {
          continue;
        }
        const depthWeight = nearness(point.z);
        const dimmed = hoverIndex >= 0 && !neighbours.has(node.id);
        const radius = screenRadius(node.count, point.scale);
        context.font = `${emphasized ? 650 : 400} ${(
          10.5 * Math.min(1.15, point.scale)
        ).toFixed(1)}px ${tokens.font}`;
        context.fillStyle = withAlpha(
          emphasized ? tokens.ink : tokens.inkMuted,
          dimmed ? 0.12 : 0.24 + depthWeight * 0.76
        );
        context.fillText(node.label, point.x, point.y + radius + 5);
      }
    }

    function frame() {
      if (!dragging && hoverIndex < 0 && !reducedMotion.matches) {
        yaw += 0.0021;
      }
      project();
      draw();
      animationFrame = window.requestAnimationFrame(frame);
    }

    function updateHover(event: PointerEvent) {
      if (dragging && lastPointer) {
        // 近处 z 为负，yaw 必须减去横向位移，拖动方向才符合抓球直觉。
        yaw -= (event.clientX - lastPointer.x) * 0.006;
        pitch = Math.max(
          -1.2,
          Math.min(
            1.2,
            pitch + (event.clientY - lastPointer.y) * 0.005
          )
        );
        lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      let found = -1;
      let frontmost = Number.POSITIVE_INFINITY;
      for (const point of projected) {
        const node = graph.nodes[point.index];
        const radius = screenRadius(node.count, point.scale) + 5;
        if (
          Math.hypot(point.x - pointerX, point.y - pointerY) < radius &&
          point.z < frontmost
        ) {
          frontmost = point.z;
          found = point.index;
        }
      }
      if (found === hoverIndex) return;
      hoverIndex = found;
      canvas.dataset.hovering = String(found >= 0);
      if (found < 0) {
        setReadout(null);
        return;
      }
      const node = graph.nodes[found];
      const community = analysis.communities.find(
        (group) => group.id === analysis.clusters.get(node.id)
      );
      setReadout({
        topic: node.label,
        count: node.count,
        degree: analysis.degree.get(node.id) || 0,
        community:
          (analysis.degree.get(node.id) || 0) === 0
            ? "孤岛主题"
            : `「${community?.name || node.label}」群`
      });
    }

    function pointerDown(event: PointerEvent) {
      dragging = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = "true";
    }

    function pointerUp(event: PointerEvent) {
      dragging = false;
      lastPointer = null;
      canvas.dataset.dragging = "false";
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }

    function pointerLeave() {
      dragging = false;
      lastPointer = null;
      hoverIndex = -1;
      canvas.dataset.dragging = "false";
      canvas.dataset.hovering = "false";
      setReadout(null);
    }

    function wheel(event: WheelEvent) {
      event.preventDefault();
      zoom = Math.max(
        0.55,
        Math.min(2.4, zoom - event.deltaY * 0.0012)
      );
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => draw());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    darkMode.addEventListener("change", draw);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointermove", updateHover);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    resize();
    frame();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      darkMode.removeEventListener("change", draw);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("pointermove", updateHover);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [analysis, graph, positions]);

  return (
    <div className="topic-graph-canvas-shell">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="可拖动旋转、滚轮缩放的三维收藏主题关系图"
      />
      <div className="topic-graph-hint">
        拖动旋转 · 滚轮缩放 · 悬停查看关系
      </div>
      <aside
        className="topic-graph-readout"
        data-visible={Boolean(readout)}
        aria-live="polite"
      >
        {readout ? (
          <>
            <strong>{readout.topic}</strong>
            <dl>
              <div>
                <dt>收藏</dt>
                <dd>{readout.count} 条</dd>
              </div>
              <div>
                <dt>关联</dt>
                <dd>{readout.degree} 个</dd>
              </div>
              <div>
                <dt>社区</dt>
                <dd>{readout.community}</dd>
              </div>
            </dl>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function InsightRows({
  children,
  rest,
  unit
}: {
  children: React.ReactNode[];
  rest: number;
  unit: string;
}) {
  return (
    <>
      {children}
      {rest > 0 ? (
        <div className="topic-insight-more">
          还有 {rest} 个{unit}
        </div>
      ) : null}
    </>
  );
}

export function TopicsView({
  dashboard
}: {
  dashboard: KnowledgeDashboard | null;
}) {
  const graph = dashboard?.topicGraph;
  const analysis = useMemo(
    () =>
      analyzeTopicGraph(
        graph || {
          nodes: [],
          edges: []
        }
      ),
    [graph]
  );

  if (!graph?.nodes.length) {
    return (
      <div className="empty-state">
        <strong>主题信息还不够</strong>
        <p>完成 AI 元数据扫描后，主题之间的关系会显示在这里。</p>
      </div>
    );
  }

  return (
    <section className="topic-graph-shell">
      <TopicGraphCanvas graph={graph} analysis={analysis} />
      <div className="topic-insights">
        <section>
          <header>
            <span className="section-eyebrow">主题社区</span>
            <h3>自然聚在一起的内容</h3>
            <p>名称取该社区里收藏最多的主题。</p>
          </header>
          <InsightRows
            rest={Math.max(0, analysis.communities.length - ROW_CAP)}
            unit="社区"
          >
            {analysis.communities.slice(0, ROW_CAP).map((community) => (
              <div className="topic-insight-row" key={community.id}>
                <i
                  style={{
                    background: `var(--chart-${
                      (community.id % 5) + 1
                    })`
                  }}
                />
                <span>以「{community.name}」为核心</span>
                <strong>{community.total} 条</strong>
              </div>
            ))}
          </InsightRows>
        </section>

        <section>
          <header>
            <span className="section-eyebrow">孤岛主题</span>
            <h3>尚未形成连接</h3>
            <p>可能是独立兴趣，也可能需要补充相邻内容。</p>
          </header>
          {analysis.isolated.length ? (
            <InsightRows
              rest={Math.max(0, analysis.isolated.length - ROW_CAP)}
              unit="主题"
            >
              {analysis.isolated.slice(0, ROW_CAP).map((node) => (
                <div className="topic-insight-row" key={node.id}>
                  <i data-hollow="true" />
                  <span>{node.label}</span>
                  <strong>{node.count} 条</strong>
                </div>
              ))}
            </InsightRows>
          ) : (
            <p className="topic-insight-empty">当前主题都已形成至少一条联系。</p>
          )}
        </section>

        <section>
          <header>
            <span className="section-eyebrow">关联密度</span>
            <h3>收藏多但关联少</h3>
            <p>优先补充跨主题内容，知识网络会更完整。</p>
          </header>
          {analysis.underconnected.map(({ node, degree }) => (
            <div className="topic-insight-row" key={node.id}>
              <i
                style={{
                  background: `var(--chart-${
                    (analysis.clusters.get(node.id)! % 5) + 1
                  })`
                }}
              />
              <span>{node.label}</span>
              <strong>
                {node.count} 条 · {degree} 关联
              </strong>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}
