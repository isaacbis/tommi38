# Tommi38 per iOS

Aprire `Tommi38IOS.xcodeproj`, schema `Tommi38IOS`, e selezionare un iPhone, iPad o simulatore. Il target richiede iOS 16 o successivo e usa SwiftUI, UIKit, WKWebView, UserNotifications e CryptoKit, senza SDK esterni.

La firma automatica è configurata per il team Apple Developer del proprietario. Su un altro Mac selezionare il proprio team in Signing & Capabilities. I promemoria locali non richiedono la capability Push Notifications.

## Funzioni native

La webview carica [Tommi38](https://tommi38.onrender.com/) con cookie persistenti, pull-to-refresh, pagina di recupero connessione e gestione dei dialoghi JavaScript dell’area amministratore. La tastiera conserva la propria area sicura; l’interfaccia web gestisce le aree di schermo riservate al dispositivo.

La navigazione interna e il bridge sono limitati al dominio di produzione in HTTPS sulla porta predefinita o 443. Il bridge accetta messaggi soltanto dal frame principale. I link esterni, comprese le nuove finestre, possono aprire soltanto gli schemi `http`, `https`, `tel`, `mailto` e `sms`.

## Promemoria delle prenotazioni

All’avvio della pagina il contenitore espone `window.tommi38Native.notificationsVersion = 2`. Il bridge `tommi38Notifications` riceve:

- `bookingContext`: attiva il contesto `account` e `establishment`.
- `bookingCreated`: programma una prenotazione con `id`, `field`, `date` (`yyyy-MM-dd`), `time` (`HH:mm`) e `minutesBefore`.
- `bookingCancelled`: rimuove il promemoria della prenotazione indicata da `id`.
- `syncBookings`: riconcilia l’elenco completo `items` delle prenotazioni personali.
- `clearBookings`: rimuove i promemoria del contesto all’uscita o all’eliminazione dell’account.

Tutti i messaggi includono account e stabilimento. Gli identificativi nativi incorporano un hash di entrambi, così prenotazioni con lo stesso ID restano distinte. Il cambio di account ritira i precedenti promemoria Tommi38; uscita e cancellazione restano valide anche se una programmazione asincrona è ancora in corso. Non vengono eliminate notifiche estranee al prefisso dell’app.

Il permesso viene richiesto quando occorre programmare il primo promemoria. Gli orari usano Europe/Rome e vengono validate anche date e ore. Si programmano al massimo le 64 prenotazioni più vicine. Un nuovo appuntamento imminente può generare un avviso dopo pochi secondi; la sincronizzazione non ripete avvisi già trascorsi. I banner sono abilitati anche in primo piano.

La webapp aggiorna i promemoria durante la sincronizzazione di Home e Le mie partite. Non ci sono push dal server: una cancellazione effettuata altrove viene riconciliata quando l’app torna a sincronizzarsi. Con l’app chiusa un promemoria già programmato può ancora essere mostrato. Gli aggiornamenti web arrivano dal sito; le modifiche al contenitore Swift richiedono una nuova build.

## Privacy

`Tommi38IOS/PrivacyInfo.xcprivacy` dichiara dati collegati all’utente e usati per le funzionalità dell’app: nome, telefono, identificativo utente, contenuti forniti dagli utenti, assistenza, storico acquisti/crediti, interazioni con il prodotto e foto/video tramite URL della galleria inseriti dagli amministratori. La dichiarazione comprende anche i dati gestiti dalla webapp.

Non è dichiarato tracciamento. Il codice nativo non usa direttamente API soggette a dichiarazione del motivo d’accesso, identificatori pubblicitari o posizione GPS. Le dichiarazioni privacy in App Store Connect devono restare coerenti con il manifest e con l’informativa pubblica.

## Verifiche del 10 settembre 2026

- Build Release firmata e build Debug per simulatore completate con Xcode 26.6 e SDK iOS 26.5.
- Manifest privacy validato con `plutil`.
- Otto scenari del gestore promemoria superati: permesso contestuale, isolamento account/stabilimento, riconciliazione delle cancellazioni, uscita selettiva, uscita e cancellazione durante una programmazione, validazione date/limite di 64 e mancata ripetizione degli avvisi imminenti.
- Sette test di regressione dell’interfaccia mobile superati; sintassi JavaScript verificata.

Da root del repository:

```sh
python3 tests/native-reminders.py
node --test tests/mobile.test.cjs
plutil -lint Tommi38IOS/Tommi38IOS/PrivacyInfo.xcprivacy
```

Il test nativo richiede macOS, Python 3 e il compilatore Swift di Xcode. Estrae la classe di produzione e la compila con un servizio notifiche simulato in una cartella temporanea, eliminata alla fine. Non compila l’app, non usa firma o dispositivi e non invia notifiche reali.

Prima della distribuzione, verificare su dispositivo accesso persistente, tastiera, cambio account/stabilimento, recupero della connessione e consegna effettiva di un promemoria. I test simulati non sostituiscono la verifica della consegna da parte di iOS.

La scheda App Store Connect `6810684742` è stata creata con distribuzione gratuita in Italia. Il caricamento della build e l’invio ad App Review sono passaggi distinti: la creazione della scheda e le build locali riuscite non indicano che l’app sia pubblicata.
