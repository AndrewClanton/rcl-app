(() => {
  const P = { red:"#c8141b", dred:"#8f0b10", gold:"#e8b331", lgold:"#ffd36b", navy:"#1c2c4c", night:"#121a33", cream:"#f6ecd6", ink:"#1a1612", teal:"#2f6f6b", plum:"#5a2a4a", orange:"#e0702a", pink:"#e98fa8", green:"#3f7a3a", brown:"#6b4426", walnut:"#5b3a22", silver:"#c9cdd2", steel:"#7d8590", white:"#ffffff", bronze:"#b07a45", dbronze:"#8a5a2c", brass:"#c9a24a" };
  const svg = (inner, size, label) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${label}">${inner}</svg>`;
  const T = (t, x, y, s, fill, font = "Archivo Black,Arial Black,sans-serif", extra = "") => `<text x="${x}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${s}" fill="${fill}" ${extra}>${t}</text>`;
  const ring = (n, r, cx, cy, f) => Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2, cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2), i)).join("");

  // ---------- FORMS: the base object. Each takes a palette {fill, edge, stitch, tail}. ----------
  const SHAPES = { round:"M50 6 A44 44 0 1 1 49.9 6 Z", rounded:"M10 30 Q10 14 26 14 H74 Q90 14 90 30 V82 H10 Z", square:"M14 10 H86 V90 H14 Z", card:"M12 16 Q12 10 18 10 H82 Q88 10 88 16 V84 Q88 90 82 90 H18 Q12 90 12 84 Z", diamond:"M50 6 L92 50 L50 94 L8 50 Z", slice:"M50 92 L12 22 Q50 2 88 22 Z" };
  const FORMS = {
    pin: (o) => `<path d="${SHAPES[o.shape || "round"]}" fill="${o.edge}"/><path d="${SHAPES[o.shape || "round"]}" fill="${o.fill}" transform="translate(50 50) scale(.86) translate(-50 -50)"/>`,
    patch: (o) => `<path d="${SHAPES[o.shape || "round"]}" fill="${o.fill}"/><path d="${SHAPES[o.shape || "round"]}" fill="none" stroke="${o.stitch}" stroke-width="2.2" stroke-dasharray="3 2.4" transform="translate(50 50) scale(.88) translate(-50 -50)"/>`,
    coin: (o) => `<circle cx="50" cy="50" r="44" fill="${o.edge}"/><circle cx="50" cy="50" r="44" fill="none" stroke="${o.fill}" stroke-width="4" stroke-dasharray="1.6 1.9"/><circle cx="50" cy="50" r="36" fill="${o.fill}"/><circle cx="50" cy="50" r="32" fill="none" stroke="${o.edge}" stroke-width="1.6"/>`,
    button: (o) => `<circle cx="50" cy="50" r="42" fill="${o.fill}"/><circle cx="50" cy="50" r="42" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/>`,
    stub: (o) => `<path d="M10 24 H90 V40 A8 8 0 0 0 90 60 V76 H10 V60 A8 8 0 0 0 10 40 Z" fill="${o.fill}"/><line x1="70" y1="27" x2="70" y2="73" stroke="${P.cream}" stroke-width="1.6" stroke-dasharray="2.5 2.5"/>`,
    rosette: (o) => `<path d="M38 66 L30 96 L40 89 L46 98 L50 68 Z M62 66 L70 96 L60 89 L54 98 L50 68 Z" fill="${o.tail}"/>${ring(16, 30, 50, 44, (a, x, y) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${o.fill}"/>`)}<circle cx="50" cy="44" r="27" fill="${o.fill}"/><circle cx="50" cy="44" r="22" fill="none" stroke="${P.cream}" stroke-width="1.4" stroke-dasharray="2 2"/>`,
    pennant: (o) => `<rect x="14" y="10" width="5" height="84" rx="2" fill="${P.brown}"/><path d="M19 14 L92 36 L19 60 Z" fill="${o.fill}"/><path d="M23 20 L84 36 L23 53 Z" fill="none" stroke="${P.cream}" stroke-width="1.6" stroke-dasharray="3 2.5"/>`,
    crest: (o) => `<path d="M50 10 L84 20 V46 Q84 76 50 92 Q16 76 16 46 V20 Z" fill="${o.fill}"/><path d="M50 15 L79 24 V46 Q79 72 50 86 Q21 72 21 46 V24 Z" fill="none" stroke="${o.edge}" stroke-width="1.8"/>`,
    filmcan: () => `<circle cx="50" cy="50" r="42" fill="${P.steel}"/><circle cx="50" cy="50" r="38" fill="${P.silver}"/>`,
    none: () => "",
  };
  // ---------- PARTS: pictures, accents and plates, each drawn centered on 50,50 ----------
  const PARTS = {
    admit: () => T("ADMIT", 50, 46, 10, P.cream) + T("ONE", 50, 59, 10, P.cream),
    star: (o) => `<path d="M50 41 l2.6 5.4 5.9 .7 -4.4 4 1.2 5.8 -5.3 -3 -5.3 3 1.2 -5.8 -4.4 -4 5.9 -.7 z" fill="${o.c || P.lgold}"/>`,
    stars: (o) => `<g fill="${o.c || P.white}"><circle cx="24" cy="24" r="1.8"/><circle cx="32" cy="15" r="1.2"/><circle cx="78" cy="70" r="1.4"/><circle cx="18" cy="60" r="1.2"/></g>`,
    sunrise: () => `<circle cx="50" cy="58" r="18" fill="${P.red}"/><rect x="8" y="58" width="84" height="34" fill="${P.navy}"/><g stroke="${P.red}" stroke-width="4" stroke-linecap="round"><path d="M50 30 v-10 M30 40 l-7 -7 M70 40 l7 -7 M24 56 h-10 M76 56 h10"/></g>`,
    owl: () => `<path d="M30 78 Q28 46 50 42 Q72 46 70 78 Z" fill="${P.brown}"/><path d="M33 46 l-3 -10 9 6 M67 46 l3 -10 -9 6" fill="${P.brown}"/><circle cx="41" cy="54" r="8" fill="${P.cream}"/><circle cx="59" cy="54" r="8" fill="${P.cream}"/><circle cx="41" cy="54" r="3.6" fill="${P.ink}"/><circle cx="59" cy="54" r="3.6" fill="${P.ink}"/><path d="M47 61 L50 67 L53 61 Z" fill="${P.orange}"/>`,
    moon: (o) => `<path d="M52 38 a12 12 0 1 0 10 18 a10 10 0 0 1 -10 -18 z" fill="${o.c || P.lgold}"/>`,
    cake: () => `<rect x="28" y="52" width="44" height="22" rx="3" fill="${P.cream}"/><path d="M28 58 q5.5 5 11 0 t11 0 11 0 11 0" stroke="${P.red}" stroke-width="3" fill="none"/><rect x="47" y="36" width="6" height="16" rx="1.5" fill="${P.navy}"/><path d="M50 26 q6 6 0 10 q-6 -4 0 -10 z" fill="${P.lgold}"/>`,
    confetti: () => `<circle cx="24" cy="28" r="2.4" fill="${P.lgold}"/><circle cx="76" cy="30" r="2.4" fill="${P.navy}"/><circle cx="72" cy="20" r="2" fill="${P.white}"/><circle cx="20" cy="70" r="2" fill="${P.white}"/>`,
    calendar4: () => `<rect x="32" y="32" width="36" height="34" rx="3" fill="${P.cream}"/><rect x="32" y="32" width="36" height="9" rx="3" fill="${P.red}"/><g stroke="${P.ink}" stroke-width="2.6" stroke-linecap="round"><path d="M40 48 v12 M46 48 v12 M52 48 v12 M58 48 v12 M37 58 l25 -8"/></g>`,
    popcorn: () => `<path d="M32 46 L37 82 H63 L68 46 Z" fill="${P.white}"/><g fill="${P.red}"><path d="M37 46 L41 82 H46 L44 46 Z"/><path d="M53 46 L53 82 H58 L60 46 Z"/></g><g fill="#fff7dc" stroke="#e2c98a" stroke-width="1"><circle cx="37" cy="42" r="7"/><circle cx="47" cy="36" r="8"/><circle cx="57" cy="38" r="8"/><circle cx="65" cy="44" r="6"/><circle cx="51" cy="28" r="6"/></g>`,
    pizza: () => `<path d="M50 84 L24 32 Q50 20 76 32 Z" fill="#f3c35a"/><path d="M24 32 Q50 20 76 32 L73 38 Q50 27 27 38 Z" fill="#c9883b"/><g fill="${P.red}"><circle cx="42" cy="44" r="5"/><circle cx="58" cy="46" r="5"/><circle cx="50" cy="62" r="5"/></g>`,
    num: (o) => T(o.t, 50, o.y || 57, o.s || 22, o.c || P.ink),
    seat: () => `<path d="M32 30 Q50 22 68 30 V56 H32 Z" fill="${P.red}"/><path d="M36 34 Q50 28 64 34" stroke="${P.dred}" stroke-width="2" fill="none"/><rect x="28" y="54" width="44" height="12" rx="4" fill="${P.dred}"/><rect x="30" y="66" width="5" height="12" fill="${P.ink}"/><rect x="65" y="66" width="5" height="12" fill="${P.ink}"/>`,
    sofa: () => `<path d="M20 52 Q20 32 50 32 Q80 32 80 52 V62 H20 Z" fill="${P.red}"/><path d="M29 50 Q50 39 71 50" stroke="${P.dred}" stroke-width="2" fill="none"/><rect x="16" y="58" width="68" height="12" rx="4" fill="${P.dred}"/><rect x="22" y="70" width="5" height="8" fill="${P.ink}"/><rect x="73" y="70" width="5" height="8" fill="${P.ink}"/>`,
    crown: (o) => `<path d="M32 60 L30 38 L40 46 L50 32 L60 46 L70 38 L68 60 Z" fill="${o.c || P.red}"/><rect x="32" y="60" width="36" height="6" rx="1.5" fill="${o.c2 || P.dred}"/>`,
    laurel: (o) => `<g fill="${o.c || "#7d5a0b"}"><path d="M24 66 q-6 -10 -2 -22 q6 10 2 22 z"/><path d="M76 66 q6 -10 2 -22 q-6 10 -2 22 z"/><path d="M28 74 q-9 -3 -12 -12 q9 2 12 12 z"/><path d="M72 74 q9 -3 12 -12 q-9 2 -12 12 z"/></g>`,
    calWed: () => `<rect x="24" y="18" width="52" height="42" rx="3" fill="${P.white}" stroke="${P.navy}" stroke-width="1.6"/><rect x="24" y="18" width="52" height="13" rx="3" fill="${P.red}"/>${T("WED", 50, 28.5, 9.5, P.white)}<path d="M30 52 Q50 32 70 52" stroke="${P.navy}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    filmstrip: () => `<rect x="14" y="66" width="72" height="14" fill="${P.ink}"/><g fill="${P.cream}">${Array.from({ length: 9 }, (_, i) => `<rect x="${17 + i * 8}" y="68" width="4" height="3" rx=".6"/><rect x="${17 + i * 8}" y="75" width="4" height="3" rx=".6"/>`).join("")}</g>`,
    reels: () => ring(5, 22, 50, 50, (a, x, y) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${P.steel}"/>`) + `<circle cx="50" cy="50" r="12" fill="${P.red}"/>`,
    clock12: () => `<circle cx="50" cy="50" r="24" fill="${P.cream}"/>${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<line x1="${(50 + 20 * Math.sin(a)).toFixed(1)}" y1="${(50 - 20 * Math.cos(a)).toFixed(1)}" x2="${(50 + 22.5 * Math.sin(a)).toFixed(1)}" y2="${(50 - 22.5 * Math.cos(a)).toFixed(1)}" stroke="${P.ink}" stroke-width="${i % 3 ? 1.2 : 2.4}"/>`; }).join("")}<line x1="50" y1="50" x2="50" y2="32" stroke="${P.ink}" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="50" x2="50" y2="36" stroke="${P.red}" stroke-width="4.5" stroke-linecap="round"/><circle cx="50" cy="50" r="2.6" fill="${P.ink}"/>`,
    yearText: (o) => T("ANNUAL", 50, 40, 7, P.cream, "Space Mono,Courier New,monospace", 'font-weight="700" letter-spacing="1.5"') + T(o.t, 50, 56, 15, P.lgold),
    vhs: () => `<g transform="rotate(-6 50 50)"><rect x="8" y="24" width="84" height="52" rx="4" fill="${P.ink}"/><rect x="16" y="30" width="68" height="20" rx="2" fill="#e9dcbc"/><path d="M16 30 h20 l-6 6 -8 -2 z M70 46 l14 -4 v8 h-10 z" fill="#c9b78f"/>${T("LONG HAUL · SP", 50, 44, 7, "#6b5a3a", "Space Mono,Courier New,monospace", 'font-weight="700"')}<rect x="26" y="56" width="48" height="14" rx="3" fill="#2b2620"/><circle cx="38" cy="63" r="5" fill="${P.steel}"/><circle cx="62" cy="63" r="5" fill="${P.steel}"/><path d="M12 30 l5 4 M84 70 l4 -3 M88 34 l-3 6" stroke="#5c5650" stroke-width="1.4"/></g>`,
    letterR: (o) => T("R", 50, 62, 30, o.c || P.lgold),
    mic: () => `<rect x="44" y="26" width="12" height="22" rx="6" fill="${P.cream}"/><path d="M39 40 a11 11 0 0 0 22 0 M50 51 v8 M43 60 h14" stroke="${P.cream}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    qbubble: () => `<path d="M38 30 h24 q5 0 5 5 v12 q0 5 -5 5 h-13 l-7 6 v-6 h-4 q-5 0 -5 -5 v-12 q0 -5 5 -5 z" fill="${P.lgold}"/>${T("?", 50, 46, 14, P.ink)}`,
    pumpkin: () => `<path d="M50 32 q2 -8 8 -9" stroke="${P.green}" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="50" cy="54" rx="24" ry="20" fill="${P.orange}"/><path d="M38 48 l5 -6 5 6 z M52 48 l5 -6 5 6 z" fill="${P.ink}"/><path d="M36 58 q14 12 28 0 l-4 4 -4 -3 -4 4 -4 -4 -4 4 -4 -3 z" fill="${P.ink}"/>`,
    gift: () => `<rect x="28" y="46" width="44" height="30" rx="2" fill="${P.red}"/><rect x="25" y="38" width="50" height="10" rx="2" fill="${P.dred}"/><rect x="46" y="38" width="8" height="38" fill="${P.lgold}"/><path d="M50 38 q-14 -14 -16 -4 q0 6 16 4 z M50 38 q14 -14 16 -4 q0 6 -16 4 z" fill="${P.lgold}"/>`,
    barstool: () => `<ellipse cx="50" cy="34" rx="20" ry="6" fill="${P.red}"/><rect x="30" y="34" width="40" height="5" rx="2" fill="${P.dred}"/><g stroke="${P.brass}" stroke-width="3.2" stroke-linecap="round"><path d="M38 39 L32 80 M62 39 L68 80 M50 39 V80"/><path d="M35 62 H65"/></g>`,
    plate: (o) => `<rect x="${50 - o.w / 2}" y="${o.y - 7}" width="${o.w}" height="14" rx="2.5" fill="${P.brass}" stroke="#8a6a1f" stroke-width="1.2"/><circle cx="${50 - o.w / 2 + 4}" cy="${o.y}" r="1.2" fill="#8a6a1f"/><circle cx="${50 + o.w / 2 - 4}" cy="${o.y}" r="1.2" fill="#8a6a1f"/>${T(o.t, 50, o.y + 3.6, 9.5, P.ink)}`,
    speech: () => `<path d="M14 18 h18 q4 0 4 4 v7 q0 4 -4 4 h-8 l-5 4 v-4 h-5 q-4 0 -4 -4 v-7 q0 -4 4 -4 z" fill="${P.cream}"/><g fill="${P.ink}"><circle cx="18" cy="25.5" r="1.4"/><circle cx="23" cy="25.5" r="1.4"/><circle cx="28" cy="25.5" r="1.4"/></g><path d="M68 12 h16 q4 0 4 4 v6 q0 4 -4 4 h-3 v4 l-5 -4 h-8 q-4 0 -4 -4 v-6 q0 -4 4 -4 z" fill="${P.lgold}"/>`,
    shine: () => `<path d="M24 34 Q30 18 50 13 Q34 22 29 38 Z" fill="#fff" opacity=".28"/>`,
  };
  // A badge's art is a recipe: a form, then parts at a place and size.
  const compose = (r) => FORMS[r.form[0]](r.form[1] || {}) + (r.parts || []).map(([id, o = {}]) => `<g transform="translate(${o.x ?? 50} ${o.y ?? 50}) rotate(${o.r || 0}) scale(${o.s ?? 1}) translate(-50 -50)">${PARTS[id](o)}</g>`).join("");
  const draw = (r, size, label) => svg(compose(r), size, label);
  const B = [
    { name:"Welcome", line:"Your first check-in.", form:"Ticket stub", r:{ form:["stub", { fill:P.red }], parts:[["admit", { x:40 }], ["star", { x:81, y:50 }]] } },
    { name:"Early Riser", line:"Checked in before 8:30 AM.", form:"Enamel pin", r:{ form:["pin", { fill:"#fde3b0", edge:P.gold }], parts:[["sunrise", { s:.86 }], ["shine"]] } },
    { name:"Night Owl", line:"Checked in at 11 PM or later.", form:"Stitched patch", r:{ form:["patch", { fill:P.night, stitch:P.gold }], parts:[["owl", { y:52 }], ["moon", { x:70, y:28, s:.85 }], ["stars"]] } },
    { name:"Birthday Visit", line:"Came in on your birthday week.", form:"Pinback button", r:{ form:["button", { fill:P.pink }], parts:[["cake"], ["confetti"], ["shine"]] } },
    { name:"4 Weeks", line:"Four weeks in a row.", form:"Bronze coin", r:{ form:["coin", { fill:P.bronze, edge:P.dbronze }], parts:[["calendar4"]] } },
    { name:"A Season", line:"13 weeks in a row. Free popcorn.", form:"Stitched patch", r:{ form:["patch", { shape:"square", fill:P.cream, stitch:P.red }], parts:[["popcorn", { y:52 }]] } },
    { name:"Half a Year", line:"26 weeks in a row. Free pizza.", form:"Enamel pin", r:{ form:["pin", { fill:P.cream, edge:P.gold }], parts:[["pizza", { y:52 }], ["shine"]] } },
    { name:"Week for a Year", line:"Every week for a year.", form:"Ribbon rosette", r:{ form:["rosette", { fill:P.gold, tail:P.red }], parts:[["num", { t:"52", y:52 }]] } },
    { name:"Regular", line:"Your 10th check-in.", form:"Pinback button", r:{ form:["button", { fill:P.teal }], parts:[["seat"], ["shine"]] } },
    { name:"Fixture", line:"Your 50th check-in.", form:"Enamel pin", r:{ form:["pin", { shape:"rounded", fill:P.plum, edge:P.gold }], parts:[["sofa", { y:50 }], ["shine"]] } },
    { name:"Legend", line:"Your 100th check-in.", form:"Gold coin", r:{ form:["coin", { fill:P.lgold, edge:"#b8860b" }], parts:[["crown"], ["laurel"]] } },
    { name:"Midweek Movies", line:"Came to a Midweek Movie.", form:"Stitched patch", r:{ form:["patch", { shape:"card", fill:P.cream, stitch:P.navy }], parts:[["calWed", { y:44 }], ["filmstrip", { y:52 }]] } },
    { name:"Midweek Regular", line:"Ten Midweek Movies.", form:"Film can", r:{ form:["filmcan"], parts:[["reels"], ["num", { t:"10", y:55, s:12, c:P.white }], ["shine"]] } },
    { name:"Midnight", line:"Came to a midnight show.", form:"Enamel pin", r:{ form:["pin", { fill:P.night, edge:P.silver }], parts:[["clock12", { y:54 }], ["moon", { x:66, y:22, s:.9 }], ["stars"]] } },
    { name:"Annual", line:"A whole year, paid up front.", form:"Ribbon seal", r:{ form:["rosette", { fill:P.red, tail:P.navy }], parts:[["yearText", { t:"2026" }]] } },
    { name:"In It for the Long Haul", line:"With us since the Indy days.", form:"Worn VHS tape", r:{ form:["none"], parts:[["vhs"]] } },
    { name:"Owner", line:"One of the people who built this place.", form:"Crest, drawn by hand", r:{ form:["crest", { fill:P.ink, edge:P.gold }], parts:[["letterR"], ["laurel", { c:P.gold, y:47, s:.85 }], ["crown", { y:16, s:.42, c:P.gold, c2:P.gold }]] } },
    { name:"Trivia Night", line:"Knew the line before the line.", form:"Felt pennant", r:{ form:["pennant", { fill:P.red }], parts:[["mic", { x:38, y:38, s:.62 }], ["qbubble", { x:63, y:34, s:.7 }]] } },
    { name:"Horror Month", line:"Three October horror nights.", form:"Stitched patch", r:{ form:["patch", { shape:"diamond", fill:P.ink, stitch:P.orange }], parts:[["pumpkin", { y:52 }]] } },
    { name:"Gift Giver", line:"Gave someone Insiders+.", form:"Pinback button", r:{ form:["button", { fill:P.green }], parts:[["gift"], ["shine"]] } },
  ];
  const badge = (name, size) => { const b = B.find((x) => x.name === name); return draw(b.r, size, `${b.name} badge`); };
  const $ = (s) => document.querySelector(s);
  $("[data-badges]").innerHTML = B.map((b) => `<div class="b">${draw(b.r, 104, `${b.name} badge`)}<span class="nm">${b.name}</span><span class="ln">${b.line}</span><span class="rule">${b.form}</span></div>`).join("");
  $("[data-forms]").innerHTML = ["Enamel pin", "Stitched patch", "Ticket stub", "Coin", "Ribbon rosette", "Film can", "Felt pennant", "Pinback button", "Crest"].map((f) => `<span class="chip">${f}</span>`).join("");
  // Midnight, taken apart
  const mid = B.find((b) => b.name === "Midnight").r;
  const piece = (inner, cap) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">${svg(inner, 74, cap)}<span class="src">${cap}</span></div>`;
  const op = (t) => `<span style="font-family:var(--display);font-size:24px;color:var(--muted)">${t}</span>`;
  $("[data-exploded]").innerHTML = [piece(FORMS.pin(mid.form[1]), "Form: pin, night"), op("+"), piece(PARTS.clock12(), "Clock at 12"), op("+"), piece(`<rect width="100" height="100" rx="14" fill="${P.night}"/>${PARTS.moon({})}`, "Moon"), op("+"), piece(`<rect width="100" height="100" rx="14" fill="${P.night}"/>${PARTS.stars({})}`, "Stars"), op("="), piece(compose(mid), "Midnight")].join("");
  // The parts shelf
  const SHELF = [["admit", P.red], ["star", P.navy], ["sunrise", "#fde3b0"], ["owl", P.night], ["moon", P.night], ["cake", P.pink], ["calendar4", P.bronze], ["popcorn", P.cream], ["pizza", P.cream], ["seat", P.teal], ["sofa", P.plum], ["crown", P.lgold], ["laurel", P.lgold], ["calWed", P.cream], ["filmstrip", P.cream], ["clock12", P.night], ["vhs", P.cream], ["mic", P.red], ["qbubble", P.red], ["pumpkin", P.ink], ["gift", P.green], ["barstool", P.walnut], ["speech", P.walnut], ["plate", P.walnut]];
  $("[data-parts]").innerHTML = SHELF.map(([id, bg]) => `<div class="b" style="padding:8px">${svg(`<rect width="100" height="100" rx="14" fill="${bg}"/>${PARTS[id]({ t: "NAME", w: 50, y: 50, c: undefined })}`, 64, id)}<span class="rule">${id}</span></div>`).join("");
  // Remixes: nothing new drawn
  const REMIX = [
    { name:"Midnight Horror", line:"A horror film after midnight.", r:{ form:["pin", { fill:P.ink, edge:P.orange }], parts:[["pumpkin", { y:58, s:.9 }], ["moon", { x:66, y:22, s:.85 }], ["stars"]] } },
    { name:"Matinee Regular", line:"Ten afternoon shows.", r:{ form:["coin", { fill:"#fde3b0", edge:P.gold }], parts:[["seat", { y:48, s:.8 }], ["num", { t:"10", y:80, s:12, c:P.dred }]] } },
    { name:"Quiz Champ", line:"Won a trivia night.", r:{ form:["rosette", { fill:P.navy, tail:P.gold }], parts:[["mic", { y:42, s:.7 }], ["crown", { y:20, s:.45, c:P.lgold, c2:P.lgold }]] } },
    { name:"Pizza & a Movie", line:"Dinner and a show, same night.", r:{ form:["stub", { fill:P.navy }], parts:[["pizza", { x:38, y:52, s:.7 }], ["star", { x:81, y:50 }]] } },
  ];
  $("[data-remix]").innerHTML = REMIX.map((b) => `<div class="b">${draw(b.r, 96, b.name)}<span class="nm">${b.name}</span><span class="ln">${b.line}</span><span class="rule">${b.r.parts.map((p) => p[0]).join(" + ")}</span></div>`).join("");
  $("[data-sizes]").innerHTML = [128, 72, 40, 24].map((s) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">${badge("Midnight", s)}<span class="src">${s}px</span></div>`).join("");
  // A batch drafted from posts (examples)
  const BATCH = [
    { post:"“Rocky Horror at midnight this Saturday. Costumes encouraged!”", name:"Time Warp", line:"Did the Time Warp at midnight.", match:"Showing · Sat 11:59 PM", r:{ form:["pin", { fill:P.dred, edge:P.ink }], parts:[["clock12", { y:54 }], ["stars", { c:P.lgold }]] } },
    { post:"“Movie Quote Trivia, Thursday 7 PM. Teams of 4.”", name:"Quote Unquote", line:"Knew the line before the line.", match:"House event · Thu 7 PM", r:{ form:["pennant", { fill:P.teal }], parts:[["mic", { x:38, y:38, s:.62 }], ["qbubble", { x:63, y:34, s:.7 }]] } },
    { post:"“Spooky VHS night in the lounge. Bring your worst tape.”", name:"Be Kind, Rewind", line:"Brought a tape to VHS night.", match:"House event · Fri 8 PM", r:{ form:["patch", { shape:"rounded", fill:P.plum, stitch:P.lgold }], parts:[["vhs", { s:.8 }], ["pumpkin", { x:76, y:22, s:.35 }]] } },
    { post:"“New menu photos! Pizza is back.”", name:"Skipped", line:"Not an event, so no badge.", match:"Skipped", skip:true, r:{ form:["button", { fill:P.silver }], parts:[["pizza", { s:.8 }]] } },
  ];
  $("[data-batch]").innerHTML = BATCH.map((b) => `<div class="b" style="${b.skip ? "opacity:.5" : ""}"><span class="src" style="font-style:italic">${b.post}</span>${draw(b.r, 88, b.name)}<span class="nm">${b.name}</span><span class="ln">${b.line}</span><span class="rule">${b.match}</span>${b.skip ? "" : `<div style="display:flex;gap:6px;margin-top:6px"><span class="btn red" style="padding:7px 12px;font-size:13px">Approve</span><span class="btn ghost" style="padding:7px 12px;font-size:13px">Edit</span><span class="btn ghost" style="padding:7px 12px;font-size:13px">Skip</span></div>`}</div>`).join("");
  // Tyler's one-of-one
  const tyler = { form:["pin", { fill:P.walnut, edge:P.brass }], parts:[["barstool", { y:50, s:.92 }], ["speech", { y:52 }], ["plate", { t:"TYLER", w:44, y:84 }], ["shine"]] };
  $("[data-tyler]").innerHTML = draw(tyler, 170, "The Usual Spot badge for Tyler");
  // Back office form, preview, where badges show
  $("[data-glyphs]").innerHTML = [["Pin", "Midnight"], ["Patch", "Night Owl"], ["Stub", "Welcome"], ["Coin", "Legend"], ["Pennant", "Trivia Night"], ["Button", "Regular"]].map(([f, n]) => `<span style="display:flex;flex-direction:column;align-items:center;gap:2px;border:2px solid ${n === "Trivia Night" ? "var(--ink)" : "var(--line)"};border-radius:9px;padding:4px 6px;font-size:11px">${badge(n, 34)}${f}</span>`).join("");
  $("[data-preview]").innerHTML = badge("Trivia Night", 150);
  $("[data-tablet]").innerHTML = badge("Midnight", 170);
  const earned = ["Welcome", "Night Owl", "A Season", "Midweek Movies", "Midnight", "Annual", "Regular"];
  $("[data-case]").innerHTML = B.slice(0, 16).map((b) => `<div style="display:flex;justify-content:center;${earned.includes(b.name) ? "" : "opacity:.16;filter:grayscale(1)"}">${draw(b.r, 56, b.name)}</div>`).join("");
  $("[data-count]").innerHTML = `${badge("Midnight", 26)}<strong style="font-family:var(--mono)">23</strong>`;
  // ---------- personal tokens ----------
  const MOTIF = {
    reel: (c) => `<circle cx="50" cy="20" r="7" fill="${c}"/><circle cx="47.5" cy="18" r="1.4" fill="#fff"/><circle cx="52.5" cy="18" r="1.4" fill="#fff"/><circle cx="50" cy="22.5" r="1.4" fill="#fff"/>`,
    star: (c) => `<path d="M50 12 l2.4 5 5.4 .6 -4 3.7 1.1 5.3 -4.9 -2.7 -4.9 2.7 1.1 -5.3 -4 -3.7 5.4 -.6 z" fill="${c}"/>`,
    moon: (c) => `<path d="M53 12 a8 8 0 1 0 5 13 a6.5 6.5 0 0 1 -5 -13 z" fill="${c}"/>`,
    popcorn: (c) => `<path d="M45 18 l2 9 h6 l2 -9 z" fill="${c}"/><circle cx="46" cy="16" r="3" fill="#fff8de"/><circle cx="50" cy="13.5" r="3.4" fill="#fff8de"/><circle cx="54" cy="16" r="3" fill="#fff8de"/>`,
    heart: (c) => `<path d="M50 27 l-7 -7 a4.2 4.2 0 0 1 7 -5 a4.2 4.2 0 0 1 7 5 z" fill="${c}"/>`,
    bolt: (c) => `<path d="M52 11 l-8 10 h5 l-3 8 9 -11 h-5 z" fill="${c}"/>`,
  };
  const PATTERN = [
    (c) => ring(24, 38, 50, 50, (a, x, y) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${c}"/>`),
    (c) => `<circle cx="50" cy="50" r="38" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="6 3"/>`,
    (c) => ring(16, 35, 50, 50, (a) => `<line x1="${(50 + 35 * Math.cos(a)).toFixed(1)}" y1="${(50 + 35 * Math.sin(a)).toFixed(1)}" x2="${(50 + 41 * Math.cos(a)).toFixed(1)}" y2="${(50 + 41 * Math.sin(a)).toFixed(1)}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`),
    (c) => `<circle cx="50" cy="50" r="40" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="50" cy="50" r="35.5" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  ];
  const token = (m, size) => svg(`<circle cx="50" cy="50" r="46" fill="${m.color}"/><circle cx="50" cy="50" r="46" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="2"/>${PATTERN[m.p](m.ink)}<circle cx="50" cy="52" r="24" fill="${m.ink}" opacity=".16"/>${T(m.init, 50, 62, 26, m.ink)}${MOTIF[m.motif](m.ink)}`, size, `${m.name}'s token`);
  const PEOPLE = [
    { name:"Sam O.", init:"SO", color:P.red, ink:P.cream, p:0, motif:"moon" },
    { name:"Jo K.", init:"JK", color:P.teal, ink:P.lgold, p:1, motif:"reel" },
    { name:"Priya D.", init:"PD", color:P.plum, ink:"#f7c6d4", p:2, motif:"star" },
    { name:"Marcus T.", init:"MT", color:P.lgold, ink:P.ink, p:3, motif:"popcorn" },
    { name:"Lena W.", init:"LW", color:P.navy, ink:"#a9d1ff", p:0, motif:"heart" },
    { name:"Dev R.", init:"DR", color:P.green, ink:P.cream, p:2, motif:"bolt" },
  ];
  $("[data-tokens]").innerHTML = PEOPLE.map((m) => `<div class="b">${token(m, 92)}<span class="nm">${m.name}</span><span class="ln">${m.motif} · example</span></div>`).join("");
  $("[data-give]").innerHTML = [["Jo K.", "Fri Oct 2 · Midnight", true], ["Priya D.", "Wed Sep 30 · Midweek Movies", false], ["Marcus T.", "Sat Sep 26", false]].map(([n, w, on]) => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)"><input type="radio" name="give" ${on ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--red)">${token(PEOPLE.find((p) => p.name === n), 34)}<span><strong>${n}</strong><span style="display:block;font-size:12.5px;color:var(--muted)">here with you ${w}</span></span></label>`).join("");
  $("[data-shelf]").innerHTML = [token(PEOPLE[1], 60), badge("Midnight", 60), token(PEOPLE[2], 60), badge("Trivia Night", 60), badge("Horror Month", 60), token(PEOPLE[3], 60), badge("Midweek Movies", 60), token(PEOPLE[5], 60)].map((s) => `<div style="display:flex;justify-content:center">${s}</div>`).join("");
})();
