import { describe, expect, it } from "vitest";
import type { TopicGraph } from "../../../lib/types";
import {
  analyzeTopicGraph,
  layoutGraph,
  screenRadius
} from "./TopicsView";

function graphWithSixtyTopics(): TopicGraph {
  const nodes = Array.from({ length: 60 }, (_, index) => ({
    id: `topic-${index}`,
    label: `主题 ${index}`,
    count: index + 1
  }));
  const edges = Array.from({ length: 57 }, (_, index) => ({
    source: `topic-${index}`,
    target: `topic-${index + 1}`,
    weight: 1
  }));
  return { nodes, edges };
}

describe("TopicsView graph geometry", () => {
  it("keeps node area proportional to bookmark count", () => {
    expect(screenRadius(36, 1) / screenRadius(4, 1)).toBeCloseTo(3, 8);
  });

  it("keeps a 60-topic layout finite and isolates unconnected topics", () => {
    const graph = graphWithSixtyTopics();
    const analysis = analyzeTopicGraph(graph);
    const positions = layoutGraph(graph, analysis.degree);

    expect(positions).toHaveLength(60);
    expect(positions.every((point) =>
      [point.x, point.y, point.z].every(Number.isFinite)
    )).toBe(true);
    expect(analysis.isolated.map((node) => node.id)).toEqual([
      "topic-59",
      "topic-58"
    ]);
    expect(analysis.underconnected).toHaveLength(3);

    const connectedExtent = Math.max(
      ...positions.slice(0, 58).map((point) =>
        Math.hypot(point.x, point.y, point.z)
      )
    );
    const totalExtent = Math.max(
      ...positions.map((point) => Math.hypot(point.x, point.y, point.z))
    );
    expect(connectedExtent).toBeCloseTo(205, 5);
    expect(totalExtent).toBeLessThanOrEqual(205 * 1.45 + 0.000_001);
  });
});
