type PublicPage = {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  intro: string;
  body: string;
  path: string;
  language?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function publicOrigin(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return parsed.origin;
}

function renderPage(baseUrl: string, page: PublicPage): string {
  const origin = publicOrigin(baseUrl);
  const canonical = `${origin}${page.path}`;
  return `<!doctype html>
<html lang="${escapeHtml(page.language || "zh-CN")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(page.description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <title>${escapeHtml(page.title)}</title>
  <style>
    :root { color: #1f211e; background: #f7f6f1; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    a { color: inherit; text-decoration-color: #89a968; text-underline-offset: 3px; }
    main { width: min(calc(100% - 40px), 780px); margin: 0 auto; padding: 64px 0 88px; }
    nav { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 72px; }
    nav a { text-decoration: none; }
    .brand { font-size: 18px; font-weight: 760; letter-spacing: -0.02em; }
    .links { display: flex; flex-wrap: wrap; gap: 18px; color: #686963; font-size: 13px; }
    header { margin-bottom: 54px; }
    .eyebrow { color: #6c6e67; font-size: 11px; font-weight: 760; letter-spacing: .14em; text-transform: uppercase; }
    h1 { max-width: 680px; margin: 16px 0 20px; font-size: clamp(38px, 8vw, 68px); line-height: 1; letter-spacing: -.055em; }
    .intro { max-width: 680px; margin: 0; color: #5f615b; font-size: 16px; line-height: 1.8; }
    section { padding: 28px 0; border-top: 1px solid #dcdad2; }
    h2 { margin: 0 0 14px; font-size: 20px; letter-spacing: -.02em; }
    h3 { margin: 24px 0 8px; font-size: 14px; }
    p, li, dd { color: #5e605a; font-size: 14px; line-height: 1.8; }
    ul, ol { margin: 0; padding-left: 20px; }
    .card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .card { min-height: 150px; padding: 20px; border: 1px solid #deddd6; border-radius: 18px; background: #fff; }
    .card h2 { font-size: 16px; }
    .card p { margin: 0; font-size: 13px; }
    .note { padding: 18px 20px; border-radius: 16px; background: #eceee8; }
    .note p { margin: 0; }
    footer { margin-top: 44px; padding-top: 22px; border-top: 1px solid #dcdad2; color: #777971; font-size: 12px; line-height: 1.7; }
    @media (max-width: 620px) { main { padding-top: 34px; } nav { align-items: flex-start; margin-bottom: 52px; } .links { justify-content: flex-end; } .card-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <nav aria-label="Aarre public pages">
      <a class="brand" href="${escapeHtml(origin)}/">Aarre</a>
      <div class="links">
        <a href="${escapeHtml(origin)}/privacy">隐私政策</a>
        <a href="${escapeHtml(origin)}/terms">服务条款</a>
      </div>
    </nav>
    <header>
      <div class="eyebrow">${escapeHtml(page.eyebrow)}</div>
      <h1>${escapeHtml(page.heading)}</h1>
      <p class="intro">${escapeHtml(page.intro)}</p>
    </header>
    ${page.body}
    <footer>
      Aarre · 生效日期 2026 年 8 月 2 日 ·
      <a href="https://github.com/ArvenWang/Aarre/issues" rel="noreferrer">联系与问题反馈</a>
    </footer>
  </main>
</body>
</html>`;
}

export function renderHomePage(baseUrl: string): string {
  return renderPage(baseUrl, {
    title: "Aarre",
    description: "Aarre is a Chrome bookmark extension for local summaries, tags, search, covers, organization, and optional encrypted cloud sync.",
    eyebrow: "Aarre · Bookmark intelligence",
    heading: "Aarre",
    intro: "Aarre is a Chrome bookmark extension for local summaries, tags, search, covers, organization, and optional encrypted cloud sync. Aarre 保留 Chrome 原生书签，在本机补充摘要、标签、检索和封面；云端同步默认关闭，只有在你主动登录并选择范围后才会启用。",
    path: "/",
    language: "en",
    body: `
      <section>
        <h2>What is Aarre?</h2>
        <p>Aarre is a Chrome browser extension that enhances native Chrome bookmarks with local summaries, tags, search, cover images, organization suggestions, and rediscovery. The original bookmark title, URL, and folder remain in Chrome.</p>
        <h3>Why does Aarre use Google Sign-In?</h3>
        <p>Google Sign-In is used only when a user chooses optional Aarre Cloud sync. Aarre requests the user's verified email address, display name, and profile picture to create and display the account. It does not request access to Gmail, Google Drive, Contacts, or other Google APIs.</p>
      </section>
      <div class="card-grid">
        <section class="card">
          <h2>原生书签优先</h2>
          <p>标题、网址和文件夹结构继续由 Chrome 保存。Aarre 不建立一套难以迁出的平行书签库。</p>
        </section>
        <section class="card">
          <h2>默认本地处理</h2>
          <p>搜索、增强数据、页面快照和 BYOK AI 默认在当前浏览器配置中处理；AI Key 不进入 Aarre 云端。</p>
        </section>
        <section class="card">
          <h2>明确选择云端范围</h2>
          <p>“仅文字与设置”不上传图片；只有“完整云端备份”会把允许的封面与快照加密上传到私有对象存储。</p>
        </section>
        <section class="card">
          <h2>保护规则优先</h2>
          <p>无痕、内网、银行、支付、医疗及用户标记为受保护的网页和文件夹不会被 AI、截图或云端同步扫描。</p>
        </section>
      </div>
      <section>
        <h2>如何使用</h2>
        <p>Aarre 的产品界面位于 Chrome 扩展的侧边栏与网页端。本页面只提供公开的产品、隐私和条款信息，不收集表单或书签内容。</p>
      </section>
      <div class="note"><p><strong>English summary.</strong> Aarre enhances native Chrome bookmarks locally. Cloud sync is optional and off by default. Protected resources, API keys, page bodies, cookies, full browsing history, and native bookmark IDs are not uploaded to Aarre Cloud.</p></div>
    `
  });
}

export function renderPrivacyPage(baseUrl: string): string {
  return renderPage(baseUrl, {
    title: "Aarre 隐私政策",
    description: "Aarre 隐私政策：本机数据、可选云端同步、第三方服务、保留期、导出和删除。",
    eyebrow: "Aarre · Privacy policy",
    heading: "隐私政策",
    intro: "本政策说明 Aarre 浏览器扩展在本机处理什么、哪些请求可能离开设备、可选云端同步如何工作，以及你如何导出或删除自己的数据。",
    path: "/privacy",
    body: `
      <section>
        <h2>1. 核心承诺</h2>
        <ul>
          <li>Chrome 原生书签始终是标题、网址和文件夹结构的事实来源。</li>
          <li>云端默认关闭；不登录也可以使用本地功能。</li>
          <li>API Key、Cookie、完整浏览历史、自动提取的网页正文、Chrome 原生书签 ID 和受保护资源不上传 Aarre 云端。</li>
          <li>Aarre 不出售数据，不用于广告、信用评估或跨产品画像。</li>
        </ul>
      </section>
      <section>
        <h2>2. 本机数据</h2>
        <p>Aarre 会在扩展的 IndexedDB 与 Chrome 本地存储中保存摘要、标签、主题、检索别名、备注、会话、报告、链接健康状态、封面、页面快照、保护规则、撤销记录、任务状态和界面设置。卸载扩展或清除扩展数据会删除本机副本。</p>
      </section>
      <section>
        <h2>3. 可选的 Aarre 云端</h2>
        <p>用户主动使用 Google 登录时，Aarre 接收 Google 提供的账号标识、已验证邮箱、显示名称和头像，用于建立账号和显示登录状态。服务不请求 Google Drive、Gmail、通讯录或离线 Google API 权限。</p>
        <p>“仅文字与设置”会加密同步允许的摘要、标签、主题、别名、备注、设置、稳定会话、报告、保护规则和恢复信息。“完整云端备份”还会上传允许的页面封面、快照与站点标识。图片存储在腾讯云私有 COS；元数据存储在独立 PostgreSQL 数据库。数据库字段使用逐用户信封加密，COS 使用 SSE-COS AES-256。这不是只有用户能解密的端到端加密。</p>
      </section>
      <section>
        <h2>4. 其他网络请求</h2>
        <h3>用户选择的 AI 服务商</h3>
        <p>用户配置 Gemini、OpenAI 或 DeepSeek API Key 后，Aarre 从扩展直接向该服务商发送完成当前增强或问答所需的允许内容。请求不经过 Aarre 云端；服务商处理规则由其政策和用户账号设置决定。</p>
        <h3>收藏网站与公开图片资产</h3>
        <p>用户主动保存、打开或扫描收藏时，扩展可能直接访问收藏网址及其声明的图标、Web App Manifest 或代表图，用于本机链接检测与封面。请求不携带浏览器 Cookie。</p>
      </section>
      <section>
        <h2>5. 保护、保留与删除</h2>
        <ul>
          <li>无痕、内网、本地地址、银行、支付、医疗和用户设置为受保护的网页或文件夹不读取正文、不调用 AI、不截图、不上传。</li>
          <li>普通同步墓碑最长保留 180 天，避免长期离线设备把已删除内容重新上传。</li>
          <li>普通对象历史版本保留 30 天；数据库日备保留 35 天，月备保留 12 个月。</li>
          <li>账号删除会先吊销设备令牌，并在 7 天内删除在线密文和主、灾备对象的全部版本；安全备份中的旧数据只按公开保留期自然到期，且不允许恢复回生产。</li>
        </ul>
      </section>
      <section>
        <h2>6. 位置、安全与服务商</h2>
        <p>Aarre API 与主数据位于腾讯云香港区域，灾备对象与数据库备份位于腾讯云新加坡区域。服务采用最小权限账号、TLS、私有对象存储、字段加密、短期不透明访问令牌、轮换刷新令牌、审计日志与独立错误监控。错误日志会移除 OAuth 查询参数、授权头和用户内容。</p>
      </section>
      <section>
        <h2>7. 你的选择</h2>
        <p>你可以暂停同步、退出账号、导出本地或云端数据、撤销设备、切换同步范围，或请求删除整个云端账号。API Key 不进入导出文件。隐私问题可通过页面底部的 GitHub Issues 联系；请勿在公开问题中附带私人书签、Token、API Key 或网页正文。</p>
      </section>
      <div class="note"><p><strong>English summary.</strong> Aarre is local-first and cloud sync is optional. Google Sign-In provides identity only. Text metadata is encrypted in Aarre's database; images are uploaded only after the user selects full cloud backup. API keys, page bodies, cookies, full history, native bookmark IDs, and protected resources are excluded from Aarre Cloud. Users can export, disconnect devices, pause sync, or request account deletion.</p></div>
    `
  });
}

export function renderTermsPage(baseUrl: string): string {
  return renderPage(baseUrl, {
    title: "Aarre 服务条款",
    description: "Aarre 服务条款：账号、用户内容、可选云端同步、第三方服务、可用性和删除。",
    eyebrow: "Aarre · Terms of service",
    heading: "服务条款",
    intro: "使用 Aarre 的本地功能或可选云端服务，即表示你同意以下条款。云端功能不是使用本地书签增强能力的前提。",
    path: "/terms",
    body: `
      <section>
        <h2>1. 服务范围</h2>
        <p>Aarre 提供 Chrome 原生书签的本地增强、检索、整理、重新发现，以及用户主动开启的跨设备同步与备份。标题、网址和文件夹结构仍由 Chrome 保存；Aarre 云端只保存用户选择范围内的增强层数据。</p>
      </section>
      <section>
        <h2>2. 账号与授权</h2>
        <p>云端功能使用 Google 登录。你应使用自己有权使用的账号，并负责当前设备和浏览器配置的安全。你可以随时退出、撤销设备或删除云端账号。本地功能无需账号。</p>
      </section>
      <section>
        <h2>3. 用户内容</h2>
        <p>你保留书签、备注、标签、封面和快照等内容的权利。为了提供你主动选择的同步、备份、恢复、导出和删除功能，你授权 Aarre 在必要范围内加密处理、存储、复制和传输这些内容；该授权在数据删除后终止，但安全备份会按隐私政策中的保留期到期。</p>
      </section>
      <section>
        <h2>4. 合理使用</h2>
        <p>不得利用服务上传违法内容、侵害他人权利、传播恶意代码、绕过配额或安全控制、干扰其他用户或对服务进行未授权访问。发现高风险滥用时，Aarre 可以限制相关云端账号，同时保留用户依法导出或删除数据的路径。</p>
      </section>
      <section>
        <h2>5. 第三方服务</h2>
        <p>Google 登录、腾讯云基础设施、用户选择的 AI 服务商和被收藏网站分别受其自身条款约束。BYOK AI 请求由扩展直接发送给用户选择的服务商；Aarre 不保证第三方输出、网站可用性或外部内容的准确性。用户应自行确认拥有保存和处理相关内容的权利。</p>
      </section>
      <section>
        <h2>6. 可用性、备份与变更</h2>
        <p>Aarre 会采取商业上合理的安全、监控、备份和恢复措施，但网络、浏览器、第三方服务和不可抗力仍可能造成中断。云端备份不能替代 Chrome Sync、浏览器原生书签导出和用户自己的重要数据备份。重大功能或隐私范围变更会在生效前更新公开政策和产品提示。</p>
      </section>
      <section>
        <h2>7. 责任边界</h2>
        <p>在法律允许的范围内，Aarre 按现状提供，不对第三方网页、AI 输出、间接损失或超出可合理预见范围的损失承担责任。本条不排除法律不能排除的消费者权利、故意行为或重大过失责任。</p>
      </section>
      <section>
        <h2>8. 终止与联系</h2>
        <p>你可以停止使用扩展、暂停同步或请求删除云端账号。服务停止前，Aarre 会在合理可行范围内提供数据导出窗口。条款、隐私或安全问题可通过页面底部的公开联系入口提交，但请勿附带任何密钥或私人书签内容。</p>
      </section>
      <div class="note"><p><strong>English summary.</strong> Aarre provides local bookmark enhancement and optional cloud sync. Users retain ownership of their content and grant only the limited processing rights needed to provide sync, backup, recovery, export, and deletion. Third-party services have their own terms. Users may disconnect devices, stop syncing, export data, or request deletion.</p></div>
    `
  });
}
