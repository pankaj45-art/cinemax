# Put CINEMAX online and use it on your phone

Upload the **`deploy/`** folder (not the whole zip) to any static host. All of these give you HTTPS, which browsers require for tab capture and the microphone:

- **Netlify:** app.netlify.com/drop, drag the `deploy` folder in. You get a link immediately.
- **Cloudflare Pages:** Workers & Pages > Create > Pages > Upload assets > pick the `deploy` folder.
- **GitHub Pages:** put the contents of `deploy` in a repo, Settings > Pages > deploy from branch.
- **Vercel:** `vercel deploy` from inside the `deploy` folder (framework: Other).

Open the link on your phone, then use the browser menu > **Add to Home screen** to install it like an app.

## What works where
| | Desktop Chrome/Edge | Phone browser |
|---|---|---|
| Movie / video file (picture + theatre sound) | yes | yes |
| My own file (songs) | yes | yes |
| Demo scene | yes | yes |
| Browser **tab** audio (YouTube, Spotify web, any tab) | yes | **no** - phone browsers cannot capture another tab's sound; this is a browser restriction, not something an app can change |
| Microphone | yes | yes (use headphones) |

On a phone, play the movie or song **inside CINEMAX** with the Movie / video file or My own file source. For a streaming site, use CINEMAX on a computer: open the site in one tab, then in CINEMAX choose Browser tab audio > Connect > pick that tab > tick "Share tab audio".

## Phone tips
- iPhone: turn the ringer/silent switch off or web audio stays muted. Screen lock may pause playback.
- Bluetooth headphones add delay, so picture and sound can drift; wired is best for movies.
- Protected streaming (Netflix and similar) is silent when captured. Use your own files.
- Large movies stream from the file; formats are whatever your browser plays (MP4/H.264 and WebM are the safest).
