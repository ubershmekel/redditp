# The history of redditp

The whole idea was: put a `p` before the `.com` in a reddit URL and the page
becomes a full screen, hands-free slide show. Pretty simple.

Somehow that turned into fourteen years of fixing browser quirks, dead image
hosts, video codecs, hosting providers, and eventually a reddit API that stopped
letting me in. This is the story the commit log tells, through August, 2026.

## By the numbers

- **374 commits** between July 4, 2012 and August 11, 2026
- **332 real commits** and **42 merges** of other people's pull requests
- **250 of those commits are mine**
- **37 different author names** in the log
- **25 commits on launch day**, and **64 in 2012**
- **281 stars, 116 forks, 63 open issues** as of this writing

## What all those commits actually did

The AI sorted commits into buckets. It's a judgment call made in hindsight, not
a scientific label — a broken video player goes under media compatibility, not
bug fixes, so the numbers add to 374 and not more.

| Category                       | Commits | Share | Translation                                                      |
| ------------------------------ | ------: | ----: | ---------------------------------------------------------------- |
| Hosting, routing, APIs, ops    |      74 | 19.8% | htaccess, SPA rewrites, HTTPS, JSONP, CNAMEs, moving hosts again |
| Media and source compatibility |      65 | 17.4% | Imgur, Gfycat, Redgifs, v.redd.it, galleries, audio, autoplay    |
| UI, navigation, interaction    |      62 | 16.6% | Buttons, hotkeys, fullscreen, mobile, shuffle, history, toasts   |
| Merges                         |      42 | 11.2% | Other people fixing my site for me                               |
| Tests, refactors, code quality |      41 | 11.0% | Namespacing, linting, prettier, Playwright, untangling script.js |
| Docs and project admin         |      32 |  8.6% | README, TODOs, credits, license, links                           |
| General bug fixes              |      30 |  8.0% | Breakage that wasn't any one host's or browser's fault           |
| Archive and extension          |      14 |  3.7% | Static snapshots, the Chrome extension, presentation mode        |
| Other features                 |      14 |  3.7% | New URL shapes, new page types, the original foundations         |

Almost 40% of the work was hosting plus media compatibility. redditp barely grew
as a product. What it did was survive — recognizing whatever shape an image or
video link took that year, and keeping a handful of controls working on whatever
browsers people showed up with.

## Timeline

| Year | Commits | Year | Commits |    Year | Commits |
| ---: | ------: | ---: | ------: | ------: | ------: |
| 2012 |      64 | 2017 |      35 |    2022 |       5 |
| 2013 |      24 | 2018 |       7 |    2023 |      12 |
| 2014 |      14 | 2019 |      19 |    2024 |      25 |
| 2015 |      23 | 2020 |      60 |    2025 |      21 |
| 2016 |      19 | 2021 |       8 | 2026-08 |      38 |

### 2012: bought, built, and launched in one night

I bought `redditp.com` on Wednesday, July 4, 2012 at 2:03 AM. The first commit
landed at 3:16 AM. Twenty-five commits later it was a website.

Reading launch day back is like reading a diary written by someone with no
impulse control. "First commit". "Redundant files". "Might fix the get vars".
"Forgot one attribute, whoops." "Quick hotfix for main page." Next/prev buttons,
tooltips, multi-subreddit support, alignment, an auto-next hotkey — all in a
single day.

