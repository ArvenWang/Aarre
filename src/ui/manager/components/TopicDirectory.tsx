import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { FluidInput } from "@/ui/components/ui/input";
import { ResourceLink } from "./ResourceLink";
import type { ResourceRecord, TopicGraph } from "../../../lib/types";
export function TopicDirectory({ graph, resources, onOpenResource }: { graph: TopicGraph; resources: ResourceRecord[]; onOpenResource: (url: string) => void }) {
  const [query,setQuery] = useState(""), [expanded,setExpanded] = useState<string | null>(null);
  const items = useMemo(() => graph.nodes.filter((node) => node.label.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())),[graph,query]);
  return <section className="topic-directory" aria-label="按主题浏览收藏">
    <header><div><h2>按主题浏览</h2><p>选择主题查看对应收藏，支持键盘操作。</p></div><div className="topic-directory-search"><Search size={16}/><FluidInput aria-label="搜索主题" placeholder="搜索主题" value={query} onChange={(event) => setQuery(event.target.value)}/></div></header>
    {!items.length && <p role="status">没有匹配的主题</p>}
    <div className="topic-directory-grid">{items.map((node,index) => {
      const matches = resources.filter((resource) => !resource.deletedAt && resource.topics.some((topic) => topic.toLocaleLowerCase().normalize("NFKC").trim() === node.label.toLocaleLowerCase().normalize("NFKC").trim()));
      const open = expanded === node.id, panelId=`topic-collection-${index}`;
      return <div className="topic-directory-item" key={node.id}>
        <Button variant="ghost" className="topic-directory-trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(open ? null : node.id)}><strong>{node.label}</strong><span>{matches.length} 条</span><ChevronDown size={16}/></Button>
        <div id={panelId} hidden={!open} className="topic-directory-results"><ul>{matches.map((resource) => <li key={resource.resourceKey}><ResourceLink url={resource.url} onOpenResource={onOpenResource}>{resource.title || resource.url}</ResourceLink><small>{resource.siteName || new URL(resource.url).hostname}</small></li>)}</ul>{!matches.length && <p>此主题的收藏正在更新，请刷新收藏库。</p>}</div>
      </div>;
    })}</div>
  </section>;
}
