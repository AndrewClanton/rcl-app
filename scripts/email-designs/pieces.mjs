// Every picture in the three invite emails: which part of the canvas
// design it is, what format it ships as, and its alt text. render.mjs takes
// each from the Desktop design (600 wide) and the Phone design (390 wide)
// at 2x. Everything else in the emails (headlines, the key lines, buttons,
// links, the footer) is live text in src/lib/email/designs/.
//
// `rect` and `hide` run in the page (as source text): R.sec(name) is a
// section, R.box(el) its rectangle on the page, R.kids(el, i, j, ...) walks
// down children. `hide` lists elements made invisible for the shot (the
// live text that sits on top of a picture in the email). Pieces marked
// `art` are drawn per person (a first name in the picture): their base is
// bundled with the app and the name goes on at open time
// (src/app/api/email/art).
//
// fmt: "jpg" for photos, "png" for flat drawings (palette PNG).

// Shared by all three (rendered once, from "The new Royale is here").
export const COMMON = [
  {
    name: "header",
    fmt: "png",
    alt: "Royale Cinema Lounge, on Route 66 in Joplin, MO",
    rect: (R) => R.box(R.sec("header")),
  },
  {
    name: "sprockets",
    fmt: "png",
    alt: "",
    rect: (R) => R.box(R.kids(R.sec("footer"), 0)),
  },
  {
    name: "footer-logo",
    fmt: "png",
    alt: "Royale Cinema Lounge",
    rect: (R) => R.box(R.sec("footer").querySelector("img")),
  },
  {
    name: "claim-steps",
    fmt: "png",
    alt: "Three steps: the last 4 of your phone, then a password or Google, and you're in.",
    rect: (R) => R.box(R.kids(R.sec("claim"), 0, 0, 2)),
  },
  {
    name: "claim-30sec",
    fmt: "png",
    alt: "About 30 seconds",
    rect: (R) => {
      const card = R.kids(R.sec("claim"), 0, 0);
      const chips = card.children.length > 4 ? card.children[4] : card.children[3].children[1];
      return R.pad(R.box(chips.children[0]), 2);
    },
  },
];

