// Curated from GA4 pageviews (analytics-2025-Pages_and_screens...) and server
// request logs (api-7days-most-popular), top 100 from each source, merged and
// deduped case/order-insensitively. These are the *base* (hot) listing paths;
// the popup expands each one into whichever sort variants are checked (see
// SORT_VARIANTS below). Multi-subreddit combos keep their raw "+"-joined form
// here — background.js sorts and hashes them into a bounded filename at fetch
// time. Edit freely in the popup.
const DEFAULT_URL_PATHS = [
  "/r/gonewild/.json",
  "/r/nsfw/.json",
  "/r/gooned/.json",
  "/r/all/.json",
  "/r/nsfw_gifs/.json",
  "/r/cumsluts/.json",
  "/r/realgirls/.json",
  "/r/tittydrop/.json",
  "/r/girlsfinishingthejob/.json",
  "/r/watchitfortheplot/.json",
  "/r/bustypetite/.json",
  "/r/hentai/.json",
  "/r/nsfw_gif/.json",
  "/r/chubby/.json",
  "/r/porn/.json",
  "/r/rule34/.json",
  "/r/ass/.json",
  "/r/kpopfap/.json",
  "/r/yiff/.json",
  "/r/milf/.json",
  "/r/asiansgonewild/.json",
  "/r/blowjobs/.json",
  "/r/traps/.json",
  "/r/onoff/.json",
  "/r/anal/.json",
  "/r/funny/.json",
  "/r/celebs/.json",
  "/r/pussy/.json",
  "/r/petite/.json",
  "/r/celebnsfw/.json",
  "/r/legalteens/.json",
  "/r/hotwife/.json",
  "/r/gwcouples/.json",
  "/r/randnsfw/.json",
  "/r/lipsthatgrip/.json",
  "/r/18_19/.json",
  "/r/boobs/.json",
  "/r/blowjob/.json",
  "/r/.json",
  "/r/cuckold/.json",
  "/r/petitegonewild/.json",
  "/r/couplesgonewild/.json",
  "/r/bodyperfection/.json",
  "/r/femboys/.json",
  "/r/collegesluts/.json",
  "/r/curvy/.json",
  "/r/asshole/.json",
  "/r/gothsluts/.json",
  "/r/tiktokthots/.json",
  "/r/gettingherselfoff/.json",
  "/r/orgasms/.json",
  "/r/porninfifteenseconds/.json",
  "/r/lesbians/.json",
  "/r/gonemild/.json",
  "/r/pornrelapsed/.json",
  "/r/threesome/.json",
  "/r/pawg/.json",
  "/r/gilf/.json",
  "/r/AthleticGirls+Bustyfit+fbb_NSFW+Fit_babes+FitBlackGirls+fitgirls+FitnessGirls+FitNakedGirls+girlswithbigmuscles+gymgirls+GymGirlsNSFW+RealGymBunnies+SlutMuscle+workoutgirls+musclebarbies+musclebeauty+Roidgirls/.json",
  "/r/skinnytail/.json",
  "/r/gonewild30plus/.json",
  "/r/iwanttobeher/.json",
  "/r/holdthemoan/.json",
  "/r/influencernsfw_global+tiktok_gif/.json",
  "/r/tits/.json",
  "/r/futanari/.json",
  "/r/obsf/.json",
  "/r/boobbounce/.json",
  "/r/tiktokporn/.json",
  "/r/normalnudes/.json",
  "/r/extramile/.json",
  "/r/wifesharing/.json",
  "/r/fitgirls/.json",
  "/r/Nudes/.json",
  "/r/sissycaptions/.json",
  "/r/dirtysmall/.json",
  "/r/breedingmaterial/.json",
  "/r/gonewildcouples/.json",
  "/r/creampie/.json",
  "/r/downblouse/.json",
  "/r/godpussy/.json",
  "/r/bikinis/.json",
  "/r/freeuse/.json",
  "/r/deepthroat/.json",
  "/r/doggystyle/.json",
  "/r/grool/.json",
  "/r/asianhotties/.json",
  "/r/latinas/.json",
  "/r/milfs/.json",
  "/r/facials/.json",
  "/r/sssniperwolf_pics/.json",
  "/r/sophiecunninghamnsfw/.json",
  "/r/celebnsfw+celebs+celebsgw+celebsnaked+nudecelebsonly/.json",
  "/r/Gonewild18/.json",
  "/r/earthporn/.json",
  "/r/celinedept+celinedept_esp/.json",
  "/r/spaceporn/.json",
  "/r/kalogerasisters/.json",
  "/r/celebevents+celebnsfw+celebrities+celebs+celebsgw+celebsnaked+gentlemanboners+nudecelebsonly+watchitfortheplot/.json",
  "/r/foodporn/.json",
  "/r/aww/.json",
  "/r/milliebobbybrown2+milliebobbybrownpics+milliebobbybrownhq/.json",
  "/r/gifs/.json",
  "/r/celebnsfw+watchitfortheplot/.json",
  "/r/brookemonkthesecond/.json",
  "/r/girlsfromchess/.json",
  "/r/cinna_brit/.json",
  "/r/nsfw_alexandrabotez/.json",
  "/r/angel_reese+angel_reese_/.json",
  "/r/hottestfemaleathletes/.json",
  "/r/tiktokporn+tiktoknsfw+tiktokthots/.json",
  "/r/shakira/.json",
  "/r/georginarodriguezgio_+georgina_rodriguezz/.json",
  "/r/lydiavioletofficial/.json",
  "/r/twitchasians+offlinetvgirls/.json",
  "/r/zendaya/.json",
  "/r/wandanaravip/.json",
  "/r/caitlinclark+caitlinclarkpics/.json",
  "/r/billieeilishgw/.json",
  "/r/paigebueckersfans/.json",
  "/r/alishalehmann+alisha_lehmann7/.json",
  "/r/oliviadunne+oliviadunnepictures/.json",
  "/r/girlstennis+hottestfemaleathletes/.json",
  "/r/dafnekeen+dafnekeenlove/.json",
  "/r/indenavarrettegw+indenavarrettelewd/.json",
  "/r/madisonbeer+madisonbeerlewd/.json",
  "/r/emmadarcy/.json",
  "/r/thehannahwaddingham/.json",
  "/r/influencernsfw_global/.json",
  "/r/tyla/.json",
  "/r/alysaliu/.json",
  "/r/kyliejenner/.json",
  "/r/yonnajayy/.json",
  "/r/xfibiixfan/.json",
  "/r/kelseyplum/.json",
  "/r/sadiesink/.json",
  "/r/pics/.json",
  "/r/monicabarbaro/.json",
  "/r/icespice+icespicegw/.json",
  "/r/celebritybutts+celebrityasses/.json",
  "/r/valkyraehott/.json",
  "/r/charlidamelio654/.json",
  "/r/tarayummyfans/.json",
  "/r/thelegitboss/.json",
  "/r/gonewild+NSFW_GIF+nsfw+RealGirls+Celebs+nsfw_gifs+pornvids/.json",
  "/r/models/.json",
];