The
[launch post](https://uberpython.wordpress.com/2012/07/04/redditp-a-fullscreen-presentation-with-reddit/)
explained why: I liked showing friends cool stuff on the internet, but browsing
is a real conversation killer. You can't lean back, talk, and have fun with
people while operating a website. I wanted a hands-free reddit mode.

I was honest about the state of it — the design was "dead ugly but functional" —
and honest about the implementation, which was worse. To decide whether a link
was an image, it checked whether the fourth character from the right was a
period. That's it. That was the media detection engine. It worked because in
2012 basically everything was an Imgur link. Comics weren't supported.

The post ends with the traffic graph and the only launch metric that mattered:
"I guess not too surprisingly the first 200 visits where mostly to gonewild. You
internet you…."

#### Out-sourced Quality Assurance

I posted it to
[r/somethingimade](https://www.reddit.com/r/somethingimade/comments/w10tt/i_made_a_fullscreen_reddit_slide_show_just_add_a/)
at 11:58 UTC. It hit 362 points and 72 comments. Blatant self-promotion, sorry.
It was also a bug tracker of sorts. You can watch it work by reading the thread
next to the commit log:

| Someone said                                                                      | I committed                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| u/Irongrip: "It doesn't like combined reddits."                                   | 17:29 `Fix for multiple reddits` — "Fixed it, nice catch!"                                                       |
| u/Cast_Iron_Skillet: the navbox moves, so you can't just click next, next, next   | 19:01 `Now no matter what the navboxes do, the picture stays still.` then 21:02 `Navbox on bottom, title on top` |
| u/LaserPope and u/Peanut2232: manually skipping doesn't reset the auto-next timer | next morning, `Clear the auto-next timer whenever a slide is changed.`                                           |
| u/MrFurious0: `/user/` pages show the wrong thing entirely                        | `Allow /user/ links and better image filetype management.`                                                       |

My reply to the timer bug was "Caught me. Indeed I was lazy on that one." My
reply to MrFurious0 started with "Welp, /user/ doesn't really work at all right
now" and ended with an edit saying I'd fixed it. That's the rhythm of that whole
week.

Other things people said, which I'm including because they're the actual
historical record and not the flattering parts only: u/anorexia_is_PHAT's "to
redditp.com/r/gonewild we go!" was the fourth comment and the highest-voted
reaction in the thread. u/20c8e4399c: "The main use of this is going to be for
gonewild and everyone knows it." u/CaffeinatedGuy bookmarked a forty-subreddit
multireddit and thanked me sincerely for it.

Someone told me the UI needed work and I asked what they meant, admitting "I'm
not completely clueless in design, though it does take me more time than I'd
like to admit. So I half-assed it I guess."

A few more posts with 5 upvotes or less later with feedback from various
redditors, then August 5 in r/nsfw: 528 points, and about 50,000 unique visitors
and 65,000 pageviews overnight.

The same weekend gave me a lesson in shipping. Someone wanted to drag images to
their desktop, so I added an invisible `<img>` overlay for right-click and drag
— a hack I admitted "really isn't the correct solution," and which broke in
Gmail because the transparency came along for the ride. Hours later
u/paranoidbillionaire reported "This is absolute hell with HoverZoom." Same day:
`Removed the img node as it was causing bugs for HoverZoom extension and it wasn't that useful anyway.`
Added and deleted inside 48 hours.

The most honest commit of 2012 is from July 5:
`That "/" broke the entire site :(`

### 2013–2015: from party trick to actual viewer

The next three years were about widening what counted as a slideshow: search,
multireddits, `/domain/` and `/user/` URLs, extensionless Imgur links, albums,
GIFV, Gfycat. Fullscreen arrived. iOS became a thing I had to care about.

And other people started sending patches. "Gfycat works and a strange form of
albums. Thanks smielke."

### 2016–2018: the target becomes video

Reddit stopped being images and started being video, and so did the commit log.
Preloading, autoplay recovery, mixed content, blank gifs on Chrome mobile,
Firefox returning `undefined` instead of a play promise, mobile Safari, and
Gfycat changing their API roughly whenever I got comfortable.

Highlights include "Fix that f---ing 'data.gfyItem is undefined' error",
"[unsafe] Temporary fix while Gfycat cajax is down" (reverted the same day), and
the one where I learn something in public: "the poster attribute on video tags
should be a url to the poster image. I did not know that."

I added error toasts and error reporting around here, because by then most
failures weren't my bugs. They were browser policy and other people's servers.

### 2019–2020: reddit video, sound, galleries, and a second wind

2020 was the second busiest year at 60 commits, and the most collaborative.
`v.redd.it` support, audio/video sync solved with no external libraries,
Redgifs, reddit galleries, shuffle, user slideshows, more hotkeys,
random-subreddit workarounds, crossposts. A lot of it arrived as pull requests
and I spent my time fitting them into a codebase that was already eight years
old.

This is also when I started pulling data handling out of `script.js` and into
`EmbedIt.js`, with the stated goal of being able to test any of it. "Seems to
work for now" is how I signed off on that one.

### 2021–2025: keeping the lights on

Increasingly defensive years. Redgifs changed their API, which I patched with an
iframe that fixed playback and broke auto-next — a stop-gap I described as such
at the time, and which then sat there for years.

And the hosting. Netlify removed redditp without warning, so I bounced between
GitHub Pages, Cloudflare, and Vercel, leaving a trail of `Create CNAME` /
`Delete CNAME` / `Update CNAME` behind me. The 2025 log is an incident report
written in real time: "Try to please cloudflare's build and deploy", "Maybe we
also need to delete `_redirects` to appease cloudflare's SPA behavior", "Woops,
I only modifed the redirects file", "Fix didn't work, maybe no asterisk will
work", "Let's try vercel.json instead". All of that just to make `/r/gifs` and
`/search` load.

### 2026: the lockout

The year started well. Thanks to Claude and Codex I could do more with less
effort. I wrote a browser-compatibility contract, added Playwright tests, ran
prettier over everything, and finally drew a real line: "From now on `script.js`
should not know anything about things that are specific to gfycat, imgur, etc".
Galleries, navigation, NSFW and sound got test coverage. Fourteen years in, the
codebase was the nicest it had ever been.

Then in May, [issue #194](https://github.com/ubershmekel/redditp/issues/194):
"Ajax failed." Reddit had started blocking anonymous access to the old JSON
endpoint. In June I shipped
[`240cce1`](https://github.com/ubershmekel/redditp/commit/240cce1fa7507676778795efa21feedd7a547103),
a proxy on `api.redditp.com` that used redditp's own approved API credentials
when the public request failed.

That bought about two months. On July 28,
[issue #201](https://github.com/ubershmekel/redditp/issues/201) opened with a
screenshot and no text — the error was the whole message. Reports piled in from
macOS, Windows, iPad, Chrome, Firefox, Safari. I couldn't reproduce it at first
("Is it fixed now or still broken? Seems to be working for me now"), because I
was logged into reddit. odaiwai found the tell: it broke in private browsing.

Once I looked properly, both doors were shut at once:

> Also this https://old.reddit.com/.json doesn't work when I'm in incognito
> mode. It says: "You've been blocked by network security." ... Also
> https://api.redditp.com/.json is getting:
> `{"error":"Could not obtain Reddit OAuth token"}` So that's another new block
> from Reddit too.

The proxy credentials were gone. No notification, no email — the app just wasn't
in my dashboard anymore. I applied for access again under the new Responsible
Builder Policy and got back one sentence:

> We cannot grant approval because the submission is not in compliance with
> Reddit's Responsible Builder Policy.

The policy is aimed at moderation tools and apps that live inside reddit.
redditp is neither. As I put it in the thread: "reddit seem to be implying they
don't want redditp to exist."

requinix wrote a summary of the situation:

> redditp is basically the only gallery viewer there is, and gallery views are
> wonderful for image-heavy subs. ... I, for one, would miss having redditp very
> much, but I get that fighting Reddit every month is a pain.

### What I did about it

I stopped trying to keep the original architecture alive and started making it
not-broken:

- **An archive.** A Chrome extension snapshots popular subreddits to JSON, and
  the site falls back to that bucket when the live fetch fails. Visit `/r/gifs`
  logged out and you get the archive instead of a black rectangle. It is not
  live reddit. It's a museum, and I'd rather have a museum than a 404.
- **The proxy, removed.** No point keeping a broken endpoint.
- **[A Chrome extension](https://github.com/ubershmekel/redditp)** that runs
  presentation mode on reddit's own pages, using _your_ logged-in session
  instead of one central credential I'm not allowed to have. Add `?redditp=1` to
  a URL and it auto-activates. It went from "v0" to auto-loading more posts,
  adaptive video handling, packaging and tests in about four days. We'll see
  when that gets approved to the chrome extension store.

But, redditp has roughly 7 mobile users for every 5 desktop users, and a desktop
browser extension does nothing for the majority of them. I asked in the thread
for ideas and I still don't have a good answer.

## Credits

I wrote 250 of the commits. The other 82 came from other people, and the list is
long:

- **felixs-alt** (16) — galleries, crossposts, gallery counts and colors
- **Marek Sebera** (12)
- **Artyom Silivonchik** (8) — the v.redd.it audio/video sync, done with no
  external libraries
- **Nathaniel Clark** (6)
- **Omegazette** (3), and two commits each from smielke, ikkebr, frznvm0,
  Ricardo Gonçalves, Lauri Härsilä, JohnnyDarks, Jeffrey Jose, Henrique Pereira,
  and github-throwaway
- One commit each from nielsz, j0shua, half cambodian hacker man, estrohm,
  Stefano Amorelli, Samuel Littley, Nathan, Marcus Cobden, Kyle Copperfield,
  Kevin Butler, Josh Vanderwillik, Jacek Wielemborek, Isaac Viel, GoodOlClint,
  Ean McLaughlin, Chamath Wijesekera, Aniket Schneider, Andrew Tipton, Amos
  Wong, and Alan Smith

Plus everyone who filed one of the 200+ issues. A lot of the commit history is
just me responding to someone saying "it's broken on my phone."

And the 2012 crowd, who never touched the repo but shaped the site anyway:
Irongrip, Cast_Iron_Skillet, LaserPope, Peanut2232, MrFurious0, sinceremonkey,
ruzmutuz, paranoidbillionaire, Airazz. Meaningful parts of redditp were their
ideas.

## A closing note

That's the whole thing in miniature. The site is winding down because the open,
anonymous, client-side access that made something like redditp possible has been
deliberately closed off. I don't think I was owed it. I do think something got
worse, and not only for me — the r/somethingimade thread is a public record of a
dozen strangers improving someone's website in an afternoon, and that kind of
thing needs an open door to happen at all.

Fourteen years, 374 commits, one small interface bent repeatedly around a very
large platform. The archive keeps a piece of it visible and the extension moves
the idea somewhere harder to revoke.

Cheers, and thanks, y'all,

Yuval Greenfield (ubershmekel)
