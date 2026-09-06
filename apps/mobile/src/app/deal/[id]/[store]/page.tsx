"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowUp, Check, ChevronDown, Clock3, Info, Share, ShieldCheck, X } from "lucide-react";
import {
  loadLiveProducts,
  refreshLiveProducts,
  fetchPriceHistory90d,
  validateCurrentDeal,
  applyTargetedDealToProducts,
  updateCatalogueCacheProducts,
  type ProductCard,
  type PriceHistoryPoint,
  type AssessmentVerdict,
  isUncertainAssessment,
  getAssessmentVerdict,
  buildAssessmentSummaryCopy,
  getStoreProductUrl,
  getRealAveragePrice,
  buildRankingList,
  buildVisibleRanking,
  buildBarChartData,
  buildPriceHistoryInsights,
  findCheaperAlternatives,
  findDealForStore,
  normalizeStoreKey,
  logDealCheck,
  describeFetchError,
} from "@dodgey-deals/shared";
import { supabaseConfig } from "@/lib/config";
import { useAuth } from "@/lib/auth-context";
import { useSearch } from "@/lib/search-context";
import { getSupabaseClient } from "@/lib/supabase-client";
import { getStoreLogoMeta } from "@/lib/store-meta";
import { usePageHeader } from "@/lib/header-context";
import StoreCompareChart from "@/components/StoreCompareChart";
import PriceHistoryInsightCard from "@/components/PriceHistoryInsightCard";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import AssessmentText from "@/components/AssessmentText";
import InsightCarousel from "@/components/InsightCarousel";
import ErrorState from "@/components/ErrorState";
import AddToListButton from "@/components/AddToListButton";
import ProductImage from "@/components/ProductImage";
import { subscribeToCatalogueUpdates, publishCatalogueUpdate } from "@/lib/catalogue-refresh";

/**
 * Deal-assessment page — ported from Prototype/index.html's `DealModal`
 * (its "Check Deal" screen: reached by tapping a product card). See
 * `packages/shared/src/deal-detail.ts` for the ported data logic; this file
 * is the JSX/presentation half, copied class-for-class from the prototype
 * wherever this app's real routing/data model allows.
 *
 * Route: `/deal/[id]/[store]` — `id` is the match-group `ProductCard.id`
 * (same id `ProductListCard`/`DealCard` already key off), `store` is the
 * raw store name (`CurrentDeal.store`, e.g. "Woolworths NZ"), URL-encoded.
 * A real route rather than a modal overlay (Jay's ask, 2026-08-09) — the
 * prototype renders this as a modal because it has no router; this app
 * already has one, and every other screen here is a real route.
 *
 * Deliberate differences from the prototype, flagged rather than silently
 * dropped:
 *  - No bottom "Regular/Special min/max by store" pricing-stats table —
 *    that remains a separate UI follow-up. This page now does make one small,
 *    targeted `price_history` fetch for the 90-day chart below; the full
 *    catalogue still does not load raw history (`ProductCard.priceHistory`
 *    remains `[]`, see data.ts).
 *  - No search bar on this page (2026-08-17, per Jay: "Remove the search
 *    bar on the deal assessment pages"). This page briefly rendered the
 *    real, shared `SearchBar.tsx` component earlier the same day (replacing
 *    an old hand-rolled lookalike -- see project.md for that history), but
 *    Jay's next ask removed it outright rather than reverting to the
 *    lookalike. `useSearch()` is still imported/used below for the
 *    "return to search results after Back" behaviour (`returnToSearch`/
 *    `resumeAfterDealBack`), which is unrelated to rendering a search bar
 *    on this page itself.
 *  - "Add to List" is always shown (no `isTracked`-based hide) and IS
 *    literally `AddToListButton.tsx` (imported, not re-implemented) --
 *    originally this page ported the prototype's own full-width sticky
 *    bottom bar instead, wired to the same multi-list picker via a
 *    bespoke local `AddToListBar` function; replaced 2026-08-12, per
 *    Jay's ask, with the shared component sitting inline next to Share,
 *    since Jay's target look (small circle, "+" icon) was now identical
 *    to what that shared component already renders everywhere else.
 *  - The bottom tab bar is this app's real, persistent `BottomNav`
 *    (mounted globally in layout.tsx), not the prototype's own
 *    Check-deals/My-List/All-Checks/Deal-stats nav -- that exact tab set
 *    doesn't exist here, but as of 2026-08-11 "All Checks"/"Deal Stats"
 *    themselves DO (`/history`, `/me`), reached from Me rather than their
 *    own bottom-nav tabs (Jay's call, see project.md).
 *  - Every real, signed-in (non-fake-session) visit to this page logs a
 *    `deal_checks` row (2026-08-11) -- see the `logDealCheck` effect below
 *    and `packages/shared/src/deal-checks.ts`'s own header comment. Not in
 *    the prototype, which appends to a local `history` array on the same
 *    "Check Deals" tap instead (no backend at all there).
 */

/**
 * `getStoreLogoMeta(store).bg` gives a *background* class ("bg-emerald-600")
 * for the store badge. The prototype's DealModal also derives a *text*
 * color from it via `.bg.replace('bg-', 'text-')` for the "Lowest at X"
 * line -- safe there because it runs against Tailwind's browser CDN build
 * (compiles every possible utility on demand), but this app's real Tailwind
 * v4 build only generates classes that appear as literal strings somewhere
 * in source; a runtime string-replace produces a class name Tailwind never
 * saw and never generates CSS for. This literal map sidesteps that instead
 * of porting the bug.
 */
const STORE_TEXT_COLOR: Record<string, string> = {
  "bg-emerald-600": "text-emerald-600",
  "bg-amber-600": "text-amber-600",
  "bg-rose-600": "text-rose-600",
  "bg-green-600": "text-green-600",
  "bg-stone-600": "text-stone-600",
};

function storesMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeStoreKey(left);
  const normalizedRight = normalizeStoreKey(right);
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function joinStoreNames(stores: string[]): string {
  if (stores.length <= 1) return stores[0] ?? "the listed supermarket";
  if (stores.length === 2) return `${stores[0]} and ${stores[1]}`;
  return `${stores.slice(0, -1).join(", ")}, and ${stores[stores.length - 1]}`;
}

/**
 * Verdict badge, ADDED 2026-08-20, per Jay: "Is there a badge we can use for
 * fair and dodge deal assessment pages? so the badge usage is consistent" --
 * this page previously only showed a badge for `verdict === "Real Saver"`
 * (the "Verified special" badge, added earlier the same day -- see that
 * change's own doc comment further down, near where it renders). Dodgy Deal
 * and Fair Deal verdicts got no badge at all, which read as inconsistent
 * once Real Saver had one: not "this verdict has no badge because there's
 * nothing to say," just an asymmetry. All 5 `AssessmentVerdict` values now
 * get one, same `.dd-badge` primitive, same size/icon convention.
 *
 * Colors reuse this file's own existing `verdictBgClass`/`verdictBorderClass`
 * semantics (`fair`/`alert`/`dodgy` per verdict) rather than inventing a new
 * palette -- `dd-badge-dodgy` for Fair Deal isn't a typo: the `.dd-badge-*`
 * class *names* are color-token names, not verdict names, and the
 * `ProductListCard.tsx`/`ListItemProductCard.tsx` verdict badges already
 * established this exact mapping (Fair Price -> the amber "dodgy" token, see
 * those files' own `DEAL_TYPE_BADGE` maps) -- matched here, not reinvented,
 * for the "consistent" part of Jay's ask.
 *
 * Labels avoid repeating the big `{verdict}` heading word-for-word (a badge
 * reading "Dodgy Deal" directly under an "Dodgy Deal" `<h2>` would be pure
 * noise) -- each names the specific claim instead: "Verified special" (this
 * price was checked against a real recent price and is genuinely lower),
 * "Dodgy discount" (the opposite -- the "special" price is at or above a
 * recent real price), "Fair price" (no unusual pricing either way, whether
 * or not it happens to be on special right now), plus "Early flag" and
 * "Limited history" for incomplete evidence.
 */
