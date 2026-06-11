# The Bikini Bar — Website

Static, dependency-free website for **The Bikini Bar**, a build-your-own
bikini brand. The visual identity follows the official brand kit:
Scottsdale resort luxury × charm bar — warm cream backgrounds, cactus
green CTAs, metallic gold accents, serif headings, and pill buttons.

**Tagline:** Build Your Bikini · **Secondary:** Mix. Match. Charm. Repeat.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Homepage: hero, how-it-works, collection tiles, Charm Bar, gift cards, events CTA |
| `builder.html` | 5-step builder (Top → Bottom → Size → Charms → Review) with live SVG preview, pricing, and sticky mobile CTA |
| `inspiration.html` | Collection pages: Desert Luxe, Wild Print, Neon Nights, Bridal Pool Party, Scottsdale Edit |
| `events.html` | Events & pop-ups: bachelorette, resort partnerships, Neon Nights |
| `about.html` | Brand story and values |
| `faq.html` | Fit, shipping, returns, charms, care |
| `contact.html` | Contact form and details |

Shared assets: `styles.css` (all brand tokens from the kit live in `:root`)
and `builder.js` (builder interactivity + charm pricing).

## Brand system implementation

- **Colors:** all core and campaign hex values from the brand kit are CSS
  variables (`--color-sand-cream`, `--color-cactus-green`,
  `--color-metallic-gold`, `--color-neon-pink`, etc.) plus functional
  aliases (`--color-background`, `--color-button-primary`, …).
- **Typography:** Playfair Display (headings), Inter (body), Cormorant
  Garamond (accent), loaded from Google Fonts, with the kit's size/spacing
  tokens.
- **Buttons:** `.button-primary` (cactus green), `.button-secondary`
  (outline), `.button-campaign` (neon pink, Neon Nights/limited drops only).
- **Selected states:** gold borders + gold glow per the kit's builder rules.
- **Footer:** deep cactus green with email signup ("Get first access to
  drops, charms, and pop-ups.").

## Preview locally

No build step required — plain HTML/CSS/JS:

```sh
cd the-bikini-bar
python3 -m http.server 8080
# then open http://localhost:8080
```

## Before launch

- Replace gradient placeholder tiles with real photography (flat lays,
  charm close-ups, Scottsdale pool lifestyle — warm tones, no cold blue
  beach imagery).
- Wire **Add Full Build to Cart**, the contact form, and the email signup
  to a real backend or e-commerce platform.
- Swap in the final logo wordmark and TBB monogram favicon.
- Update placeholder email, social links, and policy pages.
