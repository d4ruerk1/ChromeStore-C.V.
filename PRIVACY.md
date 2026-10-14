# Informativa sulla privacy – C.V. / Privacy Policy

Ultimo aggiornamento / Last updated: 14 ottobre 2026

**IT** — C.V. non raccoglie, non memorizza su server, non vende e non condivide alcun dato personale (Reg. UE 2016/679 "GDPR", D.Lgs. 196/2003 come modificato dal D.Lgs. 101/2018, Direttiva 2002/58/CE "ePrivacy"). Nessun tracciamento, analytics, cookie o codice remoto; lo sviluppatore non ha server e non riceve nulla. L'audio della scheda viene elaborato solo localmente e in tempo reale per applicare il volume scelto, senza essere registrato né trasmesso. L'unico dato salvato è il livello di volume per scheda, in memoria temporanea del browser (`storage.session`), cancellato alla chiusura della scheda o del browser.

Poiché lo sviluppatore non tratta dati personali, non esiste un titolare del trattamento per questa estensione. Per cancellare ogni dato basta chiudere il browser o disinstallare l'estensione. Puoi comunque proporre reclamo al Garante per la protezione dei dati personali (garanteprivacy.it). Contatti: sezione Issues del repository GitHub `d4ruerk1/ChromeStore-C.V.`.

**EN** — C.V. does not collect, transmit, sell or share any personal data. No tracking, analytics, cookies or remote code; the developer runs no server and receives nothing. Tab audio is processed locally in real time only to apply the chosen volume; it is never recorded or transmitted. The only stored value is the per-tab volume level in temporary browser memory (`storage.session`), cleared when the tab or browser closes. Contact: Issues on the GitHub repository `d4ruerk1/ChromeStore-C.V.`.

**Chrome Web Store** — The use of information received by this extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Permessi / Permissions
- `activeTab` – agisce solo sulla scheda in cui apri C.V. / acts only on the tab where you open C.V.
- `scripting` – imposta la velocità dei video su richiesta / sets video speed on demand.
- `tabCapture` + `offscreen` – necessari per il volume e il boost oltre il 100%; l'audio resta sul dispositivo / needed for volume and boost above 100%; audio never leaves the device.
- `storage` – ricorda il volume della scheda (solo in sessione) / remembers tab volume (session only).
