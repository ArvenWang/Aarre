import aiAutomationCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/ai-automation-v1.png";
import artCreationCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/art-creation-v2.png";
import audioPodcastCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/audio-podcast-v1.png";
import automotiveMobilityCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/automotive-mobility-v1.png";
import businessStartupCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/business-startup-v1.png";
import codeRepositoryCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/code-repository-v1.png";
import consumerFashionCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/consumer-fashion-v1.png";
import dataChartCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/data-chart-v1.png";
import dataCloudCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/data-cloud-v1.png";
import designCreationCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/design-creation-v1.png";
import developmentSoftwareCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/development-software-v1.png";
import documentationApiCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/documentation-api-v3.png";
import educationScienceCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/education-science-v3.png";
import entertainmentCultureCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/entertainment-culture-v2.png";
import eventTicketCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/event-ticket-v1.png";
import financeInvestingCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/finance-investing-v3.png";
import foodCookingCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/food-cooking-v1.png";
import gamesHobbiesCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/games-hobbies-v1.png";
import genericWebpageCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/generic-webpage-v1.png";
import hardwareDevicesCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/hardware-devices-v1.png";
import healthMedicalCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/health-medical-v2.png";
import homeFamilyCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/home-family-v1.png";
import jobCareerCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/job-career-v2.png";
import naturePetsCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/nature-pets-v1.png";
import newsletterRssCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/newsletter-rss-v1.png";
import newsSocietyCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/news-society-v1.png";
import paperResearchCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/paper-research-v1.png";
import pdfReportCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/pdf-report-v1.png";
import placeMapCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/place-map-v1.png";
import portfolioGalleryCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/portfolio-gallery-v2.png";
import realEstateHousingCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/real-estate-housing-v1.png";
import securityPrivacyCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/security-privacy-v1.png";
import shoppingProductsCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/shopping-products-v2.png";
import sportsFitnessCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/sports-fitness-v1.png";
import travelPlacesSuitcaseCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/travel-places-v3-suitcase.png";
import tutorialCourseCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/tutorial-course-v1.png";
import videoCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/video-v2.png";
import webToolCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/web-tool-v1.png";
import workDashboardCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/work-dashboard-v1.png";
import workProductivityCover from "../../../design-assets/bookmark-covers/taxonomy-pilot/work-productivity-v1.png";
export const previewFolders = [
  ["设计赏析", 40],
  ["前端代码与组件", 58],
  ["工作与内部系统", 36],
  ["生活与娱乐", 45],
  ["工具与效率", 52],
  ["前端文章 / 教程", 38]
] as const;
// 使用真实公开页面验证代表图布局；仅存在于 ?preview=1 开发评审页。
export const previewCoverSamples = [
  {
    title: "Sticker Forge — Interactive Sticker Maker",
    url: "https://sticker.oooo.so/",
    imageUrl: "https://sticker.oooo.so/og.png"
  },
  {
    title: "UIBook — Find your next UI idea",
    url: "https://uibook.art/",
    imageUrl:
      "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8acce6a3-1c71-4036-abf0-82e190df5c47/id-preview-95323c3b--354d2877-50f8-4d3f-8761-1963e91ae9ec.lovable.app-1771515272725.png"
  },
  {
    title: "Good Web Design",
    url: "https://good-web-design.com/",
    imageUrl:
      "https://good-web-design.com/wp/wp-content/uploads/2026/07/newcreators2026-960x624.jpg"
  },
  {
    title: "60fps — UI/UX animation inspiration",
    url: "https://60fps.design/",
    imageUrl:
      "https://framerusercontent.com/images/mB8WqomRNWMwPrMEL90Vtl8JGrE.png"
  },
  {
    title: "Recent — Design Inspiration",
    url: "https://recent.design/",
    imageUrl: "https://recent.design/og.png"
  },
  {
    title: "Collect UI — Daily Design Inspiration",
    url: "https://collectui.com/",
    imageUrl: "https://collectui.com/og-image.jpg"
  }
] as const;

