/**
 * Bundly — F1-style closed-loop circuit loader.
 *
 * Animated delivery van laps a winding race-circuit, stopping at six stores
 * to show plausible per-store prices (price hints are derived from the
 * productName prop so it feels relevant to whatever search is loading).
 *
 * Two modes:
 *   compact=true  → mini horizontal road (88×38px) for inline status pills
 *   compact=false → full 480×280 circuit scene for modal/page-level loading
 *
 * Pure SVG — no React state, no imports. Drop in anywhere.
 */

export default function BundlyRoadLoader({ message, subMessage, compact = false, productName = '' }) {
  // Generate 6 plausible store prices based on the product being searched
  const storePrices = (() => {
    const n = (productName || '').toLowerCase();
    let base;
    if      (/ps5|playstation.?5/.test(n))           base = 1899;
    else if (/ps4|playstation.?4/.test(n))            base = 799;
    else if (/xbox/.test(n))                          base = 1699;
    else if (/nintendo|switch/.test(n))               base = 1099;
    else if (/iphone/.test(n))                        base = 3499;
    else if (/samsung.*(galaxy|s\d)/.test(n))         base = 2999;
    else if (/laptop|notebook|מחשב נייד/.test(n))    base = 3899;
    else if (/ipad/.test(n))                          base = 1799;
    else if (/\bmonitor\b|מסך/.test(n))              base = 899;
    else if (/headphones|airpods|אוזניות/.test(n))    base = 449;
    else if (/keyboard|מקלדת/.test(n))                base = 199;
    else if (/\bmouse\b|עכבר/.test(n))               base = 149;
    else if (/\btv\b|טלוויזיה/.test(n))              base = 2299;
    else if (/camera|מצלמה/.test(n))                  base = 1399;
    else { let h=5381; for(const c of n) h=((h<<5)+h+c.charCodeAt(0))&0x7fff; base=200+(h%1100); }
    return [1.00,0.91,1.07,0.95,1.13,0.87].map(m=>{
      const v=Math.round(base*m/10)*10; return `₪${v>9?v-1:v}`;
    });
  })();

  // Long winding F1 circuit — multiple chicanes, two hairpins, S-curves, long straights
  // ViewBox: 0 0 480 280
  const LOOP = "M 88,265 L 370,265 C 438,265 462,232 462,188 C 462,138 440,102 404,86 C 380,74 348,70 318,80 C 294,88 278,112 255,118 C 232,124 208,108 184,84 L 108,28 C 66,14 18,48 14,100 C 10,154 38,200 74,228 C 82,248 87,258 88,265 Z";

  /* ── Compact (inline card) ─────────────────────────────────── */
  if (compact) {
    return (
      <>
        <style>{`
          @keyframes brlMiniDrive{0%{left:2px}14%{left:20px}21%{left:20px}35%{left:40px}42%{left:40px}57%{left:58px}64%{left:58px}79%{left:76px}86%{left:76px}100%{left:2px}}
          .brl-mini-car{position:absolute;bottom:4px;animation:brlMiniDrive 9s ease-in-out infinite}
          @keyframes brlMiniP1{0%,13%{opacity:0;transform:translateY(3px) scale(.6)}19%{opacity:1;transform:translateY(0) scale(1)}24%{opacity:1}30%{opacity:0}100%{opacity:0}}
          @keyframes brlMiniP2{0%,34%{opacity:0;transform:translateY(3px) scale(.6)}40%{opacity:1;transform:translateY(0) scale(1)}45%{opacity:1}51%{opacity:0}100%{opacity:0}}
          @keyframes brlMiniP3{0%,56%{opacity:0;transform:translateY(3px) scale(.6)}62%{opacity:1;transform:translateY(0) scale(1)}67%{opacity:1}73%{opacity:0}100%{opacity:0}}
          @keyframes brlMiniP4{0%,78%{opacity:0;transform:translateY(3px) scale(.6)}84%{opacity:1;transform:translateY(0) scale(1)}89%{opacity:1}95%{opacity:0}100%{opacity:0}}
        `}</style>
        <div style={{position:'relative',width:104,height:38,flexShrink:0}}>
          <div style={{position:'absolute',bottom:10,left:2,right:2,height:5,background:'#e2e8f0',borderRadius:3}}/>
          <div style={{position:'absolute',bottom:12,left:2,right:2,height:1.5,backgroundImage:'repeating-linear-gradient(to right,#fcd34d 0 7px,transparent 7px 13px)'}}/>
          {[
            {left:14, color:'#64748b', roof:'#475569', price:storePrices[0]},
            {left:33, color:'#fef3c7', roof:'#f59e0b', price:storePrices[1]},
            {left:52, color:'#ede9fe', roof:'#7c3aed', price:storePrices[2]},
            {left:70, color:'#fee2e2', roof:'#dc2626', price:storePrices[3]},
          ].map((s, i) => (
            <div key={i} style={{position:'absolute',bottom:14,left:s.left}}>
              <svg width="12" height="11" viewBox="0 0 12 11">
                <rect x="0" y="4" width="12" height="7" rx="1" fill={s.color}/>
                <rect x="0" y="1" width="12" height="5" rx="1" fill={s.roof}/>
                <rect x="1" y="5" width="3" height="4" rx="0.4" fill="#bfdbfe" opacity="0.8"/>
                <rect x="6" y="5" width="3" height="4" rx="0.4" fill="#bfdbfe" opacity="0.8"/>
              </svg>
              <div style={{animation:`brlMiniP${i+1} 9s ease-in-out infinite`,opacity:0,position:'absolute',bottom:12,left:'50%',transform:'translateX(-50%)',fontSize:6.5,fontWeight:900,color:'#059669',background:'#d1fae5',borderRadius:4,padding:'1px 3px',whiteSpace:'nowrap'}}>{s.price}</div>
            </div>
          ))}
          <div className="brl-mini-car">
            {/* Mini commercial van */}
            <svg width="18" height="14" viewBox="0 0 18 14">
              <defs>
                <linearGradient id="miniVanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
              {/* Cargo body */}
              <rect x="0" y="0" width="12" height="9" rx="1.5" fill="url(#miniVanGrad)"/>
              {/* B on cargo */}
              <text x="6" y="7" textAnchor="middle" fontSize="6" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">B</text>
              {/* Cab */}
              <rect x="12" y="2" width="6" height="7" rx="2" fill="#6d28d9"/>
              {/* Windshield */}
              <rect x="13" y="3" width="4" height="4" rx="1" fill="#bae6fd" opacity="0.85"/>
              {/* Wheels */}
              <circle cx="4"  cy="11" r="2.5" fill="#1e1b4b"/><circle cx="4"  cy="11" r="1" fill="#818cf8"/>
              <circle cx="14" cy="11" r="2.5" fill="#1e1b4b"/><circle cx="14" cy="11" r="1" fill="#818cf8"/>
            </svg>
          </div>
        </div>
      </>
    );
  }

  /* ── Full winding circuit ──────────────────────────────────── */
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
      <style>{`
        @keyframes brlP1{0%,7% {opacity:0;transform:scale(.3) translateY(8px)}13%{opacity:1;transform:scale(1.1) translateY(0)}17%{opacity:1}23%{opacity:0}100%{opacity:0}}
        @keyframes brlP2{0%,22%{opacity:0;transform:scale(.3) translateY(8px)}28%{opacity:1;transform:scale(1.1) translateY(0)}32%{opacity:1}38%{opacity:0}100%{opacity:0}}
        @keyframes brlP3{0%,37%{opacity:0;transform:scale(.3) translateY(8px)}43%{opacity:1;transform:scale(1.1) translateY(0)}47%{opacity:1}53%{opacity:0}100%{opacity:0}}
        @keyframes brlP4{0%,52%{opacity:0;transform:scale(.3) translateY(8px)}58%{opacity:1;transform:scale(1.1) translateY(0)}62%{opacity:1}68%{opacity:0}100%{opacity:0}}
        @keyframes brlP5{0%,66%{opacity:0;transform:scale(.3) translateY(8px)}72%{opacity:1;transform:scale(1.1) translateY(0)}76%{opacity:1}82%{opacity:0}100%{opacity:0}}
        @keyframes brlP6{0%,80%{opacity:0;transform:scale(.3) translateY(8px)}86%{opacity:1;transform:scale(1.1) translateY(0)}90%{opacity:1}96%{opacity:0}100%{opacity:0}}
      `}</style>

      <div style={{position:'relative',width:480,height:280}}>
        <svg width="480" height="280" viewBox="0 0 480 280" style={{display:'block'}}>
          <defs>
            <linearGradient id="bVanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed"/>
              <stop offset="100%" stopColor="#a855f7"/>
            </linearGradient>
          </defs>

          {/* Circuit interior fill */}
          <path id="brl-circuit" d={LOOP} fill="#f0fdf4" opacity="0.4"/>
          {/* Interior greenery */}
          <text x="195" y="148" fontSize="20" opacity="0.28">🌳</text>
          <text x="240" y="120" fontSize="13" opacity="0.22">🌿</text>
          <text x="168" y="175" fontSize="11" opacity="0.18">🌱</text>
          <text x="260" y="165" fontSize="10" opacity="0.18">🌿</text>
          <text x="210" y="95"  fontSize="9"  opacity="0.15">🌱</text>

          {/* Road: outer kerb strip */}
          <path d={LOOP} fill="none" stroke="#b0bec5" strokeWidth="28" strokeLinejoin="round"/>
          {/* Red/white kerb dashes at corners */}
          <path d={LOOP} fill="none" stroke="#ef4444" strokeWidth="28" strokeLinejoin="round"
                strokeDasharray="7 55" opacity="0.22"/>
          {/* Road asphalt surface */}
          <path d={LOOP} fill="none" stroke="#dde2e8" strokeWidth="23" strokeLinejoin="round"/>
          {/* Centre dashes */}
          <path d={LOOP} fill="none" stroke="#fcd34d" strokeWidth="1.6" strokeLinejoin="round" strokeDasharray="11 11"/>

          {/* Start/finish chequered strip — at bottom straight start */}
          <rect x="107" y="256" width="28" height="6" rx="1.5" fill="#1e1b4b" opacity="0.12"/>
          <rect x="111" y="256" width="5"  height="6" fill="white" opacity="0.6"/>
          <rect x="121" y="256" width="5"  height="6" fill="white" opacity="0.6"/>
          <rect x="131" y="256" width="5"  height="6" fill="white" opacity="0.6"/>

          {/* ── DELIVERY VAN — large commercial vehicle with big "B" on back ── */}
          <g>
            {/* Ground shadow */}
            <ellipse cx="0" cy="8" rx="36" ry="5" fill="#000" opacity="0.09"/>
            {/* ── Cargo box (rear / main body) ── */}
            <rect x="-40" y="-24" width="50" height="24" rx="3" fill="url(#bVanGrad)"/>
            {/* Cargo top highlight stripe */}
            <rect x="-40" y="-24" width="50" height="5" rx="3" fill="#6d28d9" opacity="0.55"/>
            {/* Rear door seam line */}
            <line x1="-40" y1="-12" x2="10" y2="-12" stroke="#6d28d9" strokeWidth="1" opacity="0.5"/>
            {/* BIG "B" on cargo side */}
            <text x="-16" y="-6" textAnchor="middle" dominantBaseline="middle"
                  fontSize="22" fill="white" fontWeight="900"
                  fontFamily="Rubik,system-ui,sans-serif">B</text>
            {/* ── Cab (driver section, front) ── */}
            <rect x="10" y="-21" width="26" height="21" rx="5" fill="#6d28d9"/>
            {/* Cab roof rack */}
            <rect x="10" y="-26" width="26" height="7"  rx="3" fill="#5b21b6"/>
            {/* Windshield */}
            <rect x="13" y="-19" width="18" height="13" rx="2.5" fill="#bae6fd" opacity="0.88"/>
            {/* Windshield glare */}
            <rect x="14" y="-18" width="6"  height="4"  rx="1"   fill="white" opacity="0.35"/>
            {/* Headlight */}
            <rect x="34" y="-13" width="2.5" height="6" rx="1" fill="#fef9c3"/>
            {/* Side mirror */}
            <rect x="35" y="-20" width="4" height="3" rx="1" fill="#5b21b6"/>
            {/* ── Wheels — tandem rear + single front ── */}
            {/* Rear tandem axle */}
            <circle cx="-26" cy="5" r="8"   fill="#1a1a2e" stroke="#7c3aed" strokeWidth="1.5"/>
            <circle cx="-26" cy="5" r="3.5" fill="#818cf8"/>
            <circle cx="-13" cy="5" r="8"   fill="#1a1a2e" stroke="#7c3aed" strokeWidth="1.5"/>
            <circle cx="-13" cy="5" r="3.5" fill="#818cf8"/>
            {/* Front axle */}
            <circle cx="24"  cy="5" r="7"   fill="#1a1a2e" stroke="#7c3aed" strokeWidth="1.5"/>
            <circle cx="24"  cy="5" r="3"   fill="#818cf8"/>
            <animateMotion
              dur="12s"
              repeatCount="indefinite"
              rotate="auto"
              keyPoints="0;0.13;0.13;0.26;0.26;0.40;0.40;0.55;0.55;0.69;0.69;0.83;0.83;1"
              keyTimes="0;0.10;0.16;0.24;0.30;0.38;0.44;0.53;0.59;0.67;0.73;0.82;0.88;1"
              calcMode="linear"
            >
              <mpath href="#brl-circuit"/>
            </animateMotion>
          </g>

          {/* ══ STORE 1 — shop (bottom straight, ~13%) ══ */}
          <g transform="translate(248,279)">
            <rect x="-11" y="-12" width="22" height="10" rx="1.5" fill="#fef3c7"/>
            <rect x="-11" y="-16" width="22" height="6"  rx="1.5" fill="#16a34a"/>
            <rect x="-8"  y="-9"  width="4"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <rect x="-2"  y="-6"  width="4"  height="6"  rx="0.5" fill="#fde68a"/>
            <rect x="4"   y="-9"  width="4"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <g style={{animation:'brlP1 12s ease-in-out infinite',transformOrigin:'0px -28px'}}>
              <rect x="-22" y="-48" width="44" height="18" rx="9" fill="#10b981"/>
              <text x="0" y="-34" textAnchor="middle" fontSize="11" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">{storePrices[0]}</text>
            </g>
          </g>

          {/* ══ STORE 2 — service building (right hairpin, ~26%) ══ */}
          <g transform="translate(470,188)">
            <rect x="-12" y="-14" width="22" height="12" rx="1.5" fill="#fee2e2"/>
            <rect x="-12" y="-19" width="22" height="7"  rx="1.5" fill="#dc2626"/>
            <rect x="-9"  y="-11" width="4"  height="6"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <rect x="-3"  y="-8"  width="5"  height="7"  rx="0.5" fill="#fde68a"/>
            <rect x="4"   y="-11" width="4"  height="6"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <g style={{animation:'brlP2 12s ease-in-out infinite',transformOrigin:'-10px -32px'}}>
              <rect x="-32" y="-56" width="44" height="18" rx="9" fill="#10b981"/>
              <text x="-10" y="-42" textAnchor="middle" fontSize="11" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">{storePrices[1]}</text>
            </g>
          </g>

          {/* ══ STORE 3 — warehouse (top-right area, ~40%) ══ */}
          <g transform="translate(435,62)">
            <rect x="-13" y="-14" width="26" height="12" rx="1.5" fill="#94a3b8"/>
            <rect x="-13" y="-19" width="26" height="7"  rx="1.5" fill="#475569"/>
            <rect x="-10" y="-8"  width="8"  height="5"  rx="0.5" fill="#e2e8f0"/>
            <line x1="-10" y1="-6" x2="-2" y2="-6" stroke="#cbd5e1" strokeWidth="0.7"/>
            <rect x="2"   y="-10" width="7"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.85"/>
            <rect x="-4"  y="-21" width="6"  height="4"  rx="1"   fill="#475569"/>
            <g style={{animation:'brlP3 12s ease-in-out infinite',transformOrigin:'-10px -32px'}}>
              <rect x="-32" y="-56" width="44" height="18" rx="9" fill="#10b981"/>
              <text x="-10" y="-42" textAnchor="middle" fontSize="11" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">{storePrices[2]}</text>
            </g>
          </g>

          {/* ══ STORE 4 — corner store (top centre S-curve, ~55%) ══ */}
          <g transform="translate(228,10)">
            <rect x="-13" y="-2" width="26" height="11" rx="1.5" fill="#eff6ff"/>
            <rect x="-13" y="-7" width="26" height="7"  rx="1.5" fill="#3b82f6"/>
            <rect x="-10" y="1"  width="5"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <rect x="-3"  y="3"  width="4"  height="7"  rx="0.5" fill="#dbeafe"/>
            <rect x="4"   y="1"  width="5"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <g style={{animation:'brlP4 12s ease-in-out infinite',transformOrigin:'0px 25px'}}>
              <rect x="-22" y="17" width="44" height="18" rx="9" fill="#10b981"/>
              <text x="0" y="31" textAnchor="middle" fontSize="11" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">{storePrices[3]}</text>
            </g>
          </g>

          {/* ══ STORE 5 — mini-market (top-left, ~69%) ══ */}
          <g transform="translate(80,10)">
            <rect x="-2"  y="-2" width="22" height="11" rx="1.5" fill="#ede9fe"/>
            <rect x="-2"  y="-7" width="22" height="7"  rx="1.5" fill="#7c3aed"/>
            <rect x="0"   y="1"  width="4"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <rect x="7"   y="3"  width="4"  height="7"  rx="0.5" fill="#ddd6fe"/>
            <rect x="13"  y="1"  width="4"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <rect x="4"   y="-9" width="8"  height="4"  rx="1"   fill="#6d28d9"/>
            <g style={{animation:'brlP5 12s ease-in-out infinite',transformOrigin:'10px 25px'}}>
              <rect x="-12" y="17" width="44" height="18" rx="9" fill="#10b981"/>
              <text x="10" y="31" textAnchor="middle" fontSize="11" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">{storePrices[4]}</text>
            </g>
          </g>

          {/* ══ STORE 6 — depot (left side coming down, ~83%) ══ */}
          <g transform="translate(6,152)">
            <rect x="-2"  y="-13" width="26" height="11" rx="1.5" fill="#f0fdf4"/>
            <rect x="-2"  y="-18" width="26" height="7"  rx="1.5" fill="#15803d"/>
            <rect x="0"   y="-8"  width="7"  height="5"  rx="0.5" fill="#e2e8f0"/>
            <line x1="0" y1="-5" x2="7" y2="-5" stroke="#cbd5e1" strokeWidth="0.7"/>
            <rect x="9"   y="-10" width="5"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <rect x="16"  y="-10" width="5"  height="5"  rx="0.5" fill="#bfdbfe" opacity="0.8"/>
            <g style={{animation:'brlP6 12s ease-in-out infinite',transformOrigin:'14px -30px'}}>
              <rect x="-8"  y="-54" width="44" height="18" rx="9" fill="#10b981"/>
              <text x="14" y="-40" textAnchor="middle" fontSize="11" fill="white" fontWeight="900" fontFamily="Rubik,sans-serif">{storePrices[5]}</text>
            </g>
          </g>

        </svg>
      </div>

      {message    && <p className="text-gray-800 font-bold text-base text-center mt-1">{message}</p>}
      {subMessage && <p className="text-indigo-600 text-sm font-semibold text-center mt-0.5">{subMessage}</p>}
      <p className="text-xs text-gray-400 text-center mt-2">Bundly סורקת מאות חנויות עבורך</p>
    </div>
  );
}
