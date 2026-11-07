# Four Notes site: design record

Sources: the "Four Notes Redesign" canvas (research and Ink and paper system), the `ink-paper`
web and Mac builds, and `joi-design-md.md` as a reference for restraint, not a template.

## Brief

- Subject: Four Notes, a free notes, planner, meetings and money app for Mac and the web.
- Audience: people who keep three apps open to run one day. Many are in Indonesia.
- Job: make them download the Mac app or open the web app.
- Stack: plain HTML, CSS and JS, because the site already is, and it deploys as static files.
  GSAP, ScrollTrigger and Lenis are vendored in `assets/vendor`. No build step.

## Inventory (what only this product has)

Ink frame and paper sheets. One bar (`⌘K`). One row with six marks. Red means today, amber means
important, violet means the assistant suggested it. The pen stroke logo and its spark. The Edge
Dock tab that grows out of the screen edge. "Your words in ink, additions lighter." Rupiah slang
(25rb, 2.5jt, warteg). One JSON file on your Mac.

## Three concepts

| | A. The site is the app | B. One sentence, four notes | C. Four note melody |
|---|---|---|---|
| Territory | formal system | how it works | the name |
| Idea | The page is a paper sheet, and the app appears on it as a framed window | One run on sentence breaks into rows | Each section is a note in a four note phrase |
| Motion verb | settle like paper | lift out | ring |
| Signature | The four marks leave the headline and land as four rows while the sidebar opens | Clauses leave the sentence | Sound on scroll |
| Scores O/F/Fe/P | 5 / 5 / 4 / 1 | 4 / 5 / 5 / 3 | 3 / 2 / 3 / 3 |

Pick A, keep B as its second beat. C has nothing to do with using the app.

## Concept card

```
Idea:        The words live on the page. The app lives in a frame.
Metaphor:    A paper sheet with a framed window of the app resting on it.
Signature:   Four marks (empty, half, full, done) leave the headline and land as four rows
             in a framed window that rises onto the sheet.
Emotion:     A clean sheet, then a small dark window on it.
Motion verb: Settle like paper. Text inks in: pencil grey, blurred, then ink.
Screenshot:  Black frame, cream sheet, huge black headline, four small marks, one red dot.
```

On this page, the app's own row marks become the way into a framed preview of it. Put a competitor
in that sentence and it stops working: nobody else has these marks.

## Why the app is framed

The first build let the app fill the browser, and at that size the page read as the real web app.
So the rule is now: explanation sits on the site's sheet, and the app appears only inside a smaller
window. The window has its own toolbar and omnibar, a pale frame around it, and a line under it
saying it is sample data, with a link to the real app. It is laid out at the app's own size
(1240 by 760, 960 by 680 on tablets) and scaled to fit, never above 100%, so it keeps the app's
proportions and reads as a picture. The plain flow uses the same frame.

A phone cannot do that: the desktop window would shrink to about 30%, and text to 5px. So on phones
the window is laid out at the width it has and shown at 100%, as a framed card. It drops the tab
bar, which only covered rows, and fades where the sheet ends.

The site's bar no longer dresses up as the app's: it says "Search this site", with no scan or mic.

Live thing: the bar works. `⌘K` anywhere, or the bar section, reads "kopi 25rb di Starbucks"
and shows what it would file. The Edge Dock tab on the page really opens, and its tasks tick.

Every claim was checked against the `ink-paper` builds. The canvas's preview-then-file panel and
its duplicate warning are not in the app yet, so the stage shows what the assistant does today:
it files from one sentence, shows what it filed, and offers Undo. Enhance is labelled Mac only.

## What came from Joi, and how it changed

| Joi | Here |
|---|---|
| Black pictograms between headline words | The app's row marks, which then become rows |
| Pure white and pure black | Paper #FBFAF8 inside Ink #111113 |
| Floating capsule nav | A search pill in the site's bar. The app's omnibar stays in the preview |
| Blurred grey words sharpen | Pencil to ink, tied to "your words in ink" |
| Mist panel with a hand and phone | A large iPhone drawn in code on a pale panel, no hand, its screens changing as statements pass |
| Award laurels | A plain line of what is true: no account, offline, macOS 26 |
| Centre axis everywhere | Centre on free bands. Left inside the app, because the app is left aligned |

## System

Colour, from the canvas. Ink #111113, Ink 2 #1F1F22, Ink 3 #2B2B2F, Paper #FBFAF8, Paper 2 #F2F0EC,
Line #E7E4DF, Text #18181A, Text 2 #55555B, Meta #6E6E74, Spark #E53437 (fills only),
Red text #C62B2E, Amber #C77A00, AI #5B3BA6 on #F1ECFB. Colour always keeps its product meaning.

Type. Geist only, as in the app. Five sizes: display, statement, title, body, small.
Weight 640 for display, tracking from -0.045em. Numbers are tabular.

Grid. Site gutter 12, bar 66. Inside the preview: gutter 10, toolbar 52, sidebar 196, side sheet 300 to 320.
Shape. Sheet 20, card 16, row 14, buttons and tags full round.
Motion. `cubic-bezier(0.22, 1, 0.36, 1)`. One clock, gsap.ticker. Sticky stage, scrubbed, not hijacked.

## Narrow screens

Below 1181px there is no room beside the phone, so nothing slides over it. The words and the phone
each keep their own space and stay on screen, and the words change as you scroll. On a phone the
words sit above it. On a tablet held sideways they sit to its left. Without motion they simply stack.

## Rules the house style bends, and why

- No pill nav: the search pill echoes the product's omnibar.
- No violet: used only for "the assistant suggested it", inside product fragments.
- Hero is centred and large rather than the dealt split sentence, because the brief named Joi.
- `data-ui` marks product fragments, which keep the product's borders and radii.