// 通用分类封面评审：绑定真实公开网站，仅存在于 ?preview=1。
export const previewGeneratedCovers = [
  {
    title: "Anthropic — AI 与自动化",
    url: "https://www.anthropic.com/",
    imageUrl: aiAutomationCover,
    category: "AI 与自动化"
  },
  {
    title: "GitHub — 代码仓库",
    url: "https://github.com/",
    imageUrl: codeRepositoryCover,
    category: "代码仓库"
  },
  {
    title: "Figma — 设计与创作",
    url: "https://www.figma.com/",
    imageUrl: designCreationCover,
    category: "设计与创作"
  },
  {
    title: "Serious Eats — 美食与烹饪",
    url: "https://www.seriouseats.com/",
    imageUrl: foodCookingCover,
    category: "美食与烹饪"
  },
  {
    title: "Booking.com — 旅行与地点",
    url: "https://www.booking.com/",
    imageUrl: travelPlacesSuitcaseCover,
    category: "旅行与地点"
  },
  {
    title: "MDN Web Docs — 文档与 API",
    url: "https://developer.mozilla.org/",
    imageUrl: documentationApiCover,
    category: "文档与 API"
  },
  {
    title: "YouTube — 视频",
    url: "https://www.youtube.com/",
    imageUrl: videoCover,
    category: "视频"
  },
  {
    title: "Yahoo Finance — 财经与投资",
    url: "https://finance.yahoo.com/",
    imageUrl: financeInvestingCover,
    category: "财经与投资"
  },
  {
    title: "Mayo Clinic — 健康与医疗",
    url: "https://www.mayoclinic.org/",
    imageUrl: healthMedicalCover,
    category: "健康与医疗"
  },
  {
    title: "Amazon — 购物与产品",
    url: "https://www.amazon.com/",
    imageUrl: shoppingProductsCover,
    category: "购物与产品"
  },
  {
    title: "Photopea — Web 工具",
    url: "https://www.photopea.com/",
    imageUrl: webToolCover,
    category: "Web 工具"
  },
  {
    title: "Linear — 工作后台",
    url: "https://linear.app/",
    imageUrl: workDashboardCover,
    category: "工作后台"
  },
  {
    title: "Khan Academy — 教程与课程",
    url: "https://www.khanacademy.org/",
    imageUrl: tutorialCourseCover,
    category: "教程与课程"
  },
  {
    title: "arXiv — 论文与研究",
    url: "https://arxiv.org/",
    imageUrl: paperResearchCover,
    category: "论文与研究"
  },
  {
    title: "Adobe Acrobat — PDF 与报告",
    url: "https://www.adobe.com/acrobat/",
    imageUrl: pdfReportCover,
    category: "PDF 与报告"
  },
  {
    title: "Our World in Data — 数据与图表",
    url: "https://ourworldindata.org/",
    imageUrl: dataChartCover,
    category: "数据与图表"
  },
  {
    title: "Spotify — 音频与播客",
    url: "https://open.spotify.com/",
    imageUrl: audioPodcastCover,
    category: "音频与播客"
  },
  {
    title: "Substack — Newsletter / RSS",
    url: "https://substack.com/",
    imageUrl: newsletterRssCover,
    category: "Newsletter / RSS"
  },
  {
    title: "OpenStreetMap — 地点与地图",
    url: "https://www.openstreetmap.org/",
    imageUrl: placeMapCover,
    category: "地点与地图"
  },
  {
    title: "Eventbrite — 活动与票务",
    url: "https://www.eventbrite.com/",
    imageUrl: eventTicketCover,
    category: "活动与票务"
  },
  {
    title: "Indeed — 职位与招聘",
    url: "https://www.indeed.com/",
    imageUrl: jobCareerCover,
    category: "职位与招聘"
  },
  {
    title: "Behance — 作品集与画廊",
    url: "https://www.behance.net/",
    imageUrl: portfolioGalleryCover,
    category: "作品集与画廊"
  },
  {
    title: "Stack Overflow — 开发与软件",
    url: "https://stackoverflow.com/",
    imageUrl: developmentSoftwareCover,
    category: "开发与软件"
  },
  {
    title: "Google Cloud — 数据与云",
    url: "https://cloud.google.com/",
    imageUrl: dataCloudCover,
    category: "数据与云"
  },
  {
    title: "1Password — 安全与隐私",
    url: "https://1password.com/",
    imageUrl: securityPrivacyCover,
    category: "安全与隐私"
  },
  {
    title: "Arduino — 硬件与设备",
    url: "https://www.arduino.cc/",
    imageUrl: hardwareDevicesCover,
    category: "硬件与设备"
  },
  {
    title: "Artsy — 艺术创作",
    url: "https://www.artsy.net/",
    imageUrl: artCreationCover,
    category: "艺术创作"
  },
  {
    title: "Y Combinator — 商业与创业",
    url: "https://www.ycombinator.com/",
    imageUrl: businessStartupCover,
    category: "商业与创业"
  },
  {
    title: "Todoist — 工作与效率",
    url: "https://todoist.com/",
    imageUrl: workProductivityCover,
    category: "工作与效率"
  },
  {
    title: "MIT OpenCourseWare — 教育与科学",
    url: "https://ocw.mit.edu/",
    imageUrl: educationScienceCover,
    category: "教育与科学"
  },
  {
    title: "BBC — 新闻与社会",
    url: "https://www.bbc.com/",
    imageUrl: newsSocietyCover,
    category: "新闻与社会"
  },
  {
    title: "Strava — 运动与健身",
    url: "https://www.strava.com/",
    imageUrl: sportsFitnessCover,
    category: "运动与健身"
  },
  {
    title: "The Spruce — 居家与家庭",
    url: "https://www.thespruce.com/",
    imageUrl: homeFamilyCover,
    category: "居家与家庭"
  },
  {
    title: "Vogue — 消费与时尚",
    url: "https://www.vogue.com/",
    imageUrl: consumerFashionCover,
    category: "消费与时尚"
  },
  {
    title: "Car and Driver — 汽车与出行",
    url: "https://www.caranddriver.com/",
    imageUrl: automotiveMobilityCover,
    category: "汽车与出行"
  },
  {
    title: "Zillow — 房产与居住",
    url: "https://www.zillow.com/",
    imageUrl: realEstateHousingCover,
    category: "房产与居住"
  },
  {
    title: "Netflix — 娱乐与文化",
    url: "https://www.netflix.com/",
    imageUrl: entertainmentCultureCover,
    category: "娱乐与文化"
  },
  {
    title: "Steam — 游戏与爱好",
    url: "https://store.steampowered.com/",
    imageUrl: gamesHobbiesCover,
    category: "游戏与爱好"
  },
  {
    title: "National Geographic — 自然与宠物",
    url: "https://www.nationalgeographic.com/animals/",
    imageUrl: naturePetsCover,
    category: "自然与宠物"
  },
  {
    title: "Example Domain — 普通网页",
    url: "https://example.com/",
    imageUrl: genericWebpageCover,
    category: "普通网页"
  }
] as const;
