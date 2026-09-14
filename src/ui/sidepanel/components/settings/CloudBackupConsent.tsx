import { Button } from "@/ui/components/ui/button";
import { Switch } from "@/ui/components/ui/switch";
export function CloudBackupConsent({ enabled, busy, onChange }: { enabled: boolean; busy: boolean; onChange: (value: boolean) => void }) {
  return <div className="cloud-backup-consent">
    <div className="cloud-backup-consent-heading"><strong>完整备份</strong>
      {enabled && <Switch checked disabled={busy} label="暂停完整备份" onChange={onChange} />}
    </div>
    <p>{enabled ? "已开启。" : "开启后，"}收藏结构、备注、标签、网页封面与截图、AI 会话和报告将备份到此账号。API Key、正文原文和浏览历史不进入云端备份；受保护收藏不上传。</p>
    {!enabled && <Button variant="primary" disabled={busy} onClick={() => onChange(true)}>同意并开启完整备份</Button>}
    {!enabled && <small>当前使用本地收藏。登录本身不会开启备份。</small>}
  </div>;
}
