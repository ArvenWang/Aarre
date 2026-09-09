import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { SiteThumbnail } from "../../components/SiteThumbnail";
import { currentSiteBrandImageUrl } from "../../../lib/thumbnail";
import { resourceForUrl, siteBrandForUrl, bookmarkSourceForUrl } from "../bookmark-link";
import type { ResourceRecord, SiteBrandRecord, BookmarkAgentSource } from "../../../lib/types";

export function AgentMarkdown({
  content,
  resourceByUrl,
  siteBrandByHost,
  sources,
}: {
  content: string;
  resourceByUrl: Map<string, ResourceRecord>;
  siteBrandByHost: Map<string, SiteBrandRecord>;
  sources?: BookmarkAgentSource[];
}) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({children}) => <ScrollArea frameClassName="markdown-scroll-frame" label="代码"><pre>{children}</pre></ScrollArea>,
          table: ({children}) => <ScrollArea frameClassName="markdown-scroll-frame" label="表格"><table>{children}</table></ScrollArea>,
          a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
            const resource = href ? resourceForUrl(resourceByUrl, href) : undefined;
            const source = href ? bookmarkSourceForUrl(sources, href) : undefined;
            const bookmarkUrl = resource?.url || source?.url;
            if (!bookmarkUrl) {
              return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
            }
            const bookmarkTitle = resource?.title || source?.title || bookmarkUrl;
            return (
              <a className="agent-inline-source" href={bookmarkUrl} target="_blank" rel="noreferrer noopener" title={bookmarkTitle}>
                <SiteThumbnail
                  url={bookmarkUrl}
                  imageUrl={resource?.thumbnailDataUrl}
                  brandImageUrl={
                    currentSiteBrandImageUrl(
                      siteBrandForUrl(siteBrandByHost, bookmarkUrl),
                    ) || source?.faviconUrl
                  }
                  categoryCoverId={resource?.categoryCoverId}
                  forceSiteBrand
                  label={resource?.siteName || source?.siteName || bookmarkTitle}
                  className="agent-inline-source-thumbnail"
                />
                <span>{children}</span>
              </a>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
