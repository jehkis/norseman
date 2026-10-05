# Norseman-treenipäiväkirja: käyttöönotto

Kokonaisuus on kaksi ilmaista palvelua:

```
Puhelin / kone  →  GitHub Pages (sovellus)  →  Supabase (merkinnät + kirjautuminen)
```

Varaa aikaa noin 30 minuuttia. Palveluiden valikoiden nimet voivat poiketa hieman näistä ohjeista.

## Tiedostot

| Tiedosto | Mikä se on |
|---|---|
| `index.html` | Itse sovellus |
| `supabase-setup.sql` | Luo tietokantataulun ja suojaukset |
| `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Kotinäytön kuvake ja sovellusmainen avautuminen |

---

## Osa 1: Supabase

1. Mene osoitteeseen **supabase.com** ja luo tili (GitHub-tunnuksilla kirjautuminen käy).
2. Luo uusi projekti: **New project**.
   - Nimi esimerkiksi `norseman`.
   - Keksi tietokannan salasana ja tallenna se salasanojen hallintaan. Sovellus ei tarvitse sitä.
   - **Region:** valitse EU-alue, esimerkiksi *Central EU (Frankfurt)*.
3. Kun projekti on valmis, avaa vasemmalta **SQL Editor**, liitä koko `supabase-setup.sql`-tiedoston sisältö ja paina **Run**. Tuloksen pitää olla *Success*.
4. Luo itsellesi käyttäjä: **Authentication → Users → Add user → Create new user**.
   - Syötä sähköpostisi ja salasana, jolla kirjaudut sovellukseen.
   - Rastita **Auto Confirm User**, jolloin vahvistussähköpostia ei tarvita.
5. Estä muita luomasta tunnuksia: **Authentication → Sign In / Providers** ja kytke pois **Allow new users to sign up**.
6. Hae kaksi arvoa projektin asetuksista (**Project Settings**, tai yläpalkin **Connect**-painike):
   - **Project URL**, muotoa `https://abcdefgh.supabase.co`
   - **Publishable key** (`sb_publishable_…`) tai vanhemmissa projekteissa **anon public** -avain.

   **Älä käytä** avainta nimeltä *secret* tai *service_role*. Se ohittaa suojaukset.

7. Avaa `index.html` tekstieditorissa (esim. VS Code tai Muistio), etsi rivit

   ```js
   const SUPABASE_URL = 'LIITÄ_PROJECT_URL_TÄHÄN';
   const SUPABASE_KEY = 'LIITÄ_PUBLISHABLE_TAI_ANON_KEY_TÄHÄN';
   ```

   ja liitä arvot lainausmerkkien sisään. Tallenna.

> Publishable/anon-avain on tarkoitettu näkymään selaimessa. Tietoja suojaa rivitason suojaus (RLS), jonka SQL-tiedosto kytki päälle: jokainen kirjautunut näkee vain omat merkintänsä, eikä kukaan voi luoda uusia tunnuksia.

## Osa 2: GitHub Pages

1. Mene osoitteeseen **github.com**, luo tili ja uusi repo: **New repository**.
   - Nimi esimerkiksi `norseman`.
   - **Public** (ilmainen Pages vaatii julkisen repon).
2. Repon sivulla: **Add file → Upload files**. Raahaa kaikki tiedostot (`index.html`, `manifest.webmanifest` ja kolme kuvaa) ja paina **Commit changes**. SQL-tiedostoa ja näitä ohjeita ei tarvitse ladata.
3. **Settings → Pages**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` ja kansio `/ (root)` → **Save**.
4. Odota 1–2 minuuttia. Sovellus löytyy osoitteesta
   `https://KÄYTTÄJÄNIMESI.github.io/norseman/`

## Osa 3: Puhelimeen

1. Avaa osoite puhelimen selaimessa.
   - **iPhone:** Safari → Jaa-painike → **Lisää Koti-valikkoon**.
   - **Android:** Chrome → ⋮ → **Asenna sovellus** tai **Lisää aloitusnäytölle**.
2. Avaa sovellus kotinäytöltä ja kirjaudu kerran sisään. Kirjautuminen säilyy.
3. Tee sama koneella. Merkinnät synkronoituvat laitteiden välillä automaattisesti.

---

## Päivittäminen

Kun sovellukseen tulee uusi versio, korvaa `index.html` GitHubissa (**Add file → Upload files** samalla nimellä ja **Commit**). **Muista liittää Supabase-arvot uuteen tiedostoon ennen latausta.** Sivu päivittyy minuutissa. Jos puhelin näyttää vanhaa versiota, sulje sovellus kokonaan ja avaa uudelleen.

## Hyvä tietää

- **Ilmainen Supabase-projekti menee tauolle**, jos sitä ei käytetä viikkoon. Data säilyy. Herätä projekti Supabasen hallintapaneelista (**Restore project**).
- **Varmuuskopio:** Kehitys-näkymän alalaidassa on *Lataa varmuuskopio*. Tallenna se esimerkiksi kerran kuukaudessa, koska ilmaisversiossa ei ole automaattisia varmuuskopioita.
- **Ongelmatilanteita:**
  - *"Supabase-asetukset puuttuvat"* → kohta 7 tekemättä tai lainausmerkit puuttuvat.
  - *Kirjautuminen ei onnistu* → tarkista, että käyttäjä on luotu ja *Auto Confirm User* oli rastitettu.
  - *Tallennus epäonnistui* → tarkista, että SQL-tiedosto ajettiin onnistuneesti, ja ettei projekti ole tauolla.