export const DESIGN_PIECES = {
  "royale-is-here": {
    stem: "RoyaleIsHere",
    pieces: [
      {
        name: "hero",
        fmt: "jpg",
        alt: "The new Royale website, showing the lounge you know: booths, the arcade cabinet and the poster wall in purple and gold neon.",
        rect: (R) => {
          const s = R.sec("hero");
          return { ...R.box(s), h: R.box(R.kids(s, 2, 0)).y - R.box(s).y };
        },
      },
      {
        name: "account-phone",
        fmt: "png",
        alt: "Example account: 18 points, and a ticket that just landed: +8 points.",
        // Phone: the band from the headline down to the points picture, so
        // the dots behind the phone fade out as in the design. Desktop: the
        // phone in its own column (a few pixels wider for the EXAMPLE tag),
        // without the dots and the shadow, which would end in a hard edge there.
        rect: (R, dev) => {
          const s = R.sec("account");
          const a = s.querySelector("a");
          if (dev === "Phone") {
            const p = R.kids(s, 1);
            const h2 = R.box(p.children[1]);
            return R.full(h2.y + h2.h, R.box(p.children[3]).y);
          }
          const b = R.box(a);
          return { x: b.x, y: b.y, w: b.w + 6, h: b.h };
        },
        hide: (R, dev) => (dev === "Phone" ? [] : [R.sec("account").querySelector("a").children[0]]),
        noShadow: (R, dev) => (dev === "Phone" ? [] : [R.sec("account").querySelector("a").children[1]]),
      },
      {
        name: "account-math",
        fmt: "png",
        alt: "$1 earns 1 point. 100 points = $5 off.",
        rect: (R) => R.box([...R.sec("account").querySelectorAll("div")].find((d) => d.style.flexDirection === "column" && d.textContent.includes("100 PTS"))),
        // The dots and shadow behind the example phone reach into this column on desktop.
        hide: (R, dev) => (dev === "Phone" ? [] : [R.sec("account").querySelector("a").children[0]]),
        noShadow: (R, dev) => (dev === "Phone" ? [] : [R.sec("account").querySelector("a").children[1]]),
      },
      {
        name: "account-rewind",
        fmt: "png",
        alt: "Example: the door screen says “Welcome back!” with +96 points from old visits.",
        rect: (R) => {
          const card = [...R.sec("account").querySelectorAll("div")].filter((d) => d.textContent.includes("Welcome back") && d.style.position === "relative").pop();
          return R.box(card);
        },
        // The dots and shadow behind the example phone reach into this column on desktop.
        hide: (R, dev) => (dev === "Phone" ? [] : [R.sec("account").querySelector("a").children[0]]),
        noShadow: (R, dev) => (dev === "Phone" ? [] : [R.sec("account").querySelector("a").children[1]]),
      },
      {
        name: "door",
        fmt: "png",
        art: "door",
        alt: "The door tablet cheering a first check-in, and +55 points for a first visit, past halfway to $5 off.",
        rect: (R) => {
          // From under the headline: the tablet's shadow reaches up into the gap.
          const p = R.kids(R.sec("door"), 0);
          const h2 = R.box(p.children[1]);
          const medals = p.children[p.children.length - 1];
          return R.full(h2.y + h2.h, R.box(medals).y);
        },
      },
      {
        name: "door-badges",
        fmt: "png",
        alt: "Badges and their points: your 1st visit +50, birthday +50, 10th visit +25, 50th +100, 100th +250, and 6 more.",
        rect: (R) => {
          const s = R.sec("door");
          const p = R.kids(s, 0);
          const medals = p.children[p.children.length - 1];
          const b = R.box(s);
          return R.full(R.box(medals).y, b.y + b.h);
        },
      },
      {
        name: "road-pair",
        fmt: "jpg",
        only: "Desktop",
        alt: "Free popcorn and free pizza",
        rect: (R) => R.pad(R.box(R.kids(R.sec("road"), 0, 1, 1)), 2),
      },
      {
        name: "road",
        fmt: "png",
        alt: "The streak road: 4 weeks in a row, +25 points. 13 weeks, free popcorn. 26 weeks, free pizza. 52 weeks, +500 points.",
        rect: (R) => {
          const s = R.sec("road");
          const panel = s.querySelector('[role="img"]');
          const b = R.box(s);
          return R.full(R.box(panel).y, b.y + b.h);
        },
      },
      {
        name: "profile",
        fmt: "png",
        art: "profile",
        alt: "The door screen in pink with pink confetti, checking you in. Pick from 10 colors and an entrance: Confetti, Unicorn run, Fireworks or Reactions.",
        altPhone: "The door screen in pink with pink confetti, checking you in.",
        rect: (R) => {
          const p = R.kids(R.sec("profile"), 0);
          const h2 = R.box(p.children[1]);
          return R.full(h2.y + h2.h, R.box(p.children[3]).y);
        },
      },
      {
        name: "profile-rest",
        fmt: "png",
        alt: "An example profile card: your color, your badges and your own page at royalecinemajoplin.com/m/your-name.",
        altPhone: "Pick from 10 colors and an entrance: Confetti, Unicorn run, Fireworks or Reactions. An example profile card: your color, your badges and your own page.",
        rect: (R) => {
          const s = R.sec("profile");
          const p = R.kids(s, 0);
          const b = R.box(s);
          return R.full(R.box(p.children[3]).y, b.y + b.h);
        },
      },
      {
        name: "online-tickets",
        fmt: "jpg",
        alt: "A couple in the Indoor Cinema, the big screen glowing behind them.",
        rect: (R) => R.box(R.kids(R.sec("online"), 0, 1, 0, 0)),
      },
      {
        name: "online-booths",
        fmt: "jpg",
        alt: "The lounge booths under the poster wall.",
        rect: (R) => R.box(R.kids(R.sec("online"), 0, 1, 1, 0)),
      },
      {
        name: "whatsnew-stops",
        fmt: "png",
        alt: "What's new: suggest, vote, build, ship.",
        rect: (R) => R.box(R.kids(R.sec("online"), 0, 2, 0, 1)),
      },
      {
        name: "coming-soon",
        fmt: "png",
        alt: "Coming soon",
        rect: (R) => R.pad(R.box(R.kids(R.sec("online"), 0, 2, 0, 2, 0, 0)), 4),
      },
      {
        name: "filmstrip",
        fmt: "jpg",
        alt: "The Royale: cocktails, the VHS lounge, popcorn and the neon lounge.",
        altPhone: "The Royale: cocktails, the VHS lounge and popcorn.",
        rect: (R) => R.box(R.kids(R.sec("close"), 0, 0)),
      },
    ],
  },
  "come-in": {
    stem: "ComeIn",
    pieces: [
      {
        name: "hero",
        fmt: "jpg",
        alt: "Two people in the Royale's red seats, sharing a drink, popcorn in hand.",
        rect: (R) => R.box(R.kids(R.sec("hero"), 0)),
      },
      {
        name: "plus-math",
        fmt: "png",
        alt: "Four movies a month: pay as you go, $8 each, $32. Insiders+: all four free, $15.",
        rect: (R) => R.box(R.sec("insiders").querySelector('[role="img"]')),
      },
      {
        name: "plus-perks",
        fmt: "png",
        alt: "Insiders+ also gets you 10% off at the register, 2 free booths a month, and a free black coffee or hot tea every day.",
        rect: (R) => {
          const p = R.kids(R.sec("insiders"), 1);
          const a = R.box(p.children[3]);
          const c = R.box(p.children[4]);
          return { x: a.x, y: a.y, w: a.w, h: c.y + c.h - a.y };
        },
      },
      {
        name: "bar-grid",
        fmt: "jpg",
        alt: "$5 popcorn and a soda, $8 to $10 cocktails, a $4 slice of pizza and a $5 hot dog.",
        rect: (R) => R.box(R.kids(R.sec("bar"), 0, 2, 0)),
      },
      {
        name: "marquee",
        fmt: "png",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("bar"), 0, 3, 0)),
        // The bulb frame and the ink panel only: the letterboard is live text.
        hide: (R) => [...R.kids(R.sec("bar"), 0, 3, 0, 0).children],
      },
      {
        name: "stub",
        fmt: "png",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("bring"), 1, 1, 0)),
        // The ticket shape only: ADMIT, the name and PLUS ONE are live text.
        hide: (R) => {
          const grid = R.kids(R.sec("bring"), 1, 1, 0, 0);
          return [...grid.children[0].children, ...grid.children[1].children];
        },
      },
      {
        name: "room",
        fmt: "png",
        alt: "The Indoor Cinema from the back: a glowing screen and small groups of friends sitting together.",
        rect: (R) => R.box(R.sec("bring").querySelector('[role="img"]')),
      },
      {
        name: "booth-photo",
        fmt: "jpg",
        alt: "The lounge booths under the poster wall.",
        rect: (R) => R.box(R.kids(R.sec("bring"), 1, 4, 0, 0)),
      },
      {
        name: "handset",
        fmt: "png",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("bring"), 1, 4, 1, 0)),
      },
    ],
  },
  "press-play": {
    stem: "PressPlay",
    pieces: [
      {
        name: "tape",
        fmt: "jpg",
        art: "tape",
        alt: "An old TV paused, and a VHS tape labeled Unlimited, with your name.",
        rect: (R) => {
          const s = R.sec("hero");
          return { ...R.box(s), h: R.box(R.kids(s, 2, 0)).y - R.box(s).y };
        },
      },
      {
        name: "counter",
        fmt: "png",
        alt: "Nothing owed for the months before. $15 plus tax today, then $15 a month.",
        rect: (R) => R.box(R.sec("play").querySelector('[role="img"]')),
      },
      {
        name: "icon-lock",
        fmt: "png",
        only: "Desktop",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("play"), 0, 4, 0, 0, 0)),
      },
      {
        name: "icon-check",
        fmt: "png",
        only: "Desktop",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("play"), 0, 4, 0, 1, 0)),
      },
      {
        name: "ways-online",
        fmt: "png",
        alt: "A phone with a red play button and a lock.",
        rect: (R) => R.box(R.kids(R.sec("ways"), 0, 1, 0, 0)),
      },
      {
        name: "ways-register",
        fmt: "png",
        alt: "A card tapped on the register's card reader, which shows $15.",
        rect: (R) => R.box(R.kids(R.sec("ways"), 0, 1, 1, 0)),
      },
      {
        name: "perks",
        fmt: "png",
        alt: "Insiders+: unlimited free movies, 10% off at the register, 2 free booths a month, and a free black coffee or hot tea every day.",
        rect: (R) => {
          const p = R.kids(R.sec("perks"), 0);
          const a = R.box(p.children[2]);
          const c = R.box(p.children[4]);
          return { x: a.x, y: a.y, w: a.w, h: c.y + c.h - a.y };
        },
      },
      {
        name: "extras",
        fmt: "png",
        alt: "Also on the new site: points, badges, your color, your page, booking booths and buying tickets.",
        rect: (R) => R.box(R.kids(R.sec("extras"), 1, 1, 0)),
      },
      {
        name: "icon-tapcard",
        fmt: "png",
        only: "Desktop",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("close"), 0, 3, 0, 0)),
      },
      {
        name: "icon-phone",
        fmt: "png",
        only: "Desktop",
        alt: "",
        rect: (R) => R.box(R.kids(R.sec("close"), 0, 3, 1, 0)),
      },
    ],
  },
};

