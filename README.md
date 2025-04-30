# redditp

A full screen reddit presentation or slide show.

http://redditp.com

## Hotkeys

- a - toggles auto-next (play/pause)
- t - collapse/uncollapse title
- c - collapse/uncollapse controls
- i - open image in a new tab
- r - open comments in a new tab
- u - open user slideshow in new tab
- f - toggle full screen mode
- m - toggle sound
- g - skip gallery
- Arrow keys, pgup/pgdown, spacebar change slides
- Swipe gestures on phones

## Features

- All /r/ subreddits, including different ?sort stuff.
- /user/ , /domain/ , /me/ url's work.
- Url's ending with ['.jpg', '.jpeg', '.gif', '.bmp', '.png']
- You can save the html file locally and use it, just make sure you add a
  separator e.g. the question mark in file:///c/myredditp.html?/r/gifs so the
  browser knows to pick up the right file and go to the right subreddit.
- Support for /r/random and /r/randnsfw virtual subreddits. These'll be tricky
  unless I cheat as they contain redirects.

Possible future features, depending on feedback:

- Zoom/Pan for comics
- Imgur albums support
- Offline access support, though I don't know if this is even possible actually
  (caching external image resources).
- Login and upvoting support

## Host your own redditp

Redditp relies on the `/r/subreddit` in the URL to fetch the JSON from the
corresponding reddit endpoint. There are a few ways you can set up support for
these URLs yourself:

- You can use an Apache server with the `.htaccess` file.
- Netlify removed redditp without warning. So now we're moving the hosting to
  Vercel, Cloudflare, or GitHub pages. Not sure.
- Use NodeJS (see `package.json`).
- Use a simple HTTP server and put the subreddit URL in the get parameters like
  `http://localhost?/r/subreddit`.
- Use GitHub pages by copying `index.html` into `404.html` which will make all
  unknown URLs reach the same `index.html`. This currently only works with a
  custom domain because of where the `.js` and `.css` files are located.

## Credits

- Ubershmekel http://yuvalg.com/
- [js-cookie](https://github.com/js-cookie/js-cookie) for managing cookies
- Favicon by Double-J designs
  http://www.iconfinder.com/icondetails/68600/64/_icon
- Slideshow based on http://demo.marcofolio.net/fullscreen_image_slider/
- Author of slideshow base: Marco Kuiper (http://www.marcofolio.net/)
- And many more that have contributed to this project through feedback and pull
  requests https://github.com/ubershmekel/redditp/graphs/contributors
