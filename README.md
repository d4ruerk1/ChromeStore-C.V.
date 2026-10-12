# C.V. – Volume & Velocità

Estensione Manifest V3 per Brave, Chrome, Edge e altri browser Chromium (Linux, Windows, macOS, ChromeOS – versione 116+).

## Installazione (Brave)
1. Estrai lo ZIP.
2. Apri `brave://extensions` (Chrome: `chrome://extensions`).
3. Attiva **Modalità sviluppatore** → **Carica estensione non pacchettizzata** → scegli la cartella `cv`.
4. Fissa C.V. nella barra degli strumenti.

## Funzioni
- Volume della scheda 0–300% (passo 1%), scelte rapide Muto/50/100/150/200/300%, badge sull'icona, limitatore anti-distorsione.
- Velocità: 0,5× · 1× · 1,25× · 1,5× · 2× · 3×, oppure barra da 0,1× a 4× a passi del 5%. Funziona anche con video in iframe e Shadow DOM aperto.
- Lingua automatica (IT, EN, ES, FR, DE; altre → inglese), tema chiaro/scuro automatico.

## Note
- Con volume ≠ 100% il browser mostra l'indicatore di "condivisione scheda": è normale (serve per elaborare l'audio). A 100% la cattura viene chiusa.
- Durante la cattura, lo schermo intero dei video resta dentro la finestra (limite di Chromium). Torna a 100% per lo schermo intero normale.
- Dopo il ricaricamento della pagina la velocità torna a 1× (il volume resta).
- Non funziona su pagine interne del browser (`brave://`, `chrome://`) e sul Web Store.

## Pubblicazione sul Chrome Web Store
Per l'UE (Digital Services Act) servono i dati del "trader" (nome, indirizzo, email) nel profilo sviluppatore. Usa `PRIVACY.md` come informativa e le giustificazioni dei permessi lì indicate.
