# Control Video

Estensione browser moderna basata su **Manifest V3** per browser basati su Chromium (Google Chrome, Brave, Microsoft Edge, Opera) e Mozilla Firefox. Permette di amplificare il volume fino al 500%, controllare con precisione la velocità di riproduzione video e gestire automaticamente la modalità Picture-in-Picture (PiP).

---

## Caratteristiche Principali
* **Audio Boost (fino al 500%)**
  * Amplificazione audio fino al 500% tramite Web Audio API e offscreen document isolato.
  * Limitatore dinamico anti-distorsione per preservare la fedeltà del suono ad alti volumi.
  * Gestione trasparente del volume nativo per livelli $\le$ 100%.
  * Opzione per memorizzare il volume impostato per ciascuna scheda durante la navigazione.
* **Controllo Velocità Video (0.25× – 5×)**
  * Regolazione granulare della velocità da 0.25× a 5×.
  * Preservazione nativa dell'intonazione vocale (*pitch correction*).
  * Preset rapidi e compatibilità estesa con elementi multimediali annidati in `<iframe>` e alberi **Shadow DOM**.
  * Protezione anti-conflitto per lettori multimediali LMS e bypass dei flussi video in streaming.
* **Picture-in-Picture (PiP) Intelligente e Automatico**
  * Attivazione automatica del video in PiP quando si cambia scheda o si riduce la finestra a icona.
  * Ripristino e chiusura automatica del PiP al ritorno sulla scheda attiva.
  * Integrazione con MediaSession API e scorciatoia rapida da tastiera dedicata (`Alt+P`).
* **Privacy & Sicurezza al 100%**
  * Elaborazione interamente locale in tempo reale sul dispositivo.
  * Nessun dato tracciato, memorizzato o inviato a server esterni.
  * Piena conformità con GDPR, Codice Privacy italiano e linee guida di Chrome Web Store e Mozilla AMO.
* **Interfaccia e Accessibilità**
  * Supporto completo a 9 lingue con rilevamento automatico o selezione manuale: Italiano (IT), Inglese (EN), Spagnolo (ES), Francese (FR), Tedesco (DE), Russo (RU), Cinese Semplificato (ZH-CN), Giapponese (JA) e Arabo (AR).
  * Design reattivo con supporto automatico al tema Chiaro/Scuro del sistema operativo[cite: 1, 2].

---

## Scorciatoie da Tastiera
| Azione | Scorciatoia Predefinita |
| :--- | :--- |
| **Attiva / Disattiva PiP** | `Alt+P` |
| **Aumenta Volume Boost** | Configurabile in `Gestione scorciatoie` |
| **Diminuisci Volume Boost** | Configurabile in `Gestione scorciatoie` |
| **Ripristina Volume (100%)** | Configurabile in `Gestione scorciatoie` |
| **Aumenta Velocità** | Configurabile in `Gestione scorciatoie` |
| **Diminuisci Velocità** | Configurabile in `Gestione scorciatoie` |
| **Ripristina Velocità (1×)** | Configurabile in `Gestione scorciatoie`[cite: 2] |

> Per personalizzare le combinazioni di tasti:
> * Su Chromium: visita `chrome://extensions/shortcuts`
> * Su Firefox: visita `about:addons` > icona ingranaggio > *Gestisci scorciatoie da tastiera*[cite: 1, 2]

---

## Installazione

### Chromium (Google Chrome, Brave, Edge, Opera)
1. Clona o scarica il repository ed estrai l'archivio.
2. Apri il browser e naviga all'indirizzo `chrome://extensions` (oppure `brave://extensions` / `edge://extensions`).
3. Attiva l'interruttore **Modalità sviluppatore** in alto a destra.
4. Clicca su **Carica estensione non pacchettizzata** (*Load unpacked*).
5. Seleziona la cartella principale contenente il file `manifest.json`[cite: 1, 2].

### Mozilla Firefox (v115.0 o superiore)
1. Apri Firefox e naviga all'indirizzo `about:debugging#/runtime/this-firefox`.
2. Clicca su **Carica componente aggiuntivo temporaneo...**.
3. Seleziona il file `manifest.json` all'interno della cartella dell'estensione[cite: 1, 2].

---

## Requisiti Tecnici
* **Piattaforma:** Manifest V3
* **Motori supportati:** Chromium $\ge$ 116 (supporto `chrome.offscreen`), Firefox ESR $\ge$ 115.0
* **Permessi impiegati:** `tabCapture`, `offscreen`, `storage`, `activeTab`, `scripting`[cite: 2]

---

## Licenza
Distribuito sotto licenza [Apache 2.0](LICENSE). Consultare il file `LICENSE` per maggiori dettagli[cite: 1, 2].
