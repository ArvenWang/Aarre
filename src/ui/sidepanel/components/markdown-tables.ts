interface MarkdownNode {
  type: string; value?: string; children?: MarkdownNode[];
  data?: { hProperties?: Record<string, string | number>; [key: string]: unknown };
}
const plainText = (node: MarkdownNode): string => node.value || node.children?.map(plainText).join("") || "";

/** Keep table headers available as field labels when narrow answers reflow. */
export function responsiveMarkdownTables() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "table") {
        const labels = node.children?.[0]?.children?.map((cell, index) => plainText(cell) || `第 ${index + 1} 列`) || [];
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, "data-many-columns": labels.length > 4 ? "true" : "false" } };
        for (const row of node.children?.slice(1) || []) row.children?.forEach((cell, index) => {
          cell.data = { ...cell.data, hProperties: { ...cell.data?.hProperties, "data-column-label": labels[index] || `第 ${index + 1} 列` } };
        });
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
