# v0.dev Prompt — Genforge 官网

> 直接复制以下全部内容，粘贴到 v0.dev 输入框

---

```
Build a modern, dark-themed landing page for "Genforge" — an AI-powered content factory platform.

## Brand Identity

**Name**: Genforge
**Tagline**: Forge Your Content Machine
**Sub-tagline**: Turn ideas into infinite, high-performing content — automatically.

## Visual Direction

**Style**: Industrial AI — dark, minimal, high-density like Linear/Vercel, with subtle "forge/flame" accents.

**Color Palette**:
- Background: `#0a0a0f` (deep space black)
- Card/Panel: `#18181b` (dark zinc)
- Primary accent: `#7c2bee` (forge purple)
- Secondary accent: `#f97316` (lava orange — for dynamic/flame elements)
- Text primary: `#f4f4f5`
- Text muted: `#71717a`
- Border: `#27272a`
- Success: `#16a34a`

**Typography**:
- Headings: Nunito (bold, rounded)
- Body: Quicksand (clean geometric)
- Code/data: JetBrains Mono

**Vibe**: Like if Linear and Vercel had a baby, but with industrial forge energy. No gradients on large backgrounds. Sharp contrast, subtle glow on primary elements.

## Page Structure

### 1. Navigation (sticky)
- Left: Genforge logo (flame icon + wordmark)
- Right: Features | Workflow | Pricing | Docs | [Start Forging] (primary button)
- Style: transparent background, blurs on scroll

### 2. Hero Section
- Large heading: "Forge Your Content Machine" (Nunito, bold, ~56px)
- Subheading: "Turn ideas into infinite, high-performing content — automatically." (Quicksand, muted)
- CTA button: "Start Forging" (purple gradient, hover lift + glow)
- Secondary link: "Watch Demo →" (muted)
- Background: subtle radial glow from top-left in purple
- Below CTA: "Trusted by 500+ content teams" + 5 placeholder company logos (grayscale)

### 3. Pipeline Workflow Section
- Section label: "How It Works" (small, uppercase, purple)
- Heading: "From Idea to Viral — Automatically"
- Visual: Horizontal flow diagram showing 5 steps connected by animated arrows:
  `Idea → Generate → Optimize → Publish → Scale`
- Each step is a card with: icon (SVG), step name, one-line description
- Step icons: lightbulb, cpu/AI chip, chart/growth, send/share, rocket
- Active/pulsing glow animation on arrows between steps

### 4. Features Grid
- Section label: "Core Capabilities"
- Heading: "Everything You Need to Scale Content"
- 4-column grid (2 on mobile):
  1. **Automated Creation** — AI writes, adapts, and polishes content across formats
  2. **Batch Production** — Generate 10 / 100 / 1000 pieces in one run
  3. **Multi-Channel Distribution** — Publish to WeChat, Xiaohongshu, Twitter, Blog
  4. **Growth Optimization** — Auto A/B test headlines, track virality signals
- Each card: dark background (#18181b), border (#27272a), purple top-border accent, icon, title, description
- Hover: border brightens to purple, subtle lift

### 5. Stats Banner
- Full-width dark band
- 4 stats in a row: "10M+" Articles Generated | "500+" Teams | "47%" Avg Engagement Lift | "24/7" Always-On
- Large bold number + muted label below

### 6. Use Cases
- Section label: "Built For"
- 4 use case cards with icon + title + description + "Learn more →" link:
  1. 自媒体矩阵运营 (Influencer Matrix)
  2. SEO 内容站点 (SEO Content Sites)
  3. AI 自动化营销 (Automated Marketing)
  4. 出海内容批量生产 (Global Content Production)
- Cards: dark with orange left-border accent

### 7. Pricing
- 3 plans side by side:
  - **Starter**: Free / 100 articles/mo / 1 channel
  - **Pro**: $49/mo / Unlimited articles / 5 channels / API access
  - **Enterprise**: Custom / Unlimited everything / Dedicated support
- "Pro" plan highlighted with purple border + "Most Popular" badge
- CTA per plan: "Get Started" / "Start Free Trial" / "Contact Sales"

### 8. Footer
- 4 columns: Product, Resources, Company, Legal
- Bottom bar: Copyright 2026 Genforge | Privacy | Terms
- Logo + tagline on far left

## Component Details

**Buttons**:
- Primary: bg #7c2bee, white text, rounded-lg, hover: darken + translateY(-1px) + box-shadow glow
- Secondary: transparent, border #27272a, muted text, hover: bg #1c1c1e
- Ghost: no border, muted text, hover: text white

**Cards**:
- bg #18181b, border #27272a, rounded-xl (12px), p-6
- Hover: border #7c2bee40, translateY(-2px), shadow-lg

**Code/Data display**:
- JetBrains Mono, bg #0a0a0f, border #27272a, rounded-lg, p-4

**Animations**:
- Page load: fade-in + slide-up, 400ms ease-out, staggered 80ms between sections
- Hover transitions: 200ms ease-out
- Pipeline arrows: subtle pulse animation (opacity 0.5 → 1, infinite)

## Technical Requirements

- Single page, responsive (mobile-first breakpoints: sm/md/lg/xl)
- Use Tailwind CSS classes
- Use inline SVG for all icons (no emoji, no external icon library imports)
- Smooth scroll between sections
- No JavaScript required except for: mobile nav toggle, smooth scroll, sticky nav blur on scroll

## NOT to include

- No light mode
- No stock photos of people
- No gradient blobs as backgrounds
- No excessive white space
- No Tailwind UI or shadcn/ui components — build from scratch
```
