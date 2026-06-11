# The Bikini Bar — Website

A static, dependency-free website for **The Bikini Bar**, a made-to-order,
mix-and-match swimwear brand. Inspired by the structure of custom-swimwear
sites (homepage hero → builder → inspiration gallery → gift cards → FAQ →
contact), but with entirely original branding, copy, design, and code.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Homepage: hero, how-it-works, house specials, gift cards |
| `builder.html` | Interactive suit builder with live SVG color preview |
| `inspiration.html` | Gallery of named colorway combinations |
| `about.html` | Brand story and values |
| `faq.html` | Sizing, shipping, returns, care |
| `contact.html` | Contact form and details |

Shared assets: `styles.css` (all styling, CSS variables for the palette)
and `builder.js` (builder interactivity).

## Preview locally

No build step required — it's plain HTML/CSS/JS:

```sh
cd the-bikini-bar
python3 -m http.server 8080
# then open http://localhost:8080
```

## Before launch

- Replace the gradient placeholder tiles with real product/lifestyle photos.
- Wire the builder's **Add to Cart** button and the contact form to a real
  backend or e-commerce platform (Shopify, Snipcart, etc.).
- Update the placeholder email, social links, and policy pages.
- Adjust the palette in `styles.css` `:root` variables to match final brand
  colors.
