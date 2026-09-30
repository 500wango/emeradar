import { Locale } from '@emeradar/core';

export { Locale };

export const LOCALES: Locale[] = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE: Locale = 'zh-CN';

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};

export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  'zh-CN': '中文',
  'en-US': 'EN',
};

export interface TranslationDictionary {
  common: {
    brand: string;
    tagline: string;
    language: string;
    switchLanguage: string;
    save: string;
    saving: string;
    saved: string;
    cancel: string;
    delete: string;
    edit: string;
    create: string;
    back: string;
    loading: string;
    search: string;
    searchPlaceholder: string;
    copy: string;
    copied: string;
    view: string;
    status: string;
    active: string;
    all: string;
    reset: string;
    resetFilters: string;
    filter: string;
    close: string;
    error: string;
    success: string;
    unknown: string;
    confirmed: string;
    unverified: string;
    daysAgo: string;
    today: string;
    date: string;
    action: string;
    verdicts: {
      BUILD_NOW: string;
      EARLY_BET: string;
      WATCH: string;
      WINDOW_CLOSING: string;
      PASS: string;
    };
    archetypes: {
      LIGHTWEIGHT_TOOL: string;
      MICRO_SAAS: string;
      WORKFLOW_ENGINE: string;
      AI_AGENT: string;
      DATA_SERVICE: string;
      API_FIRST: string;
      PSEO_SITE: string;
      DIRECTORY: string;
      CONTENT_SITE: string;
      TOOL: string;
    };
    executionClasses: {
      SOLO_BUILDER: string;
      SMALL_TEAM: string;
      CAPITAL_INTENSIVE: string;
      S: string;
      M: string;
      L: string;
    };
    bands: {
      HIGH: string;
      MEDIUM: string;
      LOW: string;
      INSUFFICIENT: string;
    };
    evidenceClasses: {
      OBSERVED: string;
      SELF_REPORTED: string;
      THIRD_PARTY_ESTIMATE: string;
      INFERRED: string;
    };
  };
  nav: {
    opportunities: string;
    trackRecord: string;
    projects: string;
    alerts: string;
    methodology: string;
    pricing: string;
    billing: string;
    login: string;
    signup: string;
    logout: string;
    accountSettings: string;
    myProjects: string;
    teamScale: string;
    builderPro: string;
    freeStarter: string;
  };
  footer: {
    tagline: string;
    merkleProof: string;
    trackRecord: string;
    liveFeed: string;
    pricing: string;
    copyright: string;
    builtFor: string;
  };
  home: {
    badge: string;
    heroTitle: string;
    heroDesc: string;
    ctaDecisions: string;
    ctaMethodology: string;
    ctaPricing: string;
    pillarDemandTitle: string;
    pillarDemandDesc: string;
    pillarCommercialTitle: string;
    pillarCommercialDesc: string;
    pillarWindowTitle: string;
    pillarWindowDesc: string;
    publishedBuildNowTitle: string;
    publishedBuildNowDesc: string;
    openFeed: string;
    gatedMessage: string;
    signInToView: string;
  };
  feed: {
    badge: string;
    title: string;
    desc: string;
    delayRealtime: string;
    delayDays: string;
    tabAll: string;
    tabBuildNow: string;
    tabEarlyBet: string;
    tabWatch: string;
    tabWindowClosing: string;
    archetypeFilter: string;
    classFilter: string;
    allArchetypes: string;
    allClasses: string;
    searchPlaceholder: string;
    resetFilters: string;
    noResults: string;
    demand: string;
    commercial: string;
    window: string;
    viewFullReport: string;
    inspectEvidence: string;
    startExperiment: string;
    trackRequestTitle: string;
    trackRequestDesc: string;
    trackRequestPlaceholder: string;
    trackRequestBtn: string;
    sourceDiscoveriesTitle: string;
    sourceDiscoveriesDesc: string;
    noDiscoveries: string;
    liveObservationsTitle: string;
    liveObservationsDesc: string;
    noObservations: string;
    liveScannerTitle: string;
    liveScannerDesc: string;
    activeExperimentsTitle: string;
    activeExperimentsDesc: string;
    noExperiments: string;
  };
  trackRecord: {
    badge: string;
    title: string;
    desc: string;
    hitRate30d: string;
    hitRateDesc: string;
    hitRateEmpty: string;
    evaluatedEpisodes: string;
    evaluatedDesc: string;
    totalPredictions: string;
    totalPredictionsDesc: string;
    openBetRate: string;
    openBetDesc: string;
    ledgerHeight: string;
    ledgerHeightDesc: string;
    checkpointsTitle: string;
    checkpointsDesc: string;
    episodesTitle: string;
    episodesDesc: string;
    evaluationProtocol: string;
    colOpportunity: string;
    colObsDate: string;
    colVerdict: string;
    colHorizon: string;
    colOutcome: string;
    colProof: string;
    outcome30d: string;
    outcome60d: string;
    observedMetric: string;
    verifyProof: string;
    noEpisodes: string;
    hashChainActive: string;
    sealedCount: string;
    inspect: string;
  };
  methodology: {
    badge: string;
    title: string;
    intro: string;
    lifecycleTitle: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    step5: string;
    gateTitle: string;
    gateItem1: string;
    gateItem2: string;
    gateItem3: string;
    gateItem4: string;
    gateFooter: string;
    bandsTitle: string;
    bandsIntro: string;
    closingNote: string;
    earlyBetNote: string;
    claimsTitle: string;
    claimItem1: string;
    claimItem2: string;
    claimItem3: string;
    claimItem4: string;
    readProof: string;
    viewLedger: string;
    explorePricing: string;
    backToFeed: string;
  };
  pricing: {
    badge: string;
    title: string;
    desc: string;
    monthly: string;
    yearly: string;
    save20: string;
    currentPlan: string;
    workspaceTier: string;
    monthlyReports: string;
    trackedProjects: string;
    alertRules: string;
    used: string;
    remaining: string;
    active: string;
    alertsConfigured: string;
    webhookDelivery: string;
    upgradeToPro: string;
    contactTeam: string;
    currentActive: string;
    gscSyncIncluded: string;
    popularBadge: string;
    getStartedFree: string;
    upgradeNow: string;
    startTrial: string;
    contactSales: string;
    includedBaseline: string;

    // Plans
    planFreeTitle: string;
    planFreePrice: string;
    planFreeDesc: string;
    freeFeatures: string[];

    planProTitle: string;
    planProMonthlyPrice: string;
    planProYearlyPrice: string;
    planProBilledYearly: string;
    planProDesc: string;
    proFeatures: string[];

    planTeamTitle: string;
    planTeamMonthlyPrice: string;
    planTeamYearlyPrice: string;
    planTeamBilledYearly: string;
    planTeamDesc: string;
    teamFeatures: string[];

    // Marketing value anchor / why us
    whyTitle: string;
    whySubtitle: string;
    stat1Number: string;
    stat1Label: string;
    stat1Desc: string;
    stat2Number: string;
    stat2Label: string;
    stat2Desc: string;
    stat3Number: string;
    stat3Label: string;
    stat3Desc: string;

    // Comparison matrix
    matrixTitle: string;
    matrixSubtitle: string;
    colFeature: string;
    colFree: string;
    colPro: string;
    colTeam: string;
    matrixRows: Array<{
      feature: string;
      free: string;
      pro: string;
      team: string;
    }>;

    // Guarantee & Trust
    guaranteeTitle: string;
    guaranteeDesc: string;
    badgeCancel: string;
    badgeRefund: string;
    badgeCrypto: string;

    // FAQ
    faqTitle: string;
    faqSubtitle: string;
    faqs: Array<{ q: string; a: string }>;

    // Bottom CTA
    bottomCtaTitle: string;
    bottomCtaDesc: string;
    bottomCtaBtn: string;
    bottomCtaTrackRecord: string;

    // Legacy fields preserved for compatibility
    designPartners?: string;
    pricingInInterviews?: string;
    joinDesignPartners?: string;
    notInRelease?: string;
    notInReleaseDesc?: string;
    notInReleaseItems?: string[];
    planProPrice?: string;
    planTeamPrice?: string;

    // Invoices
    invoicesTitle: string;
    noInvoices: string;
    colInvoiceDate: string;
    colAmount: string;
    colStatus: string;
    colReceipt: string;
    viewPdf: string;
  };
  auth: {
    loginTitle: string;
    loginDesc: string;
    registerTitle: string;
    registerDesc: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    nameLabel: string;
    namePlaceholder: string;
    signInBtn: string;
    signUpBtn: string;
    signingIn: string;
    signingUp: string;
    orEmail: string;
    newToPlatform: string;
    alreadyHaveAccount: string;
    createAccountLink: string;
    signInLink: string;
    loginFailed: string;
    registerFailed: string;
    securityFootnote: string;
  };
  settings: {
    title: string;
    managePlan: string;
    tabProfile: string;
    tabPreferences: string;
    tabApiKeys: string;
    tabBilling: string;
    accountRole: string;
    accountStatus: string;
    currentPlanCard: string;
    entitlements: string;
    securityCard: string;
    securityCardDesc: string;
    targetMarketsTitle: string;
    targetMarketsDesc: string;
    preferredArchetypesTitle: string;
    preferredArchetypesDesc: string;
    languageTitle: string;
    languageDesc: string;
    languageSelect: string;
    savePreferencesBtn: string;
    preferencesUpdated: string;
    apiKeysTitle: string;
    apiKeysDesc: string;
    generateKeyBtn: string;
    keyLabelPlaceholder: string;
    activeKeys: string;
    noKeys: string;
    revokeBtn: string;
    secretWarning: string;
    copyKeyBtn: string;
    copiedKeyBtn: string;
  };
  projects: {
    badge: string;
    title: string;
    desc: string;
    launchFromOpp: string;
    noProjectsTitle: string;
    noProjectsDesc: string;
    browseOpportunities: string;
    colProject: string;
    colStatus: string;
    colOutcomes: string;
    colActions: string;
    viewDetail: string;
    siteReadiness: string;
    runSiteCheck: string;
    checking: string;
    weeklyData: string;
    colWeek: string;
    colImpressions: string;
    colClicks: string;
    colPosition: string;
    backToProjects: string;
    kindExperiment: string;
    kindFormal: string;
    launchedDate: string;
    inDev: string;
    linkedOpp: string;
    earlyExpNote: string;
    gscImpressions: string;
    organicClicks: string;
    targetKeywords: string;
    noDomain: string;
    pending: string;
    awaitingGsc: string;
    impressionsQueries: string;
  };
  alerts: {
    badge: string;
    title: string;
    desc: string;
    activeRulesTitle: string;
    activeRulesCount: string;
    noRulesDesc: string;
    recentEventsTitle: string;
    noEventsDesc: string;
    frequency: string;
    noNotifications: string;
  };
  opportunityDetail: {
    backToFeed: string;
    opportunityTitle: string;
    statusBadge: string;
    whyNowThesis: string;
    demandSection: string;
    commercialSection: string;
    windowSection: string;
    exportReport: string;
    killCriteria: string;
    evidenceLedger: string;
    painPoints: string;
    trendsAnalysis: string;
    commercialPanel: string;
    goBtn: string;
    watchBtn: string;
    passBtn: string;
    watchingSuccess: string;
    goSuccess: string;
    passSuccess: string;
    passReasonsPrompt: string;
    confirmPass: string;
  };
  report: {
    title: string;
    backToWorkspace: string;
    tabPreview: string;
    tabMarkdown: string;
    copyMarkdown: string;
    copiedMarkdown: string;
    printReport: string;
    downloadHtml: string;
  };
}
