import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/ui/components/ui/button";
import { canonicalizeUrl } from "../../../lib/url";
import { registrableHost } from "../../../lib/cover-registry";
import { currentSiteBrandImageUrl } from "../../../lib/thumbnail";
import type {
  NativeBookmarkNode,
  ResourceRecord,
  SiteBrandRecord
} from "../../../lib/types";
import type { ListCoverStyle } from "../../../lib/display-settings";
import { ResourceIdentity } from "../../components/ResourceIdentity";
import { ChevronRightIcon, EllipsisIcon, FolderIcon } from "../../components/Icons";
import { hostFromUrl } from "../utils";
import { highlightTextMatches } from "./highlightTextMatches";

function resourceForUrl(resourceByUrl: Map<string, ResourceRecord>, url: string) {
  const direct = resourceByUrl.get(url);
  if (direct) return direct;
  try { return resourceByUrl.get(canonicalizeUrl(url)); } catch { return undefined; }
}

function siteBrandForUrl(siteBrandByHost: Map<string, SiteBrandRecord>, input: string) {
  try {
    const host = new URL(input).hostname.toLocaleLowerCase();
    return siteBrandByHost.get(host) || siteBrandByHost.get(registrableHost(host));
  } catch { return undefined; }
}

interface TreeProps {
  nodes: NativeBookmarkNode[];
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  coverStyle: ListCoverStyle;
  highlightQuery: string;
  onPreviewIntent: (node: NativeBookmarkNode, rect: DOMRect) => void;
  onPreviewLeave: () => void;
  depth?: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (node: NativeBookmarkNode, newTab: boolean) => void;
  onEdit: (node: NativeBookmarkNode) => void;
  draggedId: string;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onMove: (id: string, parentId: string, index?: number) => Promise<void>;
}

export type BookmarkPreviewMoveDecision = "keep" | "cancel" | "arm";

export function decideBookmarkPreviewMove(input: {
  nodeId: string;
  activeNodeId: string;
  timerArmed: boolean;
  distance: number;
  elapsed: number;
}): BookmarkPreviewMoveDecision {
  // 速度门只用于判断“是否值得启动预览”。预览一旦已经出现，同一行内
  // 的鼠标移动不能再把它取消，否则会形成消失—重新计时—再出现的闪烁。
  if (input.activeNodeId === input.nodeId) return "keep";
  if (input.distance / Math.max(1, input.elapsed) > 0.65) {
    return "cancel";
  }
  return input.timerArmed ? "keep" : "arm";
}

