# C.V. – Volume & Velocità

Estensione Manifest V3 per Brave, Chrome, Edge e altri browser Chromium (Linux, Windows, macOS, ChromeOS – versione 116+).

> Progetto indipendente, non affiliato a Google, Brave o Microsoft. "Chrome" nel nome del repository indica solo lo store di destinazione (Chrome Web Store).

## Installazione (Brave)
1. Estrai lo ZIP.
2. Apri `brave://extensions` (Chrome: `chrome://extensions`).
3. Attiva **Modalità sviluppatore** → **Carica estensione non pacchettizzata** → scegli la cartella estratta (quella che contiene `manifest.json`).
4. Fissa C.V. nella barra degli strumenti.

## Funzioni
- Volume della scheda 0–300% (passo 1%), scelte rapide Muto/50/100/150/200/300%, badge sull'icona, limitatore anti-distorsione.
- Velocità: 0,5× · 1× · 1,25× · 1,5× · 2× · 3×, oppure barra da 0,1× a 4× a passi del 5%. Funziona anche con video in iframe e Shadow DOM aperto.
- Lingua automatica (IT, EN, ES, FR, DE; altre → inglese), tema chiaro/scuro automatico.

## Note
- Con volume ≠ 100% il browser mostra l'indicatore di "condivisione scheda": è normale (serve per elaborare l'audio, che resta sul dispositivo). A 100% la cattura viene chiusa.
- Durante la cattura, lo schermo intero dei video resta dentro la finestra (limite di Chromium). Torna a 100% per lo schermo intero normale.
- Dopo il ricaricamento della pagina la velocità torna a 1× (il volume resta).
- Non funziona su pagine interne del browser (`brave://`, `chrome://`) e sul Web Store.
- Alzare il volume oltre il 100% può danneggiare l'udito o gli altoparlanti: usalo con moderazione.

## Privacy e conformità
- Nessun dato personale raccolto o trasmesso, nessun server, analytics o codice remoto (GDPR, D.Lgs. 196/2003, ePrivacy): vedi `PRIVACY.md`.
- L'audio della scheda è elaborato solo localmente e in tempo reale, mai registrato né inviato.

## Pubblicazione sul Chrome Web Store
- **Scheda Privacy**: nessun dato raccolto; spunta le tre certificazioni; URL dell'informativa = versione pubblica di `PRIVACY.md`.
- **Giustificazioni permessi** (le stesse di `PRIVACY.md`): `activeTab` = agire solo sulla scheda in cui apri C.V.; `scripting` = impostare la velocità dei video su richiesta; `tabCapture` + `offscreen` = elaborare l'audio della scheda per volume e boost oltre il 100%; `storage` = ricordare il volume della scheda solo per la sessione.
- **Digital Services Act (UE) – dichiarati "non trader"**: lo store chiede a tutti di dichiarare se sono *trader*. C.V. è gratuita e non fa parte di un'attività commerciale; le eventuali **donazioni volontarie non ti rendono un trader**. Seleziona quindi **non trader**: non devi pubblicare indirizzo, telefono né email personale nella scheda. Come contatto pubblico basta la sezione Issues del repository. L'email di contatto dell'account sviluppatore resta richiesta da Google per la verifica dell'account, ma non viene mostrata come dato del trader. I dati del trader servono solo se vendi o monetizzi l'estensione nell'ambito di un'attività professionale.

## Licenza
MIT, vedi `LICENSE`. Il software è fornito "così com'è", senza garanzie.
