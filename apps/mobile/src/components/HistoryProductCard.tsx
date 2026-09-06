"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { CurrentDeal, ProductCard as ProductCardData } from "@dodgey-deals/shared";
import AddToListButton from "@/components/AddToListButton";
import { getStoreLogoMeta } from "@/lib/store-meta";

interface HistoryProductCardProps {
  product: ProductCardData;
  deal: CurrentDeal;
}

const DEAL_TYPE_BADGE: Partial<Record<CurrentDeal["dealType"], { label: string; className: string }>> = {
  "Dodgy Deal": { label: "Dodgy", className: "dd-badge-alert" },
  "Real Deal": { label: "Real", className: "dd-badge-fair" },
  "Fair Price": { label: "Fair", className: "dd-badge-dodgy" },
};

/**
 * Dense history row for All Checks. It follows the Lists page's compact item
 * proportions while retaining the historical check's store, price, verdict,
 * save action, and tap-through to the deal page.
 */
export default function HistoryProductCard({ product, deal }: HistoryProductCardProps) {
  const router = useRouter();
  const storeMeta = getStoreLogoMeta(deal.store);
  const badge = deal.dealType === "Unverified Deal" ? undefined : DEAL_TYPE_BADGE[deal.dealType];
  const brandSentenceCase = product.brand
    ? product.brand.charAt(0).toUpperCase() + product.brand.slice(1).toLowerCase()
    : product.brand;

  const goToDeal = () => {
    router.push(`/deal/${encodeURIComponent(product.id)}/${encodeURIComponent(deal.store)}`);
  };

  return (
    <div
      onClick={goToDeal}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          goToDeal();
        }
      }}
      role="button"
      tabIndex={0}
      // A card tap remains available without claiming vertical swipes from
      // the page's scroll container.
      style={{ touchAction: "pan-y" }}
      className="group flex min-h-20 cursor-pointer items-stretch gap-3 overflow-hidden rounded-xl bg-white p-2 shadow-sm transition-transform duration-150 active:scale-[0.985]"
    >
      <AddToListButton productId={product.id} />
      <div className="product-image-frame flex h-16 w-16 flex-shrink-0 select-none items-center justify-center overflow-hidden rounded-lg bg-stone-50">
        <Image
          src={product.image}
          alt={product.name}
          width={64}
          height={64}
          sizes="64px"
          unoptimized
          loading="lazy"
          className="product-image-content h-full w-full object-contain"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5 pr-8">
        <span className="truncate dd-type-meta text-stone-600">{brandSentenceCase}</span>
        <h3 className="line-clamp-2 text-[15px] leading-5 font-semibold text-stone-900">{product.name}</h3>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="font-display text-base font-extrabold text-stone-900">${deal.price.toFixed(2)}</span>
          <span className={`select-none rounded-md px-1.5 py-0.5 dd-type-badge ${storeMeta.bg} ${storeMeta.text}`}>
            {storeMeta.short}
          </span>
          {badge && <span className={`dd-badge ${badge.className}`}>{badge.label}</span>}
        </div>
      </div>
    </div>
  );
}
