/**
 * Daftar terpusat tag cache, TTL, kelompok invalidasi mutasi, dan header Cache-Control privat
 * untuk Sanghyang Analytics (Next.js 16.4.6 native Data Cache, anggaran $0, tanpa Redis).
 *
 * Setiap tag dibatasi jauh di bawah batas 256 karakter Next.js dan selalu menyertakan `propertyId`
 * untuk data operasional multi-tenant agar tidak pernah bocor lintas properti.
 */

export const CACHE_TAGS = {
  // Operasional VHP, Google Sheets, dan Pengaturan (per properti)
  vhpMeetings: (propertyId: string) => `vhp:meetings:${propertyId}`,
  vhpSales: (propertyId: string) => `vhp:sales:${propertyId}`,
  vhpDashboard: (propertyId: string) => `vhp:dashboard:${propertyId}`,
  vhpOccupancy: (propertyId: string) => `vhp:occupancy:${propertyId}`,
  sheets: (propertyId: string) => `sheets:${propertyId}`,
  settingsTargets: (propertyId: string) => `settings:targets:${propertyId}`,
  settingsBudgets: (propertyId: string) => `settings:budgets:${propertyId}`,
  settingsRooms: (propertyId: string) => `settings:rooms:${propertyId}`,
  settingsMenuRules: (propertyId: string) => `settings:menu-rules:${propertyId}`,
  socialPromos: (propertyId: string) => `marketing:social-promos:${propertyId}`,
  whatsappChats: (propertyId: string) => `marketing:wa-chats:${propertyId}`,
  marketingAds: (propertyId: string) => `marketing:ads:${propertyId}`,

  // Market Intelligence, Knowledge Graph, Media Sosial, dan Jembatan Sinyal Internal
  internalSignals: "mi:internal-signals",
  marketSummary: "mi:summary",
  marketCompetitors: "mi:competitors",
  marketEvidence: "mi:evidence",
  marketOtaDirectory: "mi:ota-directory",
  marketSpecs: "mi:specs",
  marketRoomTypes: "mi:room-types",
  marketMenus: "mi:menus",
  marketSize: "mi:market-size",
  knowledgeGraph: "mi:knowledge-graph",
  marketingSosmed: "mi:marketing-sosmed",
  fnbCompare: "mi:fnb-compare",
  marketingGoals: "mi:goals",
} as const;

/** Durasi revalidate Next.js Data Cache (detik). Mutasi selalu memanggil invalidateTags({ expire: 0 }). */
export const CACHE_TTL = {
  vhp: 300,
  sheets: 300,
  settings: 600,
  marketingAds: 600,
  marketingImpact: 21_600,
  marketIntelligence: 300,
  marketingSosmed: 300,
  adminUsers: 300,
} as const;

/**
 * Header HTTP Cache-Control khusus data privat terotentikasi.
 * JANGAN PERNAH menggunakan `public` atau `s-maxage` pada data operasional atau intelijen pasar privat.
 */
export const PRIVATE_CACHE_CONTROL = {
  standard: "private, max-age=60, stale-while-revalidate=300",
  medium: "private, max-age=120, stale-while-revalidate=300",
  trends: "private, max-age=300, stale-while-revalidate=900",
} as const;

/** Kelompok tag invalidasi per jenis mutasi agar seluruh tampilan hilir langsung segar setelah perubahan. */
export const INVALIDATION_GROUPS = {
  forVhpMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.vhpMeetings(propertyId),
    CACHE_TAGS.vhpSales(propertyId),
    CACHE_TAGS.vhpDashboard(propertyId),
    CACHE_TAGS.vhpOccupancy(propertyId),
    CACHE_TAGS.socialPromos(propertyId),
    CACHE_TAGS.marketingAds(propertyId),
    CACHE_TAGS.internalSignals,
    CACHE_TAGS.marketSize,
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],

  forSheetsMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.sheets(propertyId),
    CACHE_TAGS.vhpDashboard(propertyId),
  ],

  forTargetsMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.settingsTargets(propertyId),
    CACHE_TAGS.vhpDashboard(propertyId),
    CACHE_TAGS.internalSignals,
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],

  forBudgetsMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.settingsBudgets(propertyId),
    CACHE_TAGS.vhpDashboard(propertyId),
  ],

  forRoomsMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.settingsRooms(propertyId),
    CACHE_TAGS.vhpDashboard(propertyId),
    CACHE_TAGS.internalSignals,
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],

  forMenuRulesMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.settingsMenuRules(propertyId),
    CACHE_TAGS.vhpDashboard(propertyId),
  ],

  forSocialPromoMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.socialPromos(propertyId),
    CACHE_TAGS.internalSignals,
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],

  forWhatsappChatMutation: (propertyId: string): readonly string[] => [
    CACHE_TAGS.whatsappChats(propertyId),
    CACHE_TAGS.marketingAds(propertyId),
    CACHE_TAGS.internalSignals,
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],

  forMarketingSosmedMutation: (): readonly string[] => [
    CACHE_TAGS.marketingSosmed,
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],

  forMarketRefreshMutation: (): readonly string[] => [
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.marketCompetitors,
    CACHE_TAGS.marketEvidence,
    CACHE_TAGS.marketOtaDirectory,
    CACHE_TAGS.marketSpecs,
    CACHE_TAGS.marketRoomTypes,
    CACHE_TAGS.marketMenus,
    CACHE_TAGS.marketSize,
    CACHE_TAGS.knowledgeGraph,
    CACHE_TAGS.marketingSosmed,
    CACHE_TAGS.fnbCompare,
  ],

  forGoalsMutation: (): readonly string[] => [
    CACHE_TAGS.marketingGoals,
    CACHE_TAGS.knowledgeGraph,
  ],

  forMarketItemOrInsightMutation: (): readonly string[] => [
    CACHE_TAGS.marketSummary,
    CACHE_TAGS.knowledgeGraph,
  ],
} as const;
