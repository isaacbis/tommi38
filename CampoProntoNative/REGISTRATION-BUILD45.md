# CampoPronto ADS 2.0 · build 45

## Registrazione e permessi

La registrazione guidata è disponibile dalla schermata iniziale e dal login. Configura nome, città, 1–6 campi, orari, durata degli slot, account gestore e 1–100 utenti con prefisso personalizzabile e numerazione a tre cifre.

Su richiesta del proprietario, ogni nuovo stabilimento è immediatamente attivo e privato. L’invito è incluso nel PDF. Il gestore amministra solo il proprio stabilimento, senza facoltà di assegnare crediti o privilegi globali. Ogni nuovo utente parte da zero crediti. Password utente casuali alfanumeriche di sei caratteri; password del gestore di almeno dodici caratteri. Firestore conserva solo hash bcrypt. Creazione atomica e identificatore della richiesta impediscono account parziali e duplicati. Il servizio limita le registrazioni a tre richieste per indirizzo IP al giorno per istanza.

Le credenziali sono restituite una sola volta, senza salvataggio in chiaro sul server, per generare il PDF locale. Il creatore deve salvarlo prima di uscire. Se una risposta viene persa dopo la creazione, ripetere la stessa richiesta non ricrea lo stabilimento: servirà il recupero tramite il gestore o l’amministratore globale.

## Interfaccia

Home più compatta, comunicazioni e istruzioni espandibili. Foto intere in riquadri uguali, piccoli e con angoli continui da 18 punti; fino a quattro affiancate, con ulteriori immagini su nuove righe e nessuno scorrimento orizzontale. Due colonne con dimensioni testo di accessibilità. Animazioni di pressione più morbide e rispetto di Riduci movimento.

## Verifica e distribuzione

- 155 test backend passati, compresi registrazione, hash, account senza crediti, isolamento tra stabilimenti, blocco privilegi globali e blocco accrediti del gestore.
- Build simulatore e archivio Release firmato completati con Xcode 27.
- PDF nativo di 100 account di prova verificato visivamente su cinque pagine, numerazione completa e salvataggio tramite File su iPhone riuscito. Fixture disponibile solo in DEBUG; nessun account reale creato per la prova PDF.
- Login esistente e home verificati su iPhone 18 Pro Max; immagini intere affiancate. Annuncio interstitial AdMob di test mostrato correttamente. Questo non garantisce disponibilità degli annunci di produzione.
- Hosting e Cloud Functions pubblicati su Firebase, versione `firebase-native-2.0-build45`, URL https://ombrelloni-ddb55.web.app. Callback AdMob firmato invariato, direttamente sulla Cloud Function.
- Build 45 caricata con successo su App Store Connect. Le novità, la descrizione e le istruzioni di revisione sono aggiornate; aggiunte tre nuove schermate iPhone. Pubblicazione subordinata all’approvazione Apple.

Pacchetti a pagamento e push remoti restano non attivati. Le vecchie app pubblicate mantengono il vecchio servizio fino all’aggiornamento; la nuova build usa Firebase.
