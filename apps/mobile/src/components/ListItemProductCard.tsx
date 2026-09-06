"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";
import type { ProductCard as ProductCardData, CurrentDeal } from "@dodgey-deals/shared";
import { getStoreLogoMeta } from "@/lib/store-meta";
import BottomSheetPortal from "@/components/BottomSheetPortal";

/**
 * Compact product row for a list's own item list on `apps/mobile/src/app/
 * lists/page.tsx` -- added 2026-08-20, Lists-page UX audit (Jay: "Ok
 * proceed with these" on the finding that item rows were bare
 * `<span>{name}</span>` text, no image/price/verdict, unlike every other
 * product surface in this app).
 *
 * Deliberately a SEPARATE component from `ProductListCard.tsx`, not that
 * component reused/extended with a bunch of new optional props -- 3 real
 * differences that don't retrofit cleanly onto a component already used in
 * 3 other contexts (Home, Specials, search results):
 *  - This card needs a REMOVE action (`onRemove`), not `ProductListCard`'s
 *    `AddToListButton` (add TO a list) -- the item is already in this list,
 *    removing it is the relevant action here, not re-adding it somewhere
 *    else. `ProductListCard`'s top-right corner is already spoken for by
 *    that button; bolting a second, different-purpose icon into the same
 *    corner on top of it would have been the actual retrofit risk.
 *  - This card needs a `quantity` chip (`list_items.quantity` -- Jay's
 *    "×N" convention the old plain-text row already showed) --
 *    `ProductListCard` has no concept of "how many of this you have," since
 *    every other context it's used in is browsing, not an owned list.
 *  - Sits nested one level deeper (inside a `ListCard`, itself inside the
 *    page's own list-of-lists column), so it uses smaller image/type scale
 *    than `ProductListCard`'s own full-size card -- not just a restyle,
 *    genuinely a different information density for a different slot in the
 *    page.
 * Verdict-badge color mapping (`.dd-badge-fair`/`-dodgy`/`-alert`) and the
 * store-badge lookup (`getStoreLogoMeta`) are copied from `ProductListCard`
 * verbatim, though, not reinvented -- same meaning, same colors, just a
 * compact inline pill row here instead of that card's floating corner
 * badges (there isn't room for 2 floating corner badges plus the remove
 * button on a card this small).
 *
 * Tap-to-navigate (whole row -> `/deal/[id]/[store]`) matches
 * `ProductListCard`'s own "cards tappable as a whole" pattern exactly, incl.
 * `role="button"`/`tabIndex={0}`/Enter-or-Space activation and the same
 * `onNavigate`-before-`router.push` shape (renamed `onBeforeNavigate` here
 * since this component has its own, differently-named `onRemove` callback
 * already and two `on*`-prefixed-but-different-meaning props felt worth
 * disambiguating) -- `ProductListCard`'s own doc comment has the full
 * "why" for that pattern (closing an always-mounted overlay before
 * navigating out from under it); `ListCard`/`lists/page.tsx` don't render
 * inside any such overlay today, so this component's own callers can leave
 * it unset, but the hook is here for the same reason it is on
 * `ProductListCard`.
 *
 * Remove confirmation added 2026-08-20 (per Jay: "When selecting an X on a
 * product on a list, there should be a remove confirmation") -- the X
 * button used to call `onRemove` directly, one tap, no way back. Flips
 * `confirmingRemove` on and swaps this card's content for a "Remove
 * {name}?" prompt + tick/cross pair, rather than a second, separate
 * confirm popover/dialog.
 *
 * Trigger switched from a tap on a top-right X icon to a swipe-left
 * gesture, same day (cont., per Jay: "to remove an item from a list, use
 * the swipe left gesture, then give the remove warning, keep the card the
 * same size in the warning"). The X icon is gone outright -- this is now
 * the ONLY entry point into `confirmingRemove` on this card. Implemented
 * with `motion.div`'s own `drag="x"` (this app already leans on `motion/
 * react` everywhere else for animation, not a new dependency): `drag`
 * constrained to a single point (`dragConstraints={{ left: 0, right: 0
 * }}`) with `dragElastic` gives the classic rubber-band "swipe, feel
 * resistance, let go" feel WITHOUT actually repositioning the card
 * permanently -- on release, motion springs it straight back to `x: 0`
 * itself (no manual reset code needed), and `onDragEnd` just reads
 * `info.offset.x` to decide whether the swipe went far enough
 * (`SWIPE_THRESHOLD`) to flip `confirmingRemove`. Drag is disabled outright
 * once `confirmingRemove` is true (`drag={confirmingRemove ? false : "x"}`)
 * so the tick/cross buttons aren't fighting a live drag gesture. Also
 * works with a mouse/trackpad drag, not touch-only -- framer-motion's drag
 * gesture isn't touch-gated -- but there is NO non-drag (keyboard/screen-
 * reader/switch-access) path left to trigger removal any more, the same
 * way there was one via the old focusable X button. Flagged here rather
 * than silently dropped: this is a direct, literal read of Jay's ask ("use
 * the swipe left gesture" to remove, not "add a swipe gesture alongside
 * the X"), but it's a real accessibility regression for anyone who can't
 * perform a drag gesture, worth a fast-follow if Jay wants a non-gesture
 * fallback restored.
 *
 * "keep the card the same size in the warning" -- the OLD confirm branch
 * was a separate `return` with its own smaller `p-2` box (no image, no
 * `pr-9`), which visibly shrank the row's height compared to its normal
 * state (losing the 56px image block). Fixed by no longer branching into a
 * second, differently-shaped `return` at all: there is now ONE outer box
 * (identical classes, identical `h-14 w-14` image, always rendered) and
 * only the right-hand content column's CHILDREN swap between the normal
 * brand/name/price/badges block and the "Remove {name}?" + tick/cross
 * block -- so the box's own footprint literally cannot differ between the
 * two states, by construction, not by keeping two class strings in sync
 * by hand.
 *
 * Not-on-special state added 2026-08-21, per Jay: "For items in lists, that
 * are not on special currently (grey them out) if the user selects this
 * item display a bottom sheet explaining that the item is not currently on
 * special and we will notify you when it is." `deal.isOnSpecial` (real
 * field, `!!cheapest.is_special` in `buildListItemProductCard`, lists.ts --
 * not derived here) drives both halves: the whole row gets `grayscale
 * opacity-60` instead of its normal full-color rendering, and a tap/Enter/
 * Space activation opens `NotOnSpecialSheet` (below) instead of navigating
 * to the deal page, via `handleActivate` replacing the old direct
 * `goToDeal` call on the row itself. Swipe-to-remove is untouched either
 * way -- removing a list item you own doesn't depend on whether it happens
 * to be on special right now, and the remove-confirm state already has its
 * own distinct (alert-colored) look, so it's explicitly excluded from the
 * grey treatment (`isNotOnSpecial && !confirmingRemove`) rather than
 * stacking a second dimmed look on top of it.
 *
 * The sheet's "we will notify you when it is" line is copy Jay asked for
 * verbatim, flagged rather than silently softened: this app has no real
 * notifications/price-alerts system yet (see `how-it-works/page.tsx`'s own
 * doc comment, which describes deliberately NOT porting the prototype's
 * "get deal warnings" copy for exactly that reason -- "rather than promise
 * a feature this app doesn't have"). This is a direct, explicit ask from
 * Jay this time rather than stray ported copy, so it's implemented as
 * asked -- but there's no real subscribe/alert action behind the sheet's
 * text, only a "Got it" dismiss. Worth flagging back to Jay before this
 * ships broadly: either build a real per-item notify flag, or soften the
 * copy to match what the app can actually do today.
 */
