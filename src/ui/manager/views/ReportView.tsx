import { Button } from "@/ui/components/ui/button";
import {
  FluidInput,
  FluidTextarea,
  FluidSelect,
} from "@/ui/components/ui/input";
import type { KnowledgeDashboard, LibraryReport } from "../../../lib/types";
import { ResourceLink } from "../components/ResourceLink";

interface ReportViewProps {
  dashboard: KnowledgeDashboard | null;
  period: "week" | "month";
  onPeriodChange: (period: "week" | "month") => void;
  onOpenOrganize: () => void;
  onOpenResource: (url: string) => void;
}

function reportMetrics(report: LibraryReport) {
  return [
    {
      label: "本期新增",
      value: report.createdCount,
      detail: report.period === "week" ? "最近 7 天" : "最近 30 天",
      tone: "neutral",
    },
    {
      label: "很少打开",
      value: report.rarelyOpenedOver90Days,
      detail: "超过 90 天",
      tone: "neutral",
    },
    {
      label: "失效链接",
      value: report.health.deadLinks,
      detail: report.health.newlyDetectedDeadLinks
        ? `其中 ${report.health.newlyDetectedDeadLinks} 条本期发现`
        : "本期无新增",
      tone: report.health.newlyDetectedDeadLinks ? "negative" : "positive",
    },
    {
      label: "过大文件夹",
      value: report.health.largeFolders,
      detail: report.health.largeFolders ? "建议整理" : "结构健康",
      tone: report.health.largeFolders ? "negative" : "positive",
    },
  ] as const;
}

export function ReportView({
  dashboard,
  period,
  onPeriodChange,
  onOpenOrganize,
  onOpenResource,
}: ReportViewProps) {
  if (!dashboard) {
    return (
      <div className="empty-state">
        <strong>报告还在准备</strong>
      </div>
    );
  }

  const report = period === "week" ? dashboard.weekly : dashboard.monthly;
  const maxTrend = Math.max(
    1,
    ...report.topicTrends.flatMap((trend) => [trend.current, trend.previous]),
  );

  return (
    <section className="report-shell">
      <div className="report-period-tabs" aria-label="报告周期">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-active={period === "week"}
          onClick={() => onPeriodChange("week")}
        >
          周报
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-active={period === "month"}
          onClick={() => onPeriodChange("month")}
        >
          月报
        </Button>
      </div>

      <header className="report-lead">
        <span>本周结论</span>
        <h2>{report.attentionShift}</h2>
      </header>

      <div className="report-metrics" aria-label="收藏指标">
        {reportMetrics(report).map((metric) => (
          <article key={metric.label}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
            <small data-tone={metric.tone}>{metric.detail}</small>
          </article>
        ))}
      </div>

      <div className="report-sections">
        <section className="report-trends">
          <header>
            <div>
              <span className="section-eyebrow">主题变化</span>
              <h3>主题变化</h3>
            </div>
            <div className="trend-legend" aria-label="图例">
              <span data-series="current">本期</span>
              <span data-series="previous">上期</span>
            </div>
          </header>
          <div className="trend-bars">
            {report.topicTrends.length ? (
              report.topicTrends.map((trend) => (
                <div className="trend-bar-row" key={trend.topic}>
                  <span>{trend.topic}</span>
                  <div>
                    <i
                      data-series="previous"
                      style={{
                        width: `${(trend.previous / maxTrend) * 100}%`,
                      }}
                    />
                    <i
                      data-series="current"
                      style={{
                        width: `${(trend.current / maxTrend) * 100}%`,
                      }}
                    />
                  </div>
                  <strong>{trend.current}</strong>
                </div>
              ))
            ) : (
              <p className="report-empty-copy">暂无数据</p>
            )}
          </div>
        </section>

        <section className="report-gaps">
          <header>
            <span className="section-eyebrow">知识缺口</span>
            <h3>主题覆盖角度</h3>
          </header>
          {report.knowledgeGaps.length ? (
            <div>
              {report.knowledgeGaps.slice(0, 6).map((gap) => (
                <article key={gap.topic}>
                  <span>{gap.topic}</span>
                  <strong>{gap.angleCount} / 4</strong>
                  <i>
                    <span
                      style={{
                        width: `${Math.min(4, gap.angleCount) * 25}%`,
                      }}
                    />
                  </i>
                </article>
              ))}
            </div>
          ) : (
            <p className="report-empty-copy">数据不足</p>
          )}
        </section>
      </div>

      <section className="report-resurfacing">
        <header>
          <div>
            <span className="section-eyebrow">重新浮现</span>
            <h3>值得再看一次</h3>
          </div>
          <Button
            variant="ghost"
            type="button"

            onClick={onOpenOrganize}
          >
            查看整理提案
          </Button>
        </header>
        {report.resurfacing.length ? (
          <div>
            {report.resurfacing.slice(0, 3).map((item) => (
              <ResourceLink
                key={item.resourceKey}
                url={item.url}
                onOpenResource={onOpenResource}
              >
                <strong>{item.title}</strong>
                <small>{item.reason}</small>
              </ResourceLink>
            ))}
          </div>
        ) : (
          <p className="report-empty-copy">暂无推荐</p>
        )}
      </section>
    </section>
  );
}
