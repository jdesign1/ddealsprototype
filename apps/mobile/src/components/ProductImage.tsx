"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

export const PRODUCT_IMAGE_FALLBACK = "/no-product-image.svg";

type ProductImageProps = Omit<ImageProps, "src" | "onError" | "unoptimized"> & {
  src?: string | null;
  alt: string;
};

function usableProductImageSource(src?: string | null) {
  // The shared data layer historically uses a remote placehold.co URL when a
  // catalogue record has no image. Keep that data-layer fallback for other
  // consumers, but avoid making every mobile card depend on a third-party
  // placeholder service (and its SVG response).
  if (!src || src.includes("placehold.co")) return PRODUCT_IMAGE_FALLBACK;
  return src;
}

/**
 * Product imagery is retailer-owned and occasionally missing or retired.
 * Keep the direct retailer URL (so Vercel's image quota is not involved), but
 * recover locally when the URL is absent or fails to load.
 */
export default function ProductImage({ src, alt, ...props }: ProductImageProps) {
  const source = usableProductImageSource(src);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const imageSrc = failedSource === source ? PRODUCT_IMAGE_FALLBACK : source;

  return (
    <Image
      {...props}
      src={imageSrc}
      alt={alt}
      unoptimized
      onError={() => setFailedSource(source)}
    />
  );
}