export interface ListItemProductCardProps {
  product: ProductCardData;
  deal: CurrentDeal;
  /** `list_items.quantity` -- only rendered as a "×N" chip when > 1, same
   * threshold the plain-text row this replaces already used. */
  quantity: number;
  onRemove: () => void;
  /** Full accessible label for the remove button, e.g. `Remove ${name} from
   * ${listName}` -- same string the old plain-text row's own X button
   * already built, passed through rather than reconstructed here since
   * this component doesn't know the list's own name. */
  removeLabel: string;
  onBeforeNavigate?: () => void;
  /** Refresh the list data after the not-on-special sheet is dismissed. */
  onAfterNotOnSpecial?: () => void;
}

const DEAL_TYPE_BADGE: Partial<Record<CurrentDeal["dealType"], { label: string; className: string }>> = {
  "Dodgy Deal": { label: "Dodgy", className: "dd-badge-alert" },
  "Real Deal": { label: "Real", className: "dd-badge-fair" },
  "Fair Price": { label: "Fair", className: "dd-badge-dodgy" },
};

// How far left (px) a swipe must travel before it counts as "remove this"
// rather than an accidental/small drag -- see this file's own top-of-file
// doc comment for the full swipe-gesture design.
const SWIPE_THRESHOLD = 70;