function BookmarkTree({
  nodes,
  resourceByUrl,
  siteBrandByHost,
  coverStyle,
  highlightQuery,
  onPreviewIntent,
  onPreviewLeave,
  depth = 0,
  expanded,
  onToggle,
  onOpen,
  onEdit,
  draggedId,
  onDragStart,
  onDragEnd,
  onMove,
}: TreeProps) {
  const [orderedNodes, setOrderedNodes] = useState(nodes);
  const nodeElements = useRef(new Map<string, HTMLDivElement>());
  const previousPositions = useRef<Map<string, number> | null>(null);
  const lastHoverTarget = useRef("");
  const activeDragId = useRef("");
  const previewTimer = useRef<number | undefined>(undefined);
  const previewIntentNodeId = useRef("");
  const pointerSample = useRef<{
    x: number;
    y: number;
    at: number;
  } | null>(null);

  useEffect(
    () => () => {
      if (previewTimer.current !== undefined) {
        window.clearTimeout(previewTimer.current);
      }
    },
    [],
  );

  function armPreview(node: NativeBookmarkNode, target: HTMLElement) {
    if (!node.url) return;
    if (previewTimer.current !== undefined) {
      window.clearTimeout(previewTimer.current);
    }
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = undefined;
      previewIntentNodeId.current = node.id;
      onPreviewIntent(node, target.getBoundingClientRect());
    }, 400);
  }

  function cancelPreview() {
    if (previewTimer.current !== undefined) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = undefined;
    }
    previewIntentNodeId.current = "";
    pointerSample.current = null;
    onPreviewLeave();
  }

  useEffect(() => {
    setOrderedNodes(nodes);
  }, [nodes]);

  useLayoutEffect(() => {
    const positions = previousPositions.current;
    previousPositions.current = null;
    if (
      !positions ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    for (const node of orderedNodes) {
      const element = nodeElements.current.get(node.id);
      const previousTop = positions.get(node.id);
      if (!element || previousTop === undefined) continue;
      const deltaY = previousTop - element.getBoundingClientRect().top;
      if (Math.abs(deltaY) < 1) continue;
      element.getAnimations().forEach((animation) => animation.cancel());
      element.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 240,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    }
  }, [orderedNodes]);

  function capturePositions(): Map<string, number> {
    return new Map(
      orderedNodes.flatMap((node) => {
        const element = nodeElements.current.get(node.id);
        return element
          ? [[node.id, element.getBoundingClientRect().top] as const]
          : [];
      }),
    );
  }

  function moveDraggedNode(targetId: string) {
    const sourceId = activeDragId.current || draggedId;
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = orderedNodes.findIndex((item) => item.id === sourceId);
    const targetIndex = orderedNodes.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const hoverKey = `${sourceId}:${targetId}`;
    if (lastHoverTarget.current === hoverKey) return;

    const next = [...orderedNodes];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    previousPositions.current = capturePositions();
    lastHoverTarget.current = hoverKey;
    setOrderedNodes(next);
  }

  return (
    <div className="bookmark-tree-level">
      {orderedNodes.map((node) => {
        const folder = !node.url;
        const isExpanded = expanded.has(node.id);
        const metadata = node.url
          ? resourceForUrl(resourceByUrl, node.url)
          : undefined;
        return (
          <div
            className="bookmark-node"
            key={node.id}
            ref={(element) => {
              if (element) nodeElements.current.set(node.id, element);
              else nodeElements.current.delete(node.id);
            }}
          >
            <div
              className="bookmark-row"
              data-folder={folder}
              data-expanded={folder ? isExpanded : undefined}
              data-analysis={
                folder
                  ? undefined
                  : metadata?.aiStatus === "ready"
                    ? "ready"
                    : "pending"
              }
              data-dragging={draggedId === node.id}
              draggable={!node.unmodifiable}
              style={
                {
                  "--tree-depth": `${depth * 24}px`,
                } as React.CSSProperties
              }
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-bookmark-layer-id",
                  node.id,
                );
                activeDragId.current = node.id;
                onDragStart(node.id);
              }}
              onDragEnd={() => {
                activeDragId.current = "";
                lastHoverTarget.current = "";
                onDragEnd();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                moveDraggedNode(node.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const id =
                  event.dataTransfer.getData(
                    "application/x-bookmark-layer-id",
                  ) || activeDragId.current;
                if (!id || id === node.id) return;
                const reorderedIndex = orderedNodes.findIndex(
                  (item) => item.id === id,
                );
                if (reorderedIndex >= 0) {
                  void onMove(id, node.parentId || "", reorderedIndex);
                  onDragEnd();
                  return;
                }
                void onMove(
                  id,
                  folder ? node.id : node.parentId || "",
                  folder ? undefined : node.index,
                );
              }}
              onPointerEnter={(event) => {
                if (folder) return;
                pointerSample.current = {
                  x: event.clientX,
                  y: event.clientY,
                  at: performance.now(),
                };
                armPreview(node, event.currentTarget);
              }}
              onPointerMove={(event) => {
                if (folder) return;
                const nowAt = performance.now();
                const previous = pointerSample.current;
                pointerSample.current = {
                  x: event.clientX,
                  y: event.clientY,
                  at: nowAt,
                };
                if (!previous) return;
                const elapsed = Math.max(1, nowAt - previous.at);
                const distance = Math.hypot(
                  event.clientX - previous.x,
                  event.clientY - previous.y,
                );
                const decision = decideBookmarkPreviewMove({
                  nodeId: node.id,
                  activeNodeId: previewIntentNodeId.current,
                  timerArmed: previewTimer.current !== undefined,
                  distance,
                  elapsed,
                });
                if (decision === "cancel") {
                  cancelPreview();
                } else if (decision === "arm") {
                  armPreview(node, event.currentTarget);
                }
              }}
              onPointerLeave={cancelPreview}
            >
              <Button
                variant="ghost"
                type="button"
                className="bookmark-main"
                aria-expanded={folder ? isExpanded : undefined}
                onClick={() =>
                  folder ? onToggle(node.id) : onOpen(node, false)
                }
                onAuxClick={(event) => {
                  if (!folder && event.button === 1) {
                    event.preventDefault();
                    onOpen(node, true);
                  }
                }}
                onKeyDown={(event) => {
                  if (folder) return;
                  if (event.key.toLocaleLowerCase() === "p") {
                    event.preventDefault();
                    onPreviewIntent(
                      node,
                      event.currentTarget
                        .closest(".bookmark-row")!
                        .getBoundingClientRect(),
                    );
                  } else if (event.key === "Escape") {
                    cancelPreview();
                  }
                }}
                title={node.url || node.title}
              >
                <span
                  className="tree-chevron"
                  data-visible={folder}
                  data-expanded={isExpanded}
                >
                  {folder ? <ChevronRightIcon /> : null}
                </span>
                {folder ? (
                  <>
                    <span className="tree-icon" data-folder="true">
                      <FolderIcon />
                    </span>
                    <span className="bookmark-copy">
                      <strong>
                        {highlightTextMatches(
                          node.title || "未命名",
                          highlightQuery,
                        )}
                      </strong>
                    </span>
                  </>
                ) : (
                  <ResourceIdentity
                    url={node.url || ""}
                    imageUrl={metadata?.thumbnailDataUrl}
                    brandImageUrl={currentSiteBrandImageUrl(
                      siteBrandForUrl(siteBrandByHost, node.url || ""),
                    )}
                    categoryCoverId={metadata?.categoryCoverId}
                    coverStyle={coverStyle}
                    label={node.title}
                    title={highlightTextMatches(
                      node.title || "未命名",
                      highlightQuery,
                    )}
                    meta={hostFromUrl(node.url || "")}
                    className="bookmark-identity"
                    thumbnailClassName="bookmark-thumbnail"
                  />
                )}
              </Button>

              {!node.unmodifiable && !node.folderType ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="row-menu"
                  aria-label={`编辑 ${node.title}`}
                  title="编辑"
                  onClick={() => onEdit(node)}
                >
                  <EllipsisIcon />
                </Button>
              ) : null}
            </div>

            {folder && node.children?.length ? (
              <div
                className="folder-children"
                data-expanded={isExpanded}
                aria-hidden={!isExpanded}
                inert={!isExpanded}
              >
                <div className="folder-children-inner">
                  <BookmarkTree
                    nodes={node.children}
                    resourceByUrl={resourceByUrl}
                    siteBrandByHost={siteBrandByHost}
                    coverStyle={coverStyle}
                    highlightQuery={highlightQuery}
                    depth={depth + 1}
                    expanded={expanded}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    draggedId={draggedId}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onMove={onMove}
                    onPreviewIntent={onPreviewIntent}
                    onPreviewLeave={onPreviewLeave}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}


export { BookmarkTree };
