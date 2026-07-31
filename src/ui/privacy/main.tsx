import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./privacy.css";

function PrivacyPage() {
  return (
    <main className="privacy-shell">
      <header>
        <span>AARRE · PRIVACY</span>
        <h1>你的书签属于你。</h1>
        <p>
          生效日期：2026 年 7 月 31 日。本政策说明 Aarre 浏览器扩展在本机处理什么、哪些请求会离开设备，以及你如何带走自己的数据。
        </p>
      </header>

      <section>
        <h2>核心承诺</h2>
        <ul>
          <li>Chrome 原生书签始终是标题、网址和文件夹结构的唯一事实来源。</li>
          <li>页面快照只保存在本机，绝不上传，也不用于 AI 处理。</li>
          <li>API Key 只保存在当前 Chrome 配置文件，不写入导出文件或 Aarre 日志。</li>
          <li>网页正文不经过 Aarre 自己的服务器。</li>
        </ul>
      </section>

      <section>
        <h2>保存在本机的数据</h2>
        <p>
          Aarre 在扩展的 IndexedDB 与 Chrome 本地存储中保存摘要、标签、主题、检索别名、用户备注、Agent 会话、链接健康状态、站点标识、页面封面、页面快照、撤销记录、扫描用量与界面设置。卸载扩展或清除扩展数据会删除这些本机数据。
        </p>
      </section>

      <section>
        <h2>会离开设备的请求</h2>
        <h3>你选择的 AI 服务商</h3>
        <p>
          只有在你配置 Gemini、OpenAI 或 DeepSeek 的 API Key，并主动保存页面、提问或启动扫描时，Aarre 才会把完成该功能所需的页面文字和提示词直接发送给所选服务商。服务商如何保存与使用请求，由其各自政策和你的账号设置决定。
        </p>
        <h3>收藏的网站与图片主机</h3>
        <p>
          你主动启动全目录扫描后，Aarre 会直接访问收藏网址，并访问网页声明的图标、Web App Manifest、代表图或同站点资产地址，用于链接检测和本地封面。请求不携带浏览器 Cookie。Aarre 不使用第三方截图服务、通用图标代理或域名画像服务。
        </p>
        <h3>可选的跨设备同步</h3>
        <p>
          当前本地发行默认不连接 Aarre 云端。若未来版本由你明确连接同步，允许上传的范围仅为摘要、标签、主题、别名、备注和可重建的封面来源信息；API Key、网页正文、图片二进制和页面快照不在同步范围内。
        </p>
      </section>

      <section>
        <h2>Chrome 权限用途</h2>
        <dl>
          <div>
            <dt>bookmarks</dt>
            <dd>读取和执行你明确确认的原生书签创建、移动、改名与删除。</dd>
          </div>
          <div>
            <dt>tabs / activeTab / scripting</dt>
            <dd>读取当前页面并打开书签；普通路径只在已收藏的前台页面采集本机快照。</dd>
          </div>
          <div>
            <dt>debugger</dt>
            <dd>
              仅在你显式启动「补齐缺失封面」时使用：对 Aarre
              自己创建的后台专用标签页执行截图，任务不占用前台，你仍可正常使用
              Chrome。不会附加到你正在浏览的其他页面，不读取正文、不上传任何数据。
            </dd>
          </div>
          <div>
            <dt>history</dt>
            <dd>在本机提供地址导航建议，不上传浏览历史。</dd>
          </div>
          <div>
            <dt>storage / unlimitedStorage</dt>
            <dd>保存智能元数据、封面和最多 2,000 张本机页面快照。</dd>
          </div>
          <div>
            <dt>http / https 网站访问</dt>
            <dd>
              Chrome 自带星标不会授予临时网页权限；Aarre
              需要在新收藏后自动生成摘要、标签和本机截图；批量补拍还会在后台专用标签页中打开已收藏网址。该权限也用于你主动启动的全目录扫描，不用于持续监控普通浏览。
            </dd>
          </div>
          <div>
            <dt>identity / identity.email</dt>
            <dd>为未来可选的跨设备同步确认 Chrome 账号；本地功能不要求登录。</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>敏感页面与本机快照</h2>
        <p>
          无痕窗口、内网与本地地址、银行、支付和医疗域名不会采集快照。新收藏，或通过
          Aarre、地址栏和普通链接打开的缺图旧收藏，会在页面位于前台并完成加载、稳定停留后生成快照；已有截图最多每
          7 天静默刷新一次。
        </p>
      </section>

      <section>
        <h2>导出、删除与联系</h2>
        <p>
          设置中的“导出全部本地数据”会生成 JSON，包含智能层数据、Agent 会话、站点资产、页面快照、撤销记录和安全的本机设置，并明确排除 API Key、Key 尾号与登录令牌。你可以通过卸载扩展或清除扩展数据完成本机删除。
        </p>
        <p>
          如需报告隐私问题，请在{" "}
          <a
            href="https://github.com/ArvenWang/Aarre/issues"
            target="_blank"
            rel="noreferrer"
          >
            Aarre GitHub Issues
          </a>{" "}
          提交；请勿附带私人书签、API Key 或页面正文。
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivacyPage />
  </StrictMode>
);
