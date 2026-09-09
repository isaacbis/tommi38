# Tommi38 per iOS

Aprire `Tommi38IOS.xcodeproj`, schema `Tommi38IOS`, e selezionare un iPhone o un simulatore iOS. Richiede iOS 16 o successivo. Il target supporta iPhone/iPad e usa UIKit, SwiftUI e WKWebView.

Firma automatica configurata con il Personal Team esistente. Su un altro Mac selezionare il proprio Team in Signing & Capabilities. Non sono necessarie capability Push Notifications per le notifiche locali.

La webview carica https://tommi38.onrender.com/ con cookie persistenti, pull-to-refresh, gestione dei link esterni e pagina di recupero connessione. Il bridge `tommi38Notifications` accetta dal frame principale HTTPS di Tommi38 i messaggi `bookingCreated` (id, field, date yyyy-MM-dd, time HH:mm, minutesBefore) e `bookingCancelled` (id). I promemoria usano Europe/Rome, vengono sostituiti tramite ID e cancellati su richiesta della webapp. I banner sono abilitati anche in primo piano. Le notifiche locali non ricevono aggiornamenti dal server mentre l’app è chiusa.

## Verifica del 9 settembre 2026

- Controllo tipi Swift per arm64/iOS 16: superato per entrambi i file Swift.
- Sintassi JavaScript frontend, server e routes: superata.
- Firma automatica, certificato Apple Development e profilo gestito visibili in Xcode.
- Build completa ed esecuzione ancora da verificare: Xcode richiede di completare il download del supporto iOS 26.5. Il comando di build si ferma nella compilazione degli asset per assenza del runtime simulatore.
- Render risponde a health e configurazione pubblica, ma i file pubblicati differiscono da main f53c700. `/api/reservations/mine` restituisce HTML anziché JSON: il deploy della versione aggiornata va verificato nel dashboard Render. Nessuna modifica a frontend/backend in questa branch.

## Prova finale dopo il download e il deploy

1. Terminare il download iOS in Xcode e premere Run con l’iPhone selezionato; accettare sul dispositivo eventuali richieste di attendibilità e consentire le notifiche.
2. Accedere e verificare Prenota, Le mie partite e Avvisi.
3. Con una prenotazione di prova autorizzata verificare il promemoria, poi cancellarla e verificare che il promemoria venga rimosso.
4. Verificare riapertura con login persistente e recupero della connessione con Riprova/pull-to-refresh.

Non sono state create prenotazioni né modificati dati in produzione durante la verifica.