const VERDICT_BADGE: Record<AssessmentVerdict, { label: string; className: string; icon: typeof ShieldCheck }> = {
  "Real Saver": { label: "Verified special", className: "dd-badge-fair", icon: ShieldCheck },
  "Dodgy Deal": { label: "Dodgy discount", className: "dd-badge-alert", icon: AlertTriangle },
  "Fair Deal": { label: "Fair price", className: "dd-badge-dodgy", icon: Info },
  "Early read": { label: "Early flag", className: "dd-badge-neutral", icon: Clock3 },
  "Limited history": { label: "Limited history", className: "dd-badge-neutral", icon: Clock3 },
};

export default function DealAssessmentPage() {
  const params = useParams<{ id: string; store: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { products: catalogueProducts, returnToSearch, resumeAfterDealBack } = useSearch();

  const productId = decodeURIComponent(params.id);
  const dealStore = decodeURIComponent(params.store);

  const [products, setProducts] = useState<ProductCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Same plain-counter retry pattern as search-context.tsx/specials/page.tsx
  // (2026-08-11) -- lets ErrorState's Try Again button re-run the fetch
  // below instead of leaving "Couldn't load this deal" as a dead end.
  const [retryTick, setRetryTick] = useState(0);
  const staleRetryKeyRef = useRef<string | null>(null);
  const targetedValidationKeyRef = useRef<string | null>(null);
  const confirmedMissingDealRef = useRef<{
    routeKey: string;
    sourceProductId: string;
    sourceStoreId: string;
  } | null>(null);
  // Resets `loadError` here (an event handler, not the effect body --
  // setting state synchronously inside the effect itself trips this
  // project's react-hooks/set-state-in-effect rule) before bumping
  // `retryTick`, so ErrorState swaps for PageLoader the instant Try Again is
  // tapped rather than waiting a frame for the effect to notice.
  const retry = useCallback(() => {
    setLoadError(null);
    setRetryTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLiveProducts(supabaseConfig)
      .then((rows) => {
        if (!cancelled) setProducts(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeFetchError(err, "Failed to load deal data"));
      });
    return () => {
      cancelled = true;
    };
  }, [retryTick]);

  // Keep this route's local deal snapshot in sync when the global pull-to-
  // refresh gesture runs on another page.
  useEffect(() => {
    return subscribeToCatalogueUpdates((result) => {
      setProducts(result);
      setLoadError(null);
    });
  }, []);

  const product = useMemo(() => products?.find((p) => p.id === productId) ?? null, [products, productId]);
  // The deal route fetches its own validated snapshot, but the tapped card's
  // product is already in the global catalogue. Use that name immediately so
  // the shared header never publishes a temporary "Deal" title while the
  // detail fetch is in flight. Direct/deep links fall back to the app title
  // until their product snapshot resolves.
  const headerProduct = useMemo(
    () => product ?? catalogueProducts.find((p) => p.id === productId) ?? null,
    [catalogueProducts, product, productId]
  );
  const deal = useMemo(() => (product ? findDealForStore(product.currentDeals, dealStore) : undefined), [product, dealStore]);

  const priceHistoryKey =
    deal?.sourceProductId && deal.sourceStoreId ? `${deal.sourceProductId}::${deal.sourceStoreId}` : null;
  const [priceHistoryResult, setPriceHistoryResult] = useState<{
    key: string;
    points: PriceHistoryPoint[];
    error: string | null;
  } | null>(null);
  const priceHistoryLoading = priceHistoryKey != null && priceHistoryResult?.key !== priceHistoryKey;
  const priceHistoryPoints = priceHistoryResult?.key === priceHistoryKey ? priceHistoryResult.points : [];

  // The catalogue carries summary history statistics only. The detail page
  // fetches this one product/store's sparse transition series on demand,
  // keeping the 90-day chart useful without adding thousands of rows to the
  // full catalogue payload.
  useEffect(() => {
    if (!priceHistoryKey || !deal?.sourceProductId || !deal.sourceStoreId) return;
    let cancelled = false;
    fetchPriceHistory90d(supabaseConfig, deal.sourceProductId, deal.sourceStoreId)
      .then((points) => {
        if (!cancelled) setPriceHistoryResult({ key: priceHistoryKey, points, error: null });
      })
      .catch(() => {
        if (!cancelled) setPriceHistoryResult({ key: priceHistoryKey, points: [], error: "history-unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [priceHistoryKey, deal?.sourceProductId, deal?.sourceStoreId]);

  // The catalogue is intentionally allowed to render from IndexedDB first,
  // but a deal assessment should validate the exact retailer row in the
  // background. This is one small cache read instead of another full
  // catalogue download, and it catches both verdict changes and specials
  // that have rolled off since the catalogue snapshot was saved.
  useEffect(() => {
    if (!products || !product || deal?.isOnSpecial === false || !deal?.sourceProductId || !deal.sourceStoreId) return;
    const sourceProductId = deal.sourceProductId;
    const sourceStoreId = deal.sourceStoreId;
    const validationKey = `${sourceProductId}::${sourceStoreId}`;
    if (targetedValidationKeyRef.current === validationKey) return;
    targetedValidationKeyRef.current = validationKey;

    let cancelled = false;
    validateCurrentDeal(supabaseConfig, sourceProductId, sourceStoreId)
      .then(({ row }) => {
        if (cancelled) return;
        const nextProducts = applyTargetedDealToProducts(products, sourceProductId, sourceStoreId, row);
        if (row === null) {
          confirmedMissingDealRef.current = {
            routeKey: `${productId}::${dealStore}`,
            sourceProductId,
            sourceStoreId,
          };
        } else {
          confirmedMissingDealRef.current = null;
        }
        setProducts(nextProducts);
        void updateCatalogueCacheProducts(nextProducts);
        publishCatalogueUpdate(nextProducts);
      })
      .catch(() => {
        // Keep the cached assessment visible if the small revalidation request
        // fails. The existing full-refresh/error paths remain available.
      });

    return () => {
      cancelled = true;
    };
  }, [products, product, deal, productId, dealStore]);

  // A stale deep link can miss because the product or its store deal rolled
  // off the live catalogue. Retry once through the shared cooldown-guarded
  // refresh before showing the final "no longer exists" state. The key guard
  // prevents an expired link from causing a refresh loop.
  useEffect(() => {
    if (products === null || loadError || (product && deal)) return;
    const retryKey = `${productId}::${dealStore}`;
    if (staleRetryKeyRef.current === retryKey) return;
    staleRetryKeyRef.current = retryKey;
    let cancelled = false;
    refreshLiveProducts(supabaseConfig)
      .then((result) => {
        if (!cancelled) {
          const confirmedMissing = confirmedMissingDealRef.current;
          const refreshedProducts = confirmedMissing?.routeKey === retryKey
            ? applyTargetedDealToProducts(
                result.products,
                confirmedMissing.sourceProductId,
                confirmedMissing.sourceStoreId,
                null
              )
            : result.products;
          setProducts(refreshedProducts);
          setLoadError(null);
          publishCatalogueUpdate(refreshedProducts);
        }
      })
      .catch(() => {
        // The normal missing-deal state below remains the useful fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [products, loadError, product, deal, productId, dealStore]);

  // Logs this view to `deal_checks` (2026-08-11, backs the ported "All
  // Checks"/"Deal Stats" screens -- see packages/shared/src/deal-checks.ts's
  // own header comment) the first time `product`/`deal` both resolve for a
  // signed-in session. `loggedCheckRef` guards against re-firing on every
  // subsequent render this effect's dependencies happen to touch (e.g.
  // `retry` re-fetching `products`) -- one page visit is one check, not one
  // check per re-render. No longer gated on the dev test account
  // (2026-08-13) -- that account is a real Supabase anonymous sign-in now
  // (see auth-context.tsx's own doc comment), with a real JWT that passes
  // this table's RLS `WITH CHECK` exactly like a normal signed-in user, so
  // the old `isFakeSession` skip (needed back when that account had no real
  // session to insert with at all) no longer applies -- same reasoning as
  // `lists/page.tsx`'s create/delete guards coming out entirely rather than
  // just being renamed. Fire-and-forget from this page's own point of view
  // -- a failed write here shouldn't block or degrade the deal-assessment
  // UI itself, which is why this doesn't feed into `loadError`/any visible
  // state, just a console warning if it fails.
  const loggedCheckRef = useRef(false);
  useEffect(() => {
    if (loggedCheckRef.current || !user || !product || !deal) return;
    loggedCheckRef.current = true;
    logDealCheck(getSupabaseClient(), user.id, product.id, deal.store, deal.price, deal.originalPrice, deal.dealType).catch(
      (err: unknown) => {
        console.warn("logDealCheck failed:", err instanceof Error ? err.message : err);
      }
    );
  }, [user, product, deal]);

  // "Cheaper alternatives" display, 3rd iteration: full page-swap (until
  // 2026-08-12) -> bottom sheet overlay (2026-08-12 to 2026-08-21) -> now
  // an inline expand/collapse carousel (2026-08-21, per Jay's ask: "the
  // container will grow and show a carousel of the cheaper options
  // (instead of the bottom sheet)"). Plain boolean now instead of the old
  // `currentView: "assessment" | "cheaper-alternatives"` union -- this no
  // longer swaps between two whole VIEWS (the assessment content stays on
  // screen either way), it just shows/hides one inline section, so a
  // boolean is what the state actually means now.
  const [showCheaperCarousel, setShowCheaperCarousel] = useState(false);
  const [priceHistoryTab, setPriceHistoryTab] = useState<"insights" | "90-days">("90-days");
  const [showProductImage, setShowProductImage] = useState(false);
  const [isNavigatingBack, setIsNavigatingBack] = useState(false);
  const [isEntryAnimationReady, setIsEntryAnimationReady] = useState(false);
  const backNavigationStartedRef = useRef(false);

  // Hold the incoming slide until this route's data is ready, so the page
  // appears as one complete surface rather than revealing half-loaded cards.
  useEffect(() => {
    if (isEntryAnimationReady || (products === null && !loadError)) return;
    const timer = window.setTimeout(() => setIsEntryAnimationReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [isEntryAnimationReady, products, loadError]);

  useEffect(() => {
    if (!showProductImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowProductImage(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showProductImage]);

  // Reopens the full-screen search overlay instead of just falling through
  // to whatever route was underneath it (2026-08-10, per Jay's ask: "land
  // back on the search results page they began on, with any searched term
  // or results still in there") -- but only when `returnToSearch` (set by
  // `FullScreenSearch`'s own card tap, see search-context.tsx) actually
  // matches THIS deal, not a stale pending return left over from an
  // earlier, abandoned deal-page visit (e.g. one the user left via
  // BottomNav instead of this back button). `router.back()` still runs
  // either way, so the underlying route (Home, /specials, wherever) is
  // correctly restored for if/when the user closes search normally
  // afterwards via its own back arrow.
  const onBack = () => {
    if (backNavigationStartedRef.current) return;
    backNavigationStartedRef.current = true;
    setIsNavigatingBack(true);
    window.setTimeout(() => {
      if (returnToSearch && returnToSearch.productId === productId && returnToSearch.store === dealStore) {
        resumeAfterDealBack();
      }
      router.back();
    }, 280);
  };
  // No longer branches on `currentView` (2026-08-12, and still true after
  // the 2026-08-21 bottom-sheet -> inline-carousel change) -- "cheaper
  // alternatives" has never been its own full-page view since 2026-08-12,
  // first as a sheet layered over this view, now as a section that expands
  // in place within it, so the global header stays on this page's own
  // title/back button throughout either way.
  const headerTitle = headerProduct?.name ?? null;
  usePageHeader(headerTitle, onBack);

  const rankingList = useMemo(() => (product ? buildRankingList(product) : []), [product]);
  const visibleRanking = useMemo(() => (product ? buildVisibleRanking(product, rankingList) : []), [product, rankingList]);
  const barChartData = useMemo(() => (product ? buildBarChartData(product) : []), [product]);
  // Always "all" stores now (2026-08-12) -- the supermarket filter pills
  // that used to let Jay narrow this down (`selectedStores` state +
  // `handleStoreToggle`) were removed per his ask ("don't display
  // supermarket pills on the cheaper alternatives page"), so there's no UI
  // left that ever changes this; passing the literal array inline instead
  // of keeping a never-updated state variable around.
  const cheaperAlternatives = useMemo(
    () => (product && deal && products ? findCheaperAlternatives(product, products, deal.price, ["all"]) : []),
    [product, deal, products]
  );
  // Summary insight tiles for the tabbed Price History Insights panel. Built
  // from the `dodgy_deals` view's price_history_90d_* columns (see data.ts) --
  // returns [] below MIN_90D_SAMPLES_FOR_INSIGHTS, while the separate 90-day
  // tab can still show its raw transition chart when that summary gate is not
  // met.
  const insights = useMemo(() => (deal ? buildPriceHistoryInsights(deal) : []), [deal]);

  if (loadError) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 pt-10 text-center">
          <ErrorState message="Couldn't load this deal." detail={loadError} onRetry={retry} />
          {/* text-[13px] -> text-sm (14px), 2026-08-20, per Jay: "Increase
              all body texts on the deal assessment page to be 14px for
              readability" -- see this file's own note further down (near
              the first bumped paragraph) for the full scope of what counts
              as "body text" for this pass. */}
          <Link href="/" className="text-sm leading-4 font-bold text-ink-600 underline">
            Back to Home
          </Link>
        </div>
      </>
    );
  }

  if (products === null) {
    return <div className="min-h-full page-paper-surface" aria-busy="true" />;
  }

  if (!product || !deal) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-bold text-stone-700">This deal isn&rsquo;t on special right now.</p>
          <p className="text-sm leading-4 text-stone-500">It may have ended, or the link is out of date.</p>
          <Link href="/" className="text-sm leading-4 font-bold text-ink-600 underline">
            Back to Home
          </Link>
        </div>
      </>
    );
  }

  const verdict = getAssessmentVerdict(deal);
  const uncertain = isUncertainAssessment(verdict);
  const verdictColorClass =
    verdict === "Real Saver" ? "text-fair-800" : verdict === "Dodgy Deal" ? "text-alert-800" : uncertain ? "text-stone-700" : "text-dodgy-900";
  const verdictBgClass =
    verdict === "Real Saver" ? "bg-fair-50" : verdict === "Dodgy Deal" ? "bg-alert-50" : uncertain ? "page-paper-surface" : "bg-dodgy-50";
  const verdictBorderClass =
    verdict === "Real Saver" ? "border-fair-200" : verdict === "Dodgy Deal" ? "border-alert-200" : uncertain ? "border-stone-200" : "border-dodgy-200";
  const verdictButtonBorderClass =
    verdict === "Real Saver" ? "border-fair-700 text-fair-800" : verdict === "Dodgy Deal" ? "border-alert-700 text-alert-800" : uncertain ? "border-stone-600 text-stone-700" : "border-dodgy-700 text-dodgy-800";
  const verdictBadge = VERDICT_BADGE[verdict];

  // `rankingList` contains each supermarket's current price, while
  // `visibleRanking` is the special-only subset. Keep these separate: the
  // verdict and explanation below belong to the supermarket selected for
  // this page, while the ranking/alternative note is explicitly cross-store.
  const lowestCurrentPriceItem = rankingList[0];
  const lowestSpecialStoreItem = visibleRanking[0];
  const multipleSpecialSupermarkets = visibleRanking.length > 1;

  // Recent average for THIS deal's own store specifically -- deliberately
  // Backs the hero price color below (2026-08-21, per Jay: "The item
  // price text at top should also be Green if cheaper, Red if pricier, or
  // Black if no change") -- same `text-fair-700`/`text-alert-700` tokens
  // this page's own chart legend already uses for "Cheaper"/"Pricier"
  // (just below), not new colors invented for this one span. No claim of
  // "cheaper"/"pricier" when there's no real average to compare against
  // (`dealAveragePrice` null or `<= 0`) -- same guard `StoreCompareChart`'s
  // own `ariaLabel` logic already uses for the identical edge case.
  const dealAveragePrice = getRealAveragePrice(product, deal.store);
  const dealPriceColorClass =
    dealAveragePrice == null || dealAveragePrice <= 0 || deal.price === dealAveragePrice
      ? "text-stone-900"
      : deal.price < dealAveragePrice
        ? "text-fair-700"
        : "text-alert-700";

  const assessmentSummary = buildAssessmentSummaryCopy(deal);
  const lowestSpecialPriceCents = lowestSpecialStoreItem ? Math.round(lowestSpecialStoreItem.price * 100) : null;
  const lowestSpecialStoreNames =
    lowestSpecialPriceCents == null
      ? []
      : visibleRanking
          .filter((item) => Math.round(item.price * 100) === lowestSpecialPriceCents)
          .map((item) => item.store)
          .filter((store, index, stores) => stores.indexOf(store) === index);
  const selectedStoreHasLowestSpecial = lowestSpecialStoreNames.some((store) => storesMatch(store, deal.store));
  const crossStoreSpecialSummary =
    lowestSpecialStoreItem && lowestSpecialStoreNames.length > 0 && !selectedStoreHasLowestSpecial
      ? `The lowest special price across supermarkets is $${lowestSpecialStoreItem.price.toFixed(2)} at ${joinStoreNames(lowestSpecialStoreNames)}.`
      : null;

  return (
    <>
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: isNavigatingBack || !isEntryAnimationReady ? "100%" : 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={`deal-assessment-page min-h-full w-full ${verdictBgClass}`}
      >
      {/* No search bar on this page (2026-08-17, per Jay's ask, same day
          as the change above that had briefly added the real `SearchBar`
          component here -- see this file's header comment).

          `p-6` (uniform 24px on all sides) -> `px-6 pb-6 pt-3` (2026-08-17,
          later same day, Jay: "the top deal card has 24px top padding make
          it 12px") -- shrinks just the TOP inset above the verdict card
          below to 12px, leaving the side/bottom padding at the original
          24px; not touching the verdict card's own `p-5` padding, which
          is a separate, smaller (20px) value this ask didn't mention. */}
    <div className="flex-1 space-y-6 px-6 pb-6 pt-3">

      <div className={`space-y-5 rounded-2xl border bg-white p-5 text-left shadow-xs ${verdictBorderClass}`}>
        <div className="flex items-center justify-between">
          <h2 className={`font-display text-xl font-extrabold tracking-tight ${verdictColorClass}`}>
            {verdict === "Early read" ? "More checks needed" : verdict === "Limited history" ? "Needs more evidence" : verdict}
          </h2>
          {/* Add-to-list + Share, side by side (2026-08-12, per Jay's ask
              to replace the old full-width sticky "Add to List" bar at the
              bottom of this page with a small circle button next to
              Share). Reuses the real `AddToListButton` component
              (`ProductListCard`/`DealCard`'s own "+" button, just with
              `containerClassName="relative"` instead of its card default
              of `absolute right-2 top-2` -- see that component's own doc
              comment) rather than this page's old bespoke `AddToListBar`
              function, which duplicated the same fetchUserLists/
              addItemToList logic for no real reason once this button
              needed the exact same look anyway. */}
          <div className="flex items-center gap-3">
            {/* Swapped Share2 (the 3-node network-share glyph) for
                `Share` (lucide's iOS-style "square and arrow up" share-tray
                glyph) and dropped the circle entirely, 2026-08-21, per Jay
                pasting a reference icon + "don't use the circle outline
                around it" -- reverses the very change logged just above in
                this same file's history (2026-08-17/21: bare icon ->
                bordered white-fill circle matching `AddToListButton`).
                That "matched pair" symmetry with `AddToListButton` below is
                now broken on purpose -- Share is a plain icon again, Add
                to List still has its circle -- flagged in case Jay wants
                the circle dropped there too as a follow-up, not silently
                assumed. Kept `h-8 w-8 flex items-center justify-center`
                for the same tap-target size and icon-centering this button
                already had (unrelated to the circle, no reason to shrink
                the hit area); `block` kept on the icon itself for the same
                inline-baseline-centering reason documented in this file's
                own history. `hover:bg-stone-50` (a fill-color hover, only
                meaningful against a solid button) replaced with
                `hover:opacity-70` -- appropriate for a bare icon with
                nothing behind it to recolor. */}
            <button
              type="button"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: product.name, url: window.location.href }).catch(() => {});
                } else if (navigator.clipboard) {
                  navigator.clipboard.writeText(window.location.href).catch(() => {});
                }
              }}
              aria-label="Share"
              className="flex h-8 w-8 items-center justify-center text-stone-900 transition-opacity hover:opacity-70"
            >
              <Share className="block h-6 w-6" aria-hidden="true" />
            </button>
            {/* `bg-white` added (2026-08-17, Jay: "Add to list button
                should have a white fill on the deal assessment page") --
                this override previously dropped both the `bg-white` and
                the `shadow` that `AddToListButton.tsx`'s own default
                `buttonClassName` carries (its doc comment: "Defaults to
                the original solid `bg-white` circle every card usage
                still gets"), leaving just the border + icon on a
                transparent fill, so the verdict card's own tinted
                background (`bg-fair-50`/`bg-alert-50`/`bg-dodgy-50`)
                showed straight through the circle instead of a solid
                white button. Only `bg-white` added, not the default's
                `shadow` too -- Jay's ask was specifically "white fill",
                and the border-only look (no shadow) was presumably
                intentional here to sit flush next to the `Share` button
                beside it (now matching, 2026-08-21) rather than
                card-style elevated; flagged in case the shadow was
                wanted too as a follow-up. */}
            <AddToListButton
              productId={product.id}
              containerClassName="relative"
              buttonClassName="flex h-8 w-8 items-center justify-center rounded-full border border-stone-900 bg-white text-stone-900"
              iconClassName="h-5 w-5"
            />
          </div>
        </div>

        {/* Verdict badge -- "Verified special" (Real Saver) ADDED
            2026-08-20, per Jay: "remove verified specials badge from the
            lists. Add it to deal assessment pages for real savers" -- moved
            here from the S1 Lists page (see that page's own doc comment,
            same day), where it was a whole-list aggregate ("at least one
            item in this list is a verified special"); here it marks THIS
            specific item's own verdict instead, which is both more precise
            (Jay said "for real savers", singular verdict, not "for lists
            containing one") and free to compute -- `verdict === "Real
            Saver"` already means `deal.dealType === "Real Deal"`
            (`getAssessmentVerdict`, see `deal-detail.ts`), which itself
            already requires a genuine (non-DODGY, non-UNKNOWN)
            `dodgy_deals_cache` verdict match, the exact same "verified"
            condition the old list badge checked (`hasVerifiedSpecial`,
            lists.ts) -- no new data/fetch needed.

            Extended to Dodgy Deal/Fair Deal too, same day, per Jay's
            follow-up: "Is there a badge we can use for fair and dodge deal
            assessment pages? so the badge usage is consistent" -- see the
            `VERDICT_BADGE` map above this component for the full color/
            label reasoning. Same `.dd-badge` primitive for all 3, visual
            continuity with the original single-verdict badge (a bigger
            redesign wasn't asked for). Placed as its own row below the
            share/add-to-list header rather than crowded onto the
            `{verdict}` heading itself, so it reads as a distinct claim next
            to, not fused with, the verdict title. NOT duplicated into the
            "Cheaper options on special" sheet's own compact current-item
            summary card further down this file (same `verdict`/`product`
            in scope there) -- that card is a tightly-packed `p-4` row built
            to fit inside a bottom sheet, no spare room for a second badge
            line without its own layout pass; flagged here as a possible
            follow-up rather than assumed in scope for either ask. */}
        {!uncertain && (
          <span className={`dd-badge ${verdictBadge.className} w-fit`}>
            <verdictBadge.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {verdictBadge.label}
          </span>
        )}

        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={() => setShowProductImage(true)}
            aria-label={`View larger image of ${product.name}`}
            className="product-image-frame deal-assessment-image h-28 w-28 flex-shrink-0 select-none overflow-hidden rounded-lg border-0 p-0"
          >
            <ProductImage src={product.image} alt={product.name} width={112} height={112} className="product-image-content h-full w-full object-contain" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-base font-extrabold leading-snug text-stone-900">{product.name}</h3>
            <p className="mt-0.5 dd-type-meta dd-type-meta-strong text-stone-500">{product.unit}</p>
            <div className="mt-1 flex items-baseline gap-1">
              <span className={`font-display text-2xl font-extrabold ${dealPriceColorClass}`}>${deal.price.toFixed(2)}</span>
              <span className="text-sm font-bold text-stone-500">ea</span>
            </div>
            <p
              className={`mt-0.5 text-sm font-bold ${
                STORE_TEXT_COLOR[getStoreLogoMeta(deal.store).bg] || "text-stone-600"
              }`}
            >
              at {deal.store}
            </p>
          </div>
        </div>

        <div>
          <h4 className="dd-type-section mb-1 text-stone-900">
            <AssessmentText text={assessmentSummary.heading} />
          </h4>
          <p className="whitespace-pre-line text-sm leading-relaxed text-stone-600">
            <AssessmentText text={assessmentSummary.body} />
          </p>
          {crossStoreSpecialSummary && (
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              <AssessmentText text={crossStoreSpecialSummary} />
            </p>
          )}
        </div>

        {/* `bg-white` added to both action buttons below (2026-08-17,
            Jay: "buttons on the deal assessment page should have a white
            fill") -- previously transparent at rest (just a
            `verdictButtonBorderClass`-coloured border sitting directly on
            the verdict card's own tinted `${verdictBgClass}` background,
            e.g. `bg-fair-50`), only turning `hover:bg-white/50` on
            hover/tap. `hover:bg-white/50` swapped for `hover:bg-stone-50`
            on both -- with a solid white base already, the old hover
            class would have made hovering read as LESS white (50%
            opacity back down to the tinted card colour showing through),
            the opposite of the emphasis a hover state should give;
            `hover:bg-stone-50` is the same subtle-grey hover already used
            elsewhere in this app (e.g. the list-picker rows in
            `AddToListButton.tsx`) for a filled element. */}
        {lowestCurrentPriceItem && (
          <a
            href={
              findDealForStore(product.currentDeals, lowestCurrentPriceItem.store)?.productUrl ||
              getStoreProductUrl(lowestCurrentPriceItem.store, product.name)
            }
            target="_blank"
            rel="noopener noreferrer"
            className={`block w-full rounded-full border bg-white py-3 px-4 text-center dd-type-control transition-all hover:bg-stone-50 ${verdictButtonBorderClass}`}
          >
            Lowest price at {lowestCurrentPriceItem.store}
          </a>
        )}

        {visibleRanking.length >= 2 && (
          <div>
            <h4 className={`mb-1 border-b pb-2 dd-type-control text-stone-900 ${verdictBorderClass}`}>Special price ranking</h4>
            <div>
              {/* Cheapest-price tie handling added 2026-08-21, per Jay:
                  "If best price is the same across two supermarkets, there
                  should be no best badge, and both prices should be green
                  with a tick." `visibleRanking` is price-ascending (that's
                  what made `idx === 0` a correct "is this the cheapest row"
                  check before), so `arr[0].price` is still the lowest price
                  in the list either way -- what changed is that "cheapest"
                  now means "matches that lowest price," not "is
                  positionally first." Compared in integer cents
                  (`Math.round(price * 100)`) rather than the raw floats
                  directly, since these are independently-computed per-store
                  $ amounts and a same-cents tie ($3.50 vs $3.50) isn't
                  guaranteed to survive an exact floating-point `===`.
                  `tiedForBest` (how many rows share that lowest price) is
                  what actually decides the badge -- still shown, singular,
                  when exactly one store has it; hidden for every row once
                  2+ stores tie, per Jay's ask, rather than showing it on
                  all of them. */}
              {(() => {
                const bestPriceCents = visibleRanking.length > 0 ? Math.round(visibleRanking[0].price * 100) : null;
                const tiedForBest =
                  bestPriceCents == null
                    ? 0
                    : visibleRanking.filter((r) => Math.round(r.price * 100) === bestPriceCents).length;
                return visibleRanking.map((item, idx, arr) => {
                  const dealForStore = findDealForStore(product.currentDeals, item.store);
                  const isOnSale = dealForStore ? dealForStore.isOnSpecial !== false : false;
                  const isCheapest = bestPriceCents != null && Math.round(item.price * 100) === bestPriceCents;
                  const showBestBadge = isCheapest && tiedForBest === 1;
                  // Row content extracted so it can be wrapped in either a
                  // plain `<div>` (this row's own store -- see `isCurrentStore`
                  // below) or a `<Link>` (every other store), without
                  // duplicating the whole row's markup for each case.
                  const rowContent = (
                    <>
                      {isCheapest ? (
                        <Check className="h-4 w-4 flex-shrink-0 text-fair-600" strokeWidth={3} aria-hidden="true" />
                      ) : (
                        <ArrowUp className="h-4 w-4 flex-shrink-0 text-stone-400" strokeWidth={2.5} aria-hidden="true" />
                      )}
                      <span className={`flex flex-1 items-center gap-1.5 text-sm ${isCheapest ? "font-extrabold text-fair-700" : "font-semibold text-stone-600"}`}>
                        {item.store}
                        {showBestBadge && (
                          <span className="rounded-[4px] bg-fair-600 px-1.5 py-0.5 dd-type-badge text-white">Best</span>
                        )}
                      </span>
                      {/* text-[13px] -> text-sm (14px), 2026-08-20 body-text
                          pass (see note near the first bumped paragraph
                          above) -- matches the store name/price columns
                          either side of it in this same row, which were
                          already text-sm; this was the one column reading
                          smaller than its own row. */}
                      <span className={`w-24 text-center text-sm leading-4 ${isOnSale ? "italic font-bold" : "font-semibold"} ${isCheapest ? "text-fair-700" : "text-stone-500"}`}>
                        {isOnSale ? "Special" : "Regular price"}
                      </span>
                      <span className={`text-right text-sm ${isCheapest ? "font-bold text-fair-700" : "font-semibold text-stone-600"}`}>
                        ${item.price.toFixed(2)}{multipleSpecialSupermarkets ? "" : " ea"}
                      </span>
                    </>
                  );
                  const rowClassName = `flex items-center gap-2 py-2.5 ${idx < arr.length - 1 ? `border-b ${verdictBorderClass}` : ""}`;
                  // Row-level link added 2026-08-21, per Jay: "The price
                  // ranking texts should also link the item's deal
                  // assessment page at other supermarkets" -- read as "other"
                  // meaning every row except the one for the store this page
                  // is already showing (`dealStore`), since a link to the
                  // page already on screen has nothing to navigate to. Whole
                  // row is the tap target (not just the store name text) to
                  // match this app's own established "tappable card"
                  // convention (see `DealCard.tsx`'s own doc comment on why
                  // its whole card, not just a button inside it, is the tap
                  // target), and the same
                  // `/deal/${encodeURIComponent(id)}/${encodeURIComponent(store)}`
                  // shape every other in-app deal link already uses
                  // (`DealCard.tsx`'s own `goToDeal`), not a new pattern.
                  const isCurrentStore = item.store === dealStore;
                  if (isCurrentStore) {
                    return (
                      <div key={item.store} className={rowClassName}>
                        {rowContent}
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.store}
                      href={`/deal/${encodeURIComponent(productId)}/${encodeURIComponent(item.store)}`}
                      className={`${rowClassName} transition-colors hover:bg-stone-50`}
                    >
                      {rowContent}
                    </Link>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {cheaperAlternatives.length > 0 && (
          <div>
            <h4 className="mb-1 dd-type-control text-stone-900">Cheaper alternatives available</h4>
            <p className="mb-3 text-sm text-stone-600">See other cheaper alternatives on special</p>
            <button
              onClick={() => setShowCheaperCarousel((open) => !open)}
              aria-expanded={showCheaperCarousel}
              className={`flex w-full items-center justify-center gap-2 rounded-full border bg-white py-3 px-4 text-center dd-type-control transition-all hover:bg-stone-50 ${verdictButtonBorderClass}`}
            >
              <span>See cheaper options</span>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-fair-600 dd-type-badge text-white">
                {cheaperAlternatives.length}
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${showCheaperCarousel ? "rotate-180" : ""}`}
                strokeWidth={2.5}
                aria-hidden="true"
              />
            </button>

            {/* Bottom-sheet overlay (2026-08-12 to 2026-08-21) replaced with
                this inline expand/collapse carousel, per Jay: "the container
                will grow and show a carousel of the cheaper options (instead
                of the bottom sheet). This carousel can then be collapsed
                again by selecting the cheaper options button again." A
                `motion.div` height animation (0 -> "auto") rather than a
                simple conditional render -- an instant show/hide would jump
                the rest of the page up/down with no transition, which is
                exactly the abruptness the old full-page/bottom-sheet views
                didn't have either (both animated in their own way). Content
                below is the old bottom sheet's card list, ported verbatim
                (image, brand/unit, name, save badge, price row, "Go to X"
                link, AddToListButton) -- only the outer chrome changed, not
                what each card shows. Wrapped in `InsightCarousel` (see that
                file's own header comment on why it was still around,
                unused, from the 2026-08-20 Price History change) rather than
                a plain stacked list, since Jay's ask was specifically for a
                *carousel* of alternatives, not a list -- matches how "See
                cheaper options" behaved before the bottom-sheet era (spec
                step 4's original swipeable-cards intent).

                UPDATE 2026-08-21, per Jay: "make the cards slightly less
                width and show a hint of the next card, or previous cards,
                to give users understanding to swipe left or right. Ensure
                the cards are always the same height." Two changes from the
                original version of this block:
                1. `slideWidthClassName="w-[88%]"` (below) instead of
                   `InsightCarousel`'s own `w-full` default -- each slide
                   now takes 88% of the row's width instead of all of it, so
                   the next slide's left edge (and, once scrolled past slide
                   1, the previous slide's right edge) peeks in at the
                   container's edge as a visible swipe affordance. The old
                   per-slide `px-1` wrapper is gone -- `InsightCarousel`'s
                   own track now carries a `gap-3` between slides instead,
                   so spacing isn't split across two different places.
                2. Cards are no longer variable-height. This directly
                   reverses the "Deliberately NOT given a fixed slide
                   height" reasoning that used to live in this comment --
                   that was true for the old one-slide-fills-the-viewport
                   layout, where a clipped taller card had no visible
                   downside since only one card was ever on screen at once.
                   With neighboring cards now peeking in side-by-side, a
                   mismatched card height would visibly stagger against its
                   neighbors, which is what Jay's "always the same height"
                   ask is about. Fixed via `h-72` + `justify-between` on the
                   card itself (below) -- the image/text row and the "Go to
                   X" link become the 2 flex children, `justify-between`
                   pins the link to the card's bottom edge regardless of how
                   tall the row's own content is, so a short name doesn't
                   leave the link floating in the middle of the card --  and
                   `line-clamp-2` on the product name (below) to bound the
                   one genuinely unpredictable input (name length) so it
                   can't grow the card past its own fixed height on an
                   unusually long product name. The outer `motion.div`'s own
                   `height: "auto"` re-measure is untouched and still needed
                   -- it's sizing the whole scroll track's height (which
                   still changes when the carousel opens/closes), not any
                   individual card. */}
            <AnimatePresence initial={false}>
              {showCheaperCarousel && (
                <motion.div
                  key="cheaper-carousel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", damping: 28, stiffness: 260 }}
                  className="-mx-5 overflow-hidden"
                >
                  {/* `-mx-5` RE-FIXED 2026-08-21 (moved from the div
                      below onto this `motion.div` itself) -- Jay reported
                      the peek STILL not reaching the container's true edge
                      even after the earlier same-day fix described in this
                      file's own history (which put `-mx-5` on the div just
                      below instead of here). Re-derived the box model by
                      hand rather than re-guessing: that div's `-mx-5` was
                      trying to extend 20px past ITS OWN parent -- which is
                      THIS `motion.div`, and this `motion.div` already
                      carries `overflow-hidden` (needed for its own
                      height:0->auto open/close animation) and had no
                      padding of its own to absorb that extension.
                      `overflow: hidden` clips at the padding edge of
                      whichever element it's set on -- so the negative
                      margin's 20px-each-side extension was being clipped
                      away by THIS element before it ever reached the
                      verdict card's real border, making the fix a no-op
                      (identical rendered result to no `-mx-5` at all).
                      Putting `-mx-5` on this `motion.div` instead makes
                      this the element whose own box becomes 40px wider and
                      shifts 20px left -- `overflow-hidden` now clips
                      relative to THAT already-widened box, so there's
                      nothing left over to clip. This cancels the verdict
                      card's own `p-5` (line ~385) exactly as the original
                      attempt intended, so the carousel viewport spans the
                      card's FULL true width; the matching `px-5` still
                      lives on `InsightCarousel`'s own `trackPaddingClassName`
                      prop (see that file's own doc comment for why it has
                      to be on the scroll TRACK, not a wrapping div, for a
                      peek to reach the true edge mid-scroll). The old
                      wrapper div below no longer needs `-mx-5` -- keeps
                      just `pt-3`. */}
                  <div className="pt-3">
                    <InsightCarousel slideWidthClassName="w-[92%]" trackPaddingClassName="px-5">
                      {cheaperAlternatives.map(({ product: altProd, store: altStore, price: altPrice, saving }) => {
                        const meta = getStoreLogoMeta(altStore);
                        return (
                          <div key={`${altProd.id}-${altStore}`}>
                            {/* Card content ported verbatim from the old
                                bottom sheet's "Similar deals" list (same
                                image size, AddToListButton default
                                top-right position, brand+unit with no "·"
                                separator per the 2026-08-17 fix, save
                                badge phrasing, store logo meta badge inside
                                the store CTA,
                                "Go to {store}" link) -- only the outer
                                shape changed (one card per carousel slide
                                instead of a vertical stack inside a
                                sheet). `h-64`/`justify-between` added
                                2026-08-21 for Jay's "always the same
                                height" ask -- see this section's own doc
                                comment above. Bumped `h-64` -> `h-72` same
                                day, per Jay's follow-up: "Carousel card
                                heights need to be larger to accommodate
                                the button, currently it's cropped at the
                                bottom, or squished in, missing proper
                                bottom padding" -- the fixed height was
                                genuinely too short for this card's worst-
                                case content (2-line clamped name + the
                                save badge's own 2-line wrap + the price
                                row + the button, with `pt-7`/`pb-5`/`gap-4`
                                all real space on top of that), so content
                                was overflowing past the card's own bottom
                                edge -- `justify-between`'s bottom-pinned
                                link had nowhere real to pin to inside a
                                too-short box, which is exactly the
                                "cropped"/"squished" look Jay described.
                                `h-72` gives ~32px more room; the save
                                badge's own text is fixed copy (not
                                user data), so this ceiling is a real
                                worst case, not a guess against unbounded
                                content. */}
                            <div className="relative flex min-h-72 flex-col gap-3 rounded-2xl border border-stone-200/80 bg-white px-5 pb-5 pt-7 shadow-xs">
                              <AddToListButton productId={altProd.id} />
                              <div className="flex items-start gap-4">
                                <div className="product-image-frame deal-assessment-image flex h-24 w-24 flex-shrink-0 select-none items-center justify-center overflow-hidden rounded-xl">
                                  <ProductImage
                                    src={altProd.image}
                                    alt={altProd.name}
                                    width={96}
                                    height={96}
                                    className="product-image-content h-full w-full object-contain mix-blend-multiply"
                                  />
                                </div>
                                <div className="min-w-0 flex-grow py-1">
                                  <div className="space-y-1">
                                    <p className="dd-type-secondary dd-type-secondary-strong text-ink-600">
                                      {altProd.brand
                                        ? altProd.brand.charAt(0).toUpperCase() + altProd.brand.slice(1).toLowerCase()
                                        : altProd.brand}{" "}
                                      {altProd.unit}
                                    </p>
                                    {/* line-clamp-2 added 2026-08-21, alongside
                                        the card's new fixed `h-72` -- bounds
                                        the one input here that could otherwise
                                        grow past a fixed card height on an
                                        unusually long product name. */}
                                    <h3 className="mt-1 line-clamp-2 font-display text-base font-bold leading-snug text-stone-900">
                                      {altProd.name}
                                    </h3>
                                    <div className="mt-2 flex items-baseline gap-1 whitespace-nowrap">
                                      <span className="font-display text-base font-extrabold text-stone-900">${altPrice.toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <span className="dd-cheaper-saving-badge block w-full rounded-md border border-fair-800 bg-fair-800 px-2.5 py-2 dd-type-secondary dd-type-secondary-strong text-white">
                                Save <strong className="font-extrabold">${saving.toFixed(2)}</strong> compared to original item checked
                              </span>
                              <a
                                href={findDealForStore(altProd.currentDeals, altStore)?.productUrl || getStoreProductUrl(altStore, altProd.name)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white py-2.5 text-center text-sm font-semibold text-stone-700 transition-all hover:bg-stone-50"
                              >
                                <span className={`select-none rounded-md px-1.5 py-0.5 dd-type-badge ${meta.bg} ${meta.text}`}>
                                  {meta.short}
                                </span>
                                Go to {altStore}
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </InsightCarousel>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {/* Changed 2026-08-20 (per Jay's ask) from a swipeable InsightCarousel
            (store-compare chart as slide 1, the insights grid as slide 2) to
            two always-visible, stacked blocks -- both show at once now, no
            swipe/dots. InsightCarousel.tsx itself was left in place but sat
            unused for a day (flagged rather than deleted, in case another
            screen wanted a swipeable card row later) -- that screen turned
            up 2026-08-21, this same page's "Cheaper alternatives" section
            (below), so the component is back in active use again just not
            in this section. */}
        <div className="space-y-4">
          <div className="space-y-4 rounded-2xl border border-stone-200/80 bg-white p-5 shadow-xs">
            <div>
              {/* "Price History Insights" section title + subtitle moved
                  IN HERE (2026-08-20, per Jay's ask) from a standalone
                  heading above both cards -- now sits inside this first
                  card specifically, not floating above the whole section. */}
              <h4 className="dd-type-section text-stone-900">Price History Insights</h4>
              {/* text-[13px] -> text-sm (14px) below, 2026-08-20, per Jay:
                  "Increase all body texts on the deal assessment page to be
                  14px for readability" -- scoped to actual sentence-level
                  copy meant to be read (captions, explanatory paragraphs,
                  status lines, this chart's own legend), matching sibling
                  text that was already text-sm elsewhere on this page (e.g.
                  the verdict explanation paragraphs just above this section).
                  NOT applied to compact tag/label text (unit sizes, store
                  short-codes, "Lowest price:"/brand-unit tags, the numeric
                  badge counters) -- those are UI chrome by deliberate design
                  (`tracking-wider` pill/tag styling matching the same
                  convention `ProductListCard.tsx`/`ListItemProductCard.tsx`
                  already use for their own tags), not body copy, and Jay's
                  ask was specifically about reading text. Also not applied to
                  button/link CTA labels ("View at X", "See cheaper options",
                  "Go to X") -- already bold, short, and high-contrast, not a
                  readability concern the same way paragraph copy is; flagged
                  here rather than silently included or silently skipped. */}
              {/* Simplified 2026-08-20 per Jay's ask ("too long for the user
                  currently") -- was 3 separate sentences/paragraphs here
                  (the "Lowest, highest, average..." summary, the "Compares
                  the current price..." chart explainer, and a dynamic "X of
                  Y supermarkets differ..." status line) totalling ~40 words.
                  Cut to one line. The per-store colored delta badges on the
                  chart itself (StoreCompareChart.tsx, always-visible even on
                  touch, per that file's own header comment) plus the
                  Cheaper/Pricier legend directly below already carry what
                  the 3 old sentences were spelling out in prose -- this line
                  now just orients the reader, doesn't restate the chart.
                  Dynamic differing-count line dropped entirely rather than
                  shortened -- same information (which stores differ, by how
                  much) is already on the chart itself per-store, so a prose
                  restatement of it added length without adding anything a
                  user couldn't already see at a glance. Flagged as a real
                  content decision, not just a wording trim, in case Jay
                  wants that count back in some form. */}
              {/* No longer gated on `insights.length > 0` (2026-08-21, per
                  Jay: "some product items don't have the descriptive text
                  ... it should be on all product items right?") -- this
                  sentence describes TWO things: "each store's recent
                  average" (the `StoreCompareChart` just below, which is
                  ALWAYS rendered) and "its own last 90 days" (the
                  `PriceHistoryInsightCard` grid further down, which IS
                  genuinely conditional on real 90-day history existing --
                  see `buildPriceHistoryInsights`'s own doc comment). Gating
                  the whole sentence on the SECOND thing's availability was
                  wrong -- any product below the 90-day sample floor
                  (new-ish specials, thin history) still shows the chart
                  with no explanation at all above it. Sentence text
                  unchanged; it stays a fair, general orienting line even
                  for a product where only the chart half of it applies
                  today. */}
              <p className="mt-1 text-sm leading-relaxed text-stone-500">
                {priceHistoryTab === "90-days"
                  ? "Shows price changes over the last 90 days, including special prices."
                  : "This graph compares the current price at each supermarket with its recent average."}
              </p>
            </div>
            <div
              className="flex items-center gap-0.5 rounded-lg bg-stone-200 p-1 shadow-inner shadow-black/5"
              role="tablist"
              aria-label="Price history views"
            >
              <button
                type="button"
                role="tab"
                aria-selected={priceHistoryTab === "90-days"}
                onClick={() => setPriceHistoryTab("90-days")}
                className={`relative z-0 flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded-md px-3 py-1.5 text-center dd-type-control transition-[background-color,color,box-shadow] ${
                  priceHistoryTab === "90-days" ? "dd-segmented-control-active text-stone-900 shadow-sm ring-1 ring-black/5" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                <AnimatePresence initial={false}>
                  {priceHistoryTab === "90-days" && (
                    <motion.span
                      className="dd-segmented-control-active-fill pointer-events-none absolute inset-0 rounded-md bg-white"
                      style={{ zIndex: -1 }}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                </AnimatePresence>
                90 days
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={priceHistoryTab === "insights"}
                onClick={() => setPriceHistoryTab("insights")}
                className={`relative z-0 flex min-h-8 flex-1 cursor-pointer items-center justify-center rounded-md px-3 py-1.5 text-center dd-type-control transition-[background-color,color,box-shadow] ${
                  priceHistoryTab === "insights" ? "dd-segmented-control-active text-stone-900 shadow-sm ring-1 ring-black/5" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                <AnimatePresence initial={false}>
                  {priceHistoryTab === "insights" && (
                    <motion.span
                      className="dd-segmented-control-active-fill pointer-events-none absolute inset-0 rounded-md bg-white"
                      style={{ zIndex: -1 }}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}
                </AnimatePresence>
                Insights
              </button>
            </div>
            {priceHistoryTab === "90-days" ? (
              <PriceHistoryChart
                points={priceHistoryPoints}
                currentPrice={deal.price}
                currentStore={deal.store}
                currentIsSpecial={deal.isOnSpecial}
                comparisonPrice={deal.originalPrice}
                loading={priceHistoryLoading}
                error={priceHistoryResult?.key === priceHistoryKey ? priceHistoryResult.error : null}
              />
            ) : (
              <>
            {/* `justify-end` -> `justify-center` (2026-08-21, per Jay:
                "Centre the legend 'Recent average, Cheaper, Pricier' above
                the graph") -- was right-aligned, no particular reason tied
                to the chart below it (`StoreCompareChart` itself centers
                its own per-store columns via `justify-around`), so centering
                the legend directly above it reads as belonging to the chart
                rather than just sitting in the card's corner. */}
            <StoreCompareChart rows={barChartData} />
              <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="flex items-center gap-1.5 text-sm leading-4 font-bold text-ink-600">
                <span className="dd-chart-average-bar h-2 w-2 rounded-full" />
                <span>Recent average</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm leading-4 font-bold text-fair-700">
                <span className="h-2 w-2 rounded-full bg-fair-600" />
                <span>Cheaper</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm leading-4 font-bold text-alert-700">
                <span className="h-2 w-2 rounded-full bg-alert-600" />
                <span>Pricier</span>
              </div>
            </div>
              </>
            )}
            {insights.length > 0 && (
              <div className="border-t border-stone-100 pt-5">
                <PriceHistoryInsightCard insights={insights} verdict={verdict} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
      </motion.div>

    {showProductImage && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/80 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Larger image of ${product.name}`}
        onClick={() => setShowProductImage(false)}
      >
        <button
          type="button"
          onClick={() => setShowProductImage(false)}
          aria-label="Close larger image"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-stone-900 shadow-lg"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div
          className="flex max-h-[85vh] max-w-[92vw] items-center justify-center rounded-2xl bg-white p-4 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <ProductImage
            src={product.image}
            alt={product.name}
            width={768}
            height={768}
            className="product-image-content max-h-[78vh] max-w-[84vw] object-contain"
          />
        </div>
      </div>
    )}

    </>
  );
}