export default function ListItemProductCard({
  product,
  deal,
  quantity,
  onRemove,
  removeLabel,
  onBeforeNavigate,
  onAfterNotOnSpecial,
}: ListItemProductCardProps) {
  const router = useRouter();
  const storeMeta = getStoreLogoMeta(deal.store);
  const badge = deal.dealType === "Unverified Deal" ? undefined : DEAL_TYPE_BADGE[deal.dealType];
  // Same sentence-case transform ProductListCard.tsx applies to `brand`
  // (that file's own doc comment has the full "why": Title Case from
  // data.ts isn't the same thing as real sentence case, and there's no CSS
  // text-transform that produces it).
  const brandSentenceCase = product.brand
    ? product.brand.charAt(0).toUpperCase() + product.brand.slice(1).toLowerCase()
    : product.brand;

  // Inline "are you sure?" state (2026-08-20, see this file's own doc
  // comment above) -- local to this one card, not lifted, same as
  // `ListCard`'s own `confirmingDelete` (only one row at a time needs it,
  // nothing outside this card cares whether it's showing).
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // 2026-08-21, see this file's own top-of-file doc comment for the full
  // "why" -- local to this one card, same reasoning as `confirmingRemove`
  // just above (only one row's sheet is ever open at a time, nothing
  // outside this card needs to know).
  const isNotOnSpecial = deal.isOnSpecial === false;
  const [showNotOnSpecialSheet, setShowNotOnSpecialSheet] = useState(false);

  const goToDeal = () => {
    onBeforeNavigate?.();
    router.push(`/deal/${encodeURIComponent(product.id)}/${encodeURIComponent(deal.store)}`);
  };

  // Tap/Enter/Space activation on the row itself -- replaces the old direct
  // `goToDeal` call so a not-on-special item opens the explanation sheet
  // instead of navigating to a deal page for a deal that isn't really
  // "on" right now.
  const handleActivate = () => {
    if (isNotOnSpecial) {
      setShowNotOnSpecialSheet(true);
      return;
    }
    goToDeal();
  };

  const handleNotOnSpecialClose = () => {
    setShowNotOnSpecialSheet(false);
    onAfterNotOnSpecial?.();
  };

  return (
    <>
    <motion.div
      // Locked to a single point rather than a real range -- `dragElastic`
      // still lets the card visibly travel left under a finger/cursor, but
      // on release motion springs it straight back to `x: 0` on its own
      // (no manual reset needed). Disabled entirely once `confirmingRemove`
      // is true, so the tick/cross buttons below aren't fighting a live
      // drag gesture. See this file's own top-of-file doc comment for the
      // full "why swipe, not a tap-to-reveal X" design.
      drag={confirmingRemove ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      onDragEnd={(_event, info) => {
        if (info.offset.x < -SWIPE_THRESHOLD) setConfirmingRemove(true);
      }}
      onClick={confirmingRemove ? undefined : handleActivate}
      onKeyDown={
        confirmingRemove
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleActivate();
              }
            }
      }
      role={confirmingRemove ? undefined : "button"}
      tabIndex={confirmingRemove ? undefined : 0}
      aria-label={isNotOnSpecial && !confirmingRemove ? `${product.name}: not currently on special` : undefined}
      // Same box, always -- normal state and the remove-warning state are
      // ONE element with the SAME classes/image, only the right-hand
      // column's children differ below. That's what makes "keep the card
      // the same size in the warning" true by construction rather than by
      // hand-matching two separate class strings (see this file's own
      // top-of-file doc comment).
      //
      // `grayscale opacity-60` (2026-08-21, see this file's own top-of-file
      // doc comment) -- excluded during `confirmingRemove` on purpose, that
      // state already has its own distinct alert-colored look and dimming
      // it on top would make the confirm text harder to read, not clearer.
      className={`group flex items-stretch gap-3 overflow-hidden rounded-xl bg-white p-2 shadow-sm transition-colors hover:bg-stone-50 ${
        isNotOnSpecial && !confirmingRemove ? "grayscale opacity-60" : ""
      }`}
      style={{ cursor: confirmingRemove ? "default" : "pointer", touchAction: "pan-y" }}
    >
      <div className="product-image-frame flex h-14 w-14 flex-shrink-0 select-none items-center justify-center overflow-hidden rounded-lg bg-stone-50">
        <Image
          src={product.image}
          alt={product.name}
          width={56}
          height={56}
          sizes="56px"
          unoptimized
          loading="lazy"
          className="product-image-content h-full w-full object-contain"
        />
      </div>

      {confirmingRemove ? (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 py-0.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-alert-700">
            Remove {product.name}?
          </span>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Confirm ${removeLabel}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-alert-600 text-white transition-colors hover:bg-alert-700"
            >
              <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              aria-label="Cancel remove"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-stone-500 shadow-xs transition-colors hover:text-stone-700"
            >
              <X className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
          <span className="truncate dd-type-meta text-stone-600">{brandSentenceCase}</span>
          <h4 className="line-clamp-2 text-[15px] leading-5 font-semibold text-stone-900">{product.name}</h4>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="font-display text-base font-extrabold text-stone-900">${deal.price.toFixed(2)}</span>
            <span className={`select-none rounded-md px-1.5 py-0.5 dd-type-badge ${storeMeta.bg} ${storeMeta.text}`}>
              {storeMeta.short}
            </span>
            {badge && <span className={`dd-badge dd-badge-compact ${badge.className}`}>{badge.label}</span>}
            {quantity > 1 && <span className="dd-badge dd-badge-compact dd-badge-neutral">×{quantity}</span>}
          </div>
        </div>
      )}
    </motion.div>

    <NotOnSpecialSheet
      open={showNotOnSpecialSheet}
      productName={product.name}
      onClose={handleNotOnSpecialClose}
    />
    </>
  );
}

