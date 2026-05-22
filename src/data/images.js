/**
 * Bundly — neutral "no image" placeholder.
 *
 * Shown ONLY when a product genuinely has no real photo. It is a clean,
 * neutral graphic — never a generic stock photo of some other product, and
 * never a random image from the web. Real product photos always come from
 * the catalog (sourced from Zap, where the photo is guaranteed to belong to
 * that exact model).
 */
const PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNmNGY0ZjYiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyMDAgMjAwKSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjYzNjOGQ0IiBzdHJva2Utd2lkdGg9IjEyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9Ii04MCIgeT0iLTY0IiB3aWR0aD0iMTYwIiBoZWlnaHQ9IjEyOCIgcng9IjE2Ii8+PGNpcmNsZSBjeD0iLTM0IiBjeT0iLTIyIiByPSIxOCIvPjxwYXRoIGQ9Ik0tODAgNDIgTC0yNCAtMTAgTDIwIDMyIEw1MiA0IEw4MCAyOCIvPjwvZz48L3N2Zz4=";

// Every category key maps to the SAME neutral placeholder, so a product is
// never shown a stock photo of a different product. Kept as a keyed object
// for backward compatibility with smartCategoryFallback's call sites.
export const IMG = {
  tv: PLACEHOLDER, laptop: PLACEHOLDER, phone: PLACEHOLDER, wash: PLACEHOLDER,
  ac: PLACEHOLDER, bike: PLACEHOLDER, camera: PLACEHOLDER, robot: PLACEHOLDER,
  couch: PLACEHOLDER, coffee: PLACEHOLDER, gaming: PLACEHOLDER,
  headphones: PLACEHOLDER, tablet: PLACEHOLDER, drone: PLACEHOLDER,
  vacuum: PLACEHOLDER, watch: PLACEHOLDER, earbuds: PLACEHOLDER,
  fridge: PLACEHOLDER, oven: PLACEHOLDER, dishwasher: PLACEHOLDER,
  microwave: PLACEHOLDER, blender: PLACEHOLDER, toaster: PLACEHOLDER,
  dryer: PLACEHOLDER,
};