// The per-person pictures: what to hide in the base (the words the name is
// in) and where the words go, measured from the design. Coordinates are CSS
// pixels from the piece's top left.
export const ART = {
  door: {
    design: "royale-is-here",
    sec: "door",
    measure: (R, crop) => {
      const screen = [...R.sec("door").querySelectorAll("div")].find((d) => d.style.borderRadius === "10px" && d.style.overflow === "hidden");
      const [, star, text] = screen.children;
      const b = R.box(screen);
      const cs = getComputedStyle(text);
      return {
        kind: "tablet",
        screen: { x: b.x - crop.x, y: b.y - crop.y, w: b.w, h: b.h },
        pad: 12,
        icon: star.innerHTML,
        iconSize: 24,
        gap1: 8,
        font: { size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), color: "#f3ecd9" },
        gap2: 10,
        bar: { w: 60, h: 4, color: "#ffc72c" },
        lines: ["{name}, your first", "check-in!"],
        none: ["Your first", "check-in!"],
      };
    },
    hide: (R) => {
      const screen = [...R.sec("door").querySelectorAll("div")].find((d) => d.style.borderRadius === "10px" && d.style.overflow === "hidden");
      return [...screen.children].slice(1);
    },
  },
  profile: {
    design: "royale-is-here",
    sec: "profile",
    measure: (R, crop) => {
      const screen = [...R.sec("profile").querySelectorAll("div")].find((d) => d.style.borderRadius === "10px" && d.style.overflow === "hidden");
      const [, icon, text] = screen.children;
      const b = R.box(screen);
      const cs = getComputedStyle(text);
      return {
        kind: "tablet",
        screen: { x: b.x - crop.x, y: b.y - crop.y, w: b.w, h: b.h },
        pad: 12,
        icon: icon.innerHTML,
        iconSize: 26,
        gap1: 8,
        font: { size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), color: "#f3ecd9" },
        gap2: 10,
        bar: { w: 60, h: 4, color: "#ff6fb5" },
        lines: ["{name}, you're", "checked in"],
        none: ["You're", "checked in"],
      };
    },
    hide: (R) => {
      const screen = [...R.sec("profile").querySelectorAll("div")].find((d) => d.style.borderRadius === "10px" && d.style.overflow === "hidden");
      return [...screen.children].slice(1);
    },
  },
  tape: {
    design: "press-play",
    sec: "hero",
    measure: (R, crop) => {
      const art = R.sec("hero").querySelector('[role="img"]');
      const tape = art.children[1];
      const label = tape.children[0];
      const name = label.children[1];
      const a = R.box(art);
      const angle = Number((tape.style.transform.match(/rotate\((-?[\d.]+)deg\)/) ?? [0, 0])[1]);
      const cs = getComputedStyle(name);
      const lcs = getComputedStyle(label);
      return {
        kind: "tape",
        tape: { x: a.x - crop.x + tape.offsetLeft, y: a.y - crop.y + tape.offsetTop, w: tape.offsetWidth, h: tape.offsetHeight },
        angle,
        text: {
          x: tape.clientLeft + label.offsetLeft + name.offsetLeft,
          y: tape.clientTop + label.offsetTop + name.offsetTop,
          w: label.clientWidth - parseFloat(lcs.paddingLeft) - parseFloat(lcs.paddingRight),
        },
        font: { size: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight), color: "#14110c" },
      };
    },
    hide: (R) => [R.sec("hero").querySelector('[role="img"]').children[1].children[0].children[1]],
  },
};