/**
 * Explanation sheet for tapping a greyed-out, not-on-special list item --
 * 2026-08-21, see this file's own top-of-file doc comment for the full
 * "why" (including the flagged "we will notify you" copy, which isn't
 * backed by a real notifications system yet). Same bottom-sheet chrome
 * every other sheet in this app already uses (scrim + spring slide-up,
 * `rounded-t-3xl`/`shadow-2xl`, `text-lg font-black tracking-tight` title +
 * top-right close X -- see `app/page.tsx`'s `SortDropdown` or
 * `FullScreenSearch.tsx`'s Categories/Sort sheets for the same pattern) --
 * this is the first PURELY INFORMATIONAL sheet in the app (every existing
 * one is a list of selectable options), so it gets a single "Got it"
 * dismiss button instead of an options list + separate close affordance.
 * Kept as its own small component (not inlined into the card above) since
 * `AnimatePresence`/`motion.div` scrim+sheet pairs are already a
 * multi-line unit at every other call site in this app; splitting it out
 * keeps the card's own return statement focused on the row itself.
 */
function NotOnSpecialSheet({
  open,
  productName,
  onClose,
}: {
  open: boolean;
  productName: string;
  onClose: () => void;
}) {
  return (
    <BottomSheetPortal open={open}>
      <AnimatePresence>
        {open && (
          <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="dd-bottom-sheet-backdrop fixed inset-0 z-[60] mx-auto w-full max-w-[480px] bg-stone-900/40"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            role="dialog"
            aria-modal="true"
            aria-label="Not currently on special"
            className="dd-bottom-sheet dd-bottom-sheet-surface fixed inset-x-0 bottom-0 z-[61] mx-auto flex min-h-[45vh] w-full max-w-[480px] flex-col rounded-t-3xl shadow-2xl pb-safe-sm"
          >
            <div className="dd-bottom-sheet-titlebar flex items-center justify-between border-b border-stone-100 px-5 pb-3 pt-4">
              <h3 className="dd-type-sheet-title text-stone-900">
                Not currently on special
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="cursor-pointer rounded-full p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-5 text-center">
              <Image
                src="/lists-login.webp"
                alt="Dodgey mascot waiting for a special"
                width={482}
                height={512}
                sizes="112px"
                className="mascot-wave h-auto w-28"
              />
              <p className="max-w-sm text-sm leading-relaxed text-stone-600">
                <span className="font-bold text-stone-900">{productName}</span> isn&apos;t on special right now.
                We&apos;ll let you know as soon as it is.
              </p>
            </div>
            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={onClose}
                className="dd-sheet-cta w-full cursor-pointer rounded-xl bg-stone-900 py-3 dd-type-control text-white transition-colors hover:bg-ink-600"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </BottomSheetPortal>
  );
}
