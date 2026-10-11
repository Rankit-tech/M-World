# Backend setup (Supabase, free plan)

Ye backend teen kaam karta hai: **public live chat**, **asli online count** aur **gaane ki library** (admin page se upload).
Sab kuch ek hi jagah (Supabase) par hota hai, aur shuru mein free hai.

## Step 1: Supabase project banao
1. https://supabase.com par sign up karo (GitHub se login chalega).
2. "New project" dabao. Naam `m-world`, ek strong database password rakho (kahin likh lo) aur region India ke paas wala (jaise Mumbai) chuno.
3. Project ban'ne mein 1-2 minute lagte hain.

## Step 2: Database aur storage banao
1. Left menu mein **SQL Editor** kholo, "New query" dabao.
2. `supabase/schema.sql` file ka poora text paste karo aur **Run** dabao.
3. "Success" aana chahiye. Isse chat table, songs table, admin check aur `songs` storage bucket ban jaate hain.

## Step 3: Apna admin account banao
1. **Authentication > Users > Add user** mein apna email aur password daalo (auto confirm on rakho).
2. User ban'ne ke baad uska **UUID** copy karo (user ki row par dikhta hai).
3. **SQL Editor** mein ye chalao (UUID apna daalo):
   ```sql
   insert into public.admins (user_id) values ('YAHAN-APNA-UUID');
   ```
4. **Authentication** ki settings mein "Allow new users to sign up" band kar do, taaki koi aur account na bana sake.

## Step 4: Keys config.js mein daalo
1. **Project Settings > API** (ya Data API) kholo.
2. **Project URL** aur **anon / publishable key** copy karo.
3. `config.js` mein `url` aur `anonKey` mein paste karo.
4. **service_role / secret key kabhi paste mat karna.** Wo poori database ki chaabi hai.

## Step 5: GitHub par upload karo
Poora folder GitHub repo mein daalo (`index.html`, `admin.html`, `backend.js`, `config.js`, `assets/`, `supabase/`).
GitHub Pages on karo: Settings > Pages > Deploy from a branch > `main` / root.

## Step 6: Gaane daalo
1. `https://<tumhara-site>/admin.html` kholo, apne email password se sign in karo.
2. Audio file chuno (mp3, 128 kbps best, 15 MB se chhoti), title, artist, theme aur license chuno, **Upload** dabao.
3. Wo gaana turant us theme mein chalne lagta hai. Delete bhi yahin se hota hai.
4. Chat ke ganda ya spam message yahin "Chat moderation" se delete kar sakte ho.

## Zaruri baatein
- **Sirf wahi gaane upload karo jinke rights aapke paas hain** (apne, written permission wale, ya CC0 / CC BY). CC BY ke liye "Credit line" bharna zaruri hai, wo player mein gaane ke neeche dikhti hai.
- **Free plan ki limits (May 2026 ke hisaab se):** 500 MB database, 1 GB file storage, 200 saath online connections, mahine ke 2 million realtime messages. 1 GB mein lagbhag 250 mp3 aate hain.
- **Free project 1 hafte tak koi use na kare to pause ho jaata hai.** Dashboard se "Restore" dabane par wapas chalu ho jaata hai, data safe rehta hai. Roz kuch visitors aate rahe to ye nahi hota.
- **Public chat mein spam aa sakta hai.** Abhi sirf 1.5 second ka gap aur 200 akshar ki limit hai. Zyada spam aaye to bata dena, hum captcha ya blocklist jodenge.
- Ye code abhi kisi asli Supabase project ke saath nahi chala hai. Pehla test aap Step 6 ke baad karo: chat bhejo, ek gaana upload karo, aur dekho ki chale.

## Dashboard (traffic, live users, plays)
`supabase/analytics.sql` ko SQL Editor mein ek baar run karo (schema.sql ke baad). Phir `admin.html` ke upar Dashboard mein live users, roz ke visitors, total visitors, plays aur top songs dikhte hain.

## Update v2: ranking, fixed chat ID, admin tabs
`supabase/update-v2.sql` ko SQL Editor mein ek baar run karo (schema.sql aur analytics.sql ke baad). Phir:
- **Ranking:** jo gaana log 20 second tak sunte hain wo "listen" gina jata hai, poora sun lein to double. Sabse zyada score wala gaana har theme mein #1 par aur sabse pehle bajta hai. Naye gaane neeche se shuru hote hain.
- **Chat ID:** har visitor ko fixed ID milti hai (jaise `MW-4F2A91`). Naam badal nahi sakte. Admin ke message par `Admin ✓` dikhta hai.
- **Admin page:** Dashboard, Upload, Songs, Chat alag tabs mein. Gaane ke saath teen dot (⋮) se edit (title, artist, theme) ya delete. Chat mein ID ke hisaab se message ya us ID ke saare message delete kar sakte ho.
