# Demo video script (30 seconds or less)

> Written for the first static prototype (a React site whose engine lived in `web/src/core`). The method and
> the numbers still hold; the engine now lives in `api/app/logic`, the data in `data/` and the tests in
> `api/tests`. Paths under `web/` no longer exist in this repository.

Rules from the Project Submission Guide: **30 s maximum** (longer disqualifies), public link with no login,
English audio or **English subtitles**, no people under 18 on screen, no NASA logos in generated content,
AI-generated images or video need a visible watermark (none are used here). Host it on YouTube or similar
and test the link in a private window.

Structure the guide suggests, with our content. Time-code is the *start* of each beat.

| Time | Say (English) | Show on screen |
| --- | --- | --- |
| 0:00 | "I'm **[name]**, team **[team name]**." | Title card: project name, team name, member names. |
| 0:02 | "The challenge: choose where and when to land on the Moon." | The Moon's south pole, the `Explore` page loaded on Mons Malapert. |
| 0:05 | "**Lunar Landing Site Navigator**: compare sites and dates by sunlight and a line to Earth." | Logo/title over the app. |
| 0:10 | "Built on NASA's LOLA terrain and JPL ephemerides, it shows the Sun and Earth over the *real* horizon, validated to thousandths of a degree." | Close-up view: the Sun's disc half hidden behind the terrain. Cut to the timeline strips. |
| 0:17 | "Launch slipped? Every site, every landing day, in one view." | Date planner heat map; press an arrow key and the selected cell moves; open it. |
| 0:23 | "Free, accessible, and it runs in your browser." | Compare view with three scenarios ranked; end on the live URL. |
| 0:27 | "Plan the next landing. Teach why the Moon is hard." | Final card: URL and QR code. |

Recording notes

- Record at 1080p, browser zoom 110-125 % so text stays readable at video size. Dark theme.
- Use a saved URL for each shot so it is repeatable: `…/#/explore?s=mons-malapert,20270115T0000,7,2`, then the
  planner view, then `#/compare?...` with the scenarios you want (copy them from *Copy link to this scenario*).
- Do not show any personal data (browser bookmarks, tabs, notifications).
- Add **burned-in English subtitles** even if you speak English (accessibility).
- Music: only if you own the rights or it is royalty-free and listed in the References field.
- Keep the final cut to **≤ 30.0 s**; check the file length, not just the timeline.

Fallback if video is not possible: a 7-slide deck (including the title slide), slides: 1 title and team, 2 challenge,
3 solution and screenshot, 4 how it works (NASA data), 5 validation numbers, 6 impact and users, 7 future and link.
