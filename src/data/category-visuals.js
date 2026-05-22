/**
 * Bundly, Visual metadata for each category card in the supplier dashboard.
 *
 * Each entry maps a Hebrew category name (matching personalRequest.category)
 * to:
 *   - image   , Unsplash photo URL (royalty-free, CDN-optimised)
 *   - icon    , emoji shown alongside the image
 *   - gradient, Tailwind gradient tokens used for the overlay tint
 *
 * Falls back to CATEGORY_VISUAL_MAP._default when a request's category
 * isn't in the map (rare, only happens for free-text categories that
 * suppliers haven't curated yet).
 */

// Visual metadata per category, used in the supplier dashboard category cards.
// Image URLs come from Unsplash (royalty-free, optimised via CDN).
export const CATEGORY_VISUAL_MAP = {
  "טלוויזיות": {
    image: "https://images.unsplash.com/photo-1461151304267-38535e780c79?w=800&q=90&auto=format&fit=crop",
    icon: "📺",
    gradient: "from-indigo-600 to-violet-700",
  },
  "סמארטפונים": {
    image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=90&auto=format&fit=crop",
    icon: "📱",
    gradient: "from-blue-600 to-cyan-600",
  },
  "מחשבים ניידים": {
    image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&q=90&auto=format&fit=crop",
    icon: "💻",
    gradient: "from-slate-700 to-gray-900",
  },
  "מוצרי חשמל": {
    image: "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=800&q=90&auto=format&fit=crop",
    icon: "🏠",
    gradient: "from-rose-500 to-pink-600",
  },
  "מזגנים": {
    image: "https://images.unsplash.com/photo-1626228253938-b031ca93e9f2?w=800&q=90&auto=format&fit=crop",
    icon: "❄️",
    gradient: "from-sky-500 to-blue-700",
  },
  "אוזניות": {
    image: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=800&q=90&auto=format&fit=crop",
    icon: "🎧",
    gradient: "from-fuchsia-600 to-purple-700",
  },
  "קונסולות משחק": {
    image: "https://images.unsplash.com/photo-1605901309584-818e25960a8f?w=800&q=90&auto=format&fit=crop",
    icon: "🎮",
    gradient: "from-red-600 to-orange-600",
  },
  "טאבלטים": {
    image: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800&q=90&auto=format&fit=crop",
    icon: "📲",
    gradient: "from-emerald-500 to-teal-600",
  },
  "מצלמות": {
    image: "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&q=90&auto=format&fit=crop",
    icon: "📷",
    gradient: "from-amber-600 to-orange-700",
  },
  "iphone": {
    image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&q=90&auto=format&fit=crop",
    icon: "📱",
    gradient: "from-gray-800 to-gray-900",
  },
  "tv": {
    image: "https://images.unsplash.com/photo-1593784991095-a205069470b6?w=800&q=90&auto=format&fit=crop",
    icon: "📺",
    gradient: "from-indigo-600 to-violet-700",
  },
  "אוזניות over ear": {
    image: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=800&q=90&auto=format&fit=crop",
    icon: "🎧",
    gradient: "from-fuchsia-600 to-purple-700",
  },
  "מכונת כביסה": {
    image: "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=800&q=90&auto=format&fit=crop",
    icon: "🧺",
    gradient: "from-blue-500 to-sky-600",
  },
  "מקרר 4 דלתות": {
    image: "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=800&q=90&auto=format&fit=crop",
    icon: "🧊",
    gradient: "from-cyan-600 to-blue-700",
  },
  "שואבי אבק רובוטיים": {
    image: "https://images.unsplash.com/photo-1603618090561-412154b4bd1b?w=800&q=90&auto=format&fit=crop",
    icon: "🤖",
    gradient: "from-teal-500 to-emerald-700",
  },
  "מקררים": {
    image: "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=800&q=90&auto=format&fit=crop",
    icon: "🧊",
    gradient: "from-cyan-600 to-blue-700",
  },
  "מכונות כביסה ומייבשים": {
    image: "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=800&q=90&auto=format&fit=crop",
    icon: "🧺",
    gradient: "from-blue-500 to-sky-600",
  },
  "תנורים וכיריים": {
    image: "https://images.unsplash.com/photo-1556912173-3bb406ef7e77?w=800&q=90&auto=format&fit=crop",
    icon: "🍳",
    gradient: "from-orange-500 to-red-600",
  },
  "מדיחי כלים": {
    image: "https://images.unsplash.com/photo-1581622558663-b2e33377dfb2?w=800&q=90&auto=format&fit=crop",
    icon: "🍽️",
    gradient: "from-slate-500 to-gray-700",
  },
  // Default fallback
  _default: {
    image: "https://images.unsplash.com/photo-1557821552-17105176677c?w=600&q=80&auto=format&fit=crop",
    icon: "📦",
    gradient: "from-gray-600 to-gray-800",
  },
};
