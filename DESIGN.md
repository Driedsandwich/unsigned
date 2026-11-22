# Unsigned — design spec (chosen mock: A3 "rewrite grows under what you type" + timeline band)

## Colors
- Background #F4F6F4 · surfaces and inputs #FFFFFF · body and headings #172C2A · secondary text #526560
- Primary action and selection #236C60 · AI processing and selection tint #E4F1EB · borders #CBD8D2

## Type
- Inter (fallback ui-sans-serif, system-ui, sans-serif). Body 400 · labels and controls 600 · headings 700. Numbers tabular-nums.
- Mobile: display 26/32 · section 20/26 · question 18/25 · body and input 16/22 · label 13/18 · primary button 16/22.
- Desktop: 32/40 · 24/32 · 20/28 · 18/26 · 14/20 · 18/24.

## Layout
- Mobile: one column, 16px side gutters.
- Desktop: 32px side gutters, 12 columns, 24px gutters. Left 8 columns = the two stacked editors (Your words / Live neutral draft); right 4 columns = the timeline band.
- Admin: theme map on the upper ~2/3, a wide "Draft next week's question" tray below.
- Base unit 4px; spacing 8/16/24/32; card radius 12px; input radius 8px; 1px borders; touch targets at least 44px high.
- Narrow screens or zoomed views switch the theme map to an ordered list.

## Components
- "Your words · Private · Never leaves this device" input.
- "On-device AI" activity marker between the two editors.
- "Live neutral draft" that grows as you type (versioned; stale answers are dropped); Edit draft; regenerate only on request.
- Timeline band: Typed here · Private → Rewritten here · On device → Approved rewrite only · Sends.
- "I approve this version" (unchecked by default, cleared when either text changes) → Send approved response.
- Admin theme islands: summary, Strength, Respondent band (3–5 / 6–8 / 9+); dotted links mean related topics, not people.
- Banner: "Raw responses are never stored / Cloud AI receives approved rewrites only." Permanent note: "Below 3 people: hidden".
- Every AI result shows where it ran (on device / in cloud).