// Sort variants each base path can be expanded into. "hot" is the bare
// listing the base paths already are; the rest are Reddit's /top listings
// with a time window, which is what makes an archived snapshot worth
// anything — /top?t=all barely changes, so a cached copy stays useful long
// after the hot listing has gone stale.
const SORT_VARIANTS = [
  { id: "hot", label: "hot", suffix: "/.json" },
  { id: "top-month", label: "top month", suffix: "/top/.json?t=month" },
  { id: "top-year", label: "top year", suffix: "/top/.json?t=year" },
  { id: "top-all", label: "top all", suffix: "/top/.json?t=all" },
];

// "/r/gifs/.json" + "/top/.json?t=year" -> "/r/gifs/top/.json?t=year"
function applyVariant(basePath, variant) {
  const stem = basePath
    .split("?")[0]
    .replace(/\/?\.json$/, "")
    .replace(/\/+$/, "");
  return `${stem}${variant.suffix}`;
}

// Variant-major, not path-major: every base path is fetched as hot before
// any /top request is made. At 5-15s per download a full 4-variant run is
// hours long, so an interrupted run should leave a complete hot snapshot
// behind rather than a complete snapshot of the first quarter of the list.
function expandPaths(basePaths, variantIds) {
  const chosen = SORT_VARIANTS.filter((v) => variantIds.includes(v.id));
  const out = [];
  for (const variant of chosen) {
    for (const basePath of basePaths) {
      out.push(applyVariant(basePath, variant));
    }
  }
  return out;
}
