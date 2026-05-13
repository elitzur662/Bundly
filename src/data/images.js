/**
 * Bundly — Curated product-category fallback images.
 *
 * Used by DealCard / DealDetailsPage when no ProductImage-fetched image is
 * available yet, and by smartCategoryFallback to pick a "best guess" Unsplash
 * by keyword. All URLs are direct Unsplash hosted images, no watermarks.
 *
 * Production note: when the catalog is fully populated and ProductImage's
 * /api/product-image fetch is reliable, these defaults become rarely-seen
 * placeholders. They never lock to a product (ProductImage detects Unsplash
 * URLs and refuses to lock).
 */
export const IMG = {
  tv:        "https://images.unsplash.com/photo-1593784991095-a205069470b6?w=700&q=85&fit=crop",
  laptop:    "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=700&q=85&fit=crop",
  phone:     "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=700&q=85&fit=crop",
  wash:      "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=700&q=85&fit=crop",
  ac:        "https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=700&q=85&fit=crop",
  bike:      "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=700&q=85&fit=crop",
  camera:    "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=700&q=85&fit=crop",
  robot:     "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=700&q=85&fit=crop",
  couch:     "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=700&q=85&fit=crop",
  coffee:    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=700&q=85&fit=crop",
  gaming:    "https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=700&q=85&fit=crop",
  headphones:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=700&q=85&fit=crop",
  tablet:    "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=700&q=85&fit=crop",
  drone:     "https://images.unsplash.com/photo-1507582020474-9a35b7d455d9?w=700&q=85&fit=crop",
  vacuum:    "https://images.unsplash.com/photo-1558317374-067fb5f30001?w=700&q=85&fit=crop",
  watch:     "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=700&q=85&fit=crop",
  earbuds:   "https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=700&q=85&fit=crop",
  fridge:    "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=700&q=85&fit=crop",
  oven:      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=700&q=85&fit=crop",
  dishwasher:"https://images.unsplash.com/photo-1610557892470-55d9e80c0bce?w=700&q=85&fit=crop",
  microwave: "https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=700&q=85&fit=crop",
  blender:   "https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=700&q=85&fit=crop",
  toaster:   "https://images.unsplash.com/photo-1585237017125-24baf8d7406f?w=700&q=85&fit=crop",
  dryer:     "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=700&q=85&fit=crop",
};
