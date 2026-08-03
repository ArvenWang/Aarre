import { Button } from "@/ui/components/ui/button";
import type {
  OrganizationNotice,
  ResurfacingItem,
} from "../../../lib/types";

interface LibraryNoticesProps {
  query: string;
  organizationNotice: OrganizationNotice | null;
  organizationNoticeBusy: boolean;
  resurfacing: ResurfacingItem[];
  onDismissOrganization: () => void;
  onOpenOrganization: () => void;
  onOpenResurfacing: () => void;
  onOpenItem: (item: ResurfacingItem) => void;
}

export function LibraryNotices({
  query,
  organizationNotice,
  organizationNoticeBusy,
  resurfacing,
  onDismissOrganization,
  onOpenOrganization,
  onOpenResurfacing,
  onOpenItem,
}: LibraryNoticesProps) {
  return (
    <>
      {organizationNotice ? (
        <section
          className="organization-notice-banner"
          aria-label="书签整理建议"
        >
          <div>
            <strong>
              发现 {organizationNotice.proposalCount} 条可以整理的地方
            </strong>
          </div>
          <div>
            <Button
              variant="ghost" size="sm"
              type="button"

              disabled={organizationNoticeBusy}
              onClick={onDismissOrganization}
            >
              暂不
            </Button>
            <Button
              variant="primary" size="sm"
              type="button"

              disabled={organizationNoticeBusy}
              onClick={onOpenOrganization}
            >
              去处理
            </Button>
          </div>
        </section>
      ) : null}

      {!query.trim() && resurfacing.length ? (
        <section
          className="context-resurfacing context-resurfacing-top"
          aria-label="这会儿值得重看"
        >
          <header>
            <strong>这会儿值得重看</strong>
            <Button type="button" variant="ghost" onClick={onOpenResurfacing}>
              打开工作台
            </Button>
          </header>
          {resurfacing.map((item) => (
            <Button
              type="button"
              variant="ghost"
              size="unstyled"
              key={item.resourceKey}
              onClick={() => onOpenItem(item)}
            >
              <span>
                <strong>{item.title}</strong>
                <small>{item.reason}</small>
              </span>
              <em>{item.ageDays} 天</em>
            </Button>
          ))}
        </section>
      ) : null}
    </>
  );
}
