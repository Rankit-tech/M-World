# M. World

A nostalgic Indian ambient radio website with switchable themes (Salon, Bus Driver, Papa Ke Gaane, Raju Mistri, Rap Session).

## Files

- `index.html`: the whole site (HTML, CSS and JavaScript in one file)
- `backend.js` and `config.js`: public chat, online count and real songs through Supabase (empty config = demo mode)
- `admin.html`: tabbed admin (Dashboard, Upload, Songs with ranking and edit menu, Chat moderation by fixed user ID)
- `supabase/schema.sql`: database, security rules and storage bucket
- `SETUP.md`: step by step backend setup
- `assets/`: theme photos for the top music frame and the support QR code

## Run it

Open `index.html` in a browser, or host the folder on GitHub Pages
(Settings > Pages > Deploy from a branch > `main` / root).

## Notes

- Without a backend the player and chat are demos. Follow `SETUP.md` to turn on real chat and songs.
- Theme photos only show in the top music frame; About and FAQ use plain theme colors.

Run order in Supabase SQL Editor: `schema.sql`, `analytics.sql`, `update-v2.sql`.
