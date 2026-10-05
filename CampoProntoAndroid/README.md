# CampoPronto ADS — Android nativo

Versione 2.1 (59), package `it.campopronto.ads`, Android 7.0/API 24 o successivi, target API 36. Interfaccia Kotlin/Jetpack Compose; non contiene una WebView. Backend esclusivamente Firebase, condiviso con la versione iPhone.

## Funzioni

- Scelta cliente/gestore, ricerca stabilimenti e ricerca nelle vicinanze con posizione approssimativa elaborata sul telefono.
- Login, recupero accesso, registrazione stabilimento attiva immediatamente, creazione da 1 a 1.000 clienti e PDF delle credenziali da salvare direttamente sul dispositivo.
- Prova privata di dieci minuti con configurazione, impostazioni predefinite e cambio ruolo cliente/gestore.
- Home compatta, foto uniformi con immagine intera, meteo a tre giorni, prenotazioni, cancellazioni, liste d'attesa e ricerca giocatori con richieste, segnalazioni e blocchi.
- Gestione utenti, orari, campi, chiusure per periodo, statistiche e prenotazioni. Il server limita ogni gestore al proprio stabilimento; solo l'amministratore globale può assegnare crediti.
- Banner per i clienti, interstitial dopo un nuovo login (massimo uno ogni due minuti) e video premio volontario: un video completato vale un credito, entro il limite giornaliero condiviso con iOS.
- Account, cambio password, eliminazione account, preferenze privacy e promemoria locali facoltativi delle prenotazioni. Non sono notifiche push remote.

I pacchetti a pagamento non sono attivi, come nella versione iOS attuale. La prova non mostra pubblicità né effettua pagamenti. La disponibilità degli annunci reali dipende dalla revisione AdMob, dal consenso e dall'inventario.

## Sicurezza dei crediti e della sessione

Il video non assegna crediti sul dispositivo: il server verifica la firma Google SSV e registra una sola ricompensa per transazione; Android e iOS condividono lo stesso limite giornaliero. Il client aggiorna il saldo subito e continua a interrogare il server se la conferma arriva in ritardo. Le sessioni sono cifrate con una chiave Android KeyStore. Le password non vengono persistite. Il PDF iniziale contiene credenziali e viene scritto solo nella destinazione scelta dall'utente.

API: `https://ombrelloni-ddb55.web.app/api`. La registrazione di grandi gruppi usa direttamente la funzione Firebase per evitare il limite del proxy Hosting. Non sono usati servizi Render.

## Compilazione

Richiede JDK 17 e Android SDK 36. `local.properties` (ignorato da Git) deve indicare `sdk.dir`. Le dipendenze e gli identificativi pubblici AdMob sono in `gradle.properties`. Il wrapper Gradle include la verifica SHA-256 della distribuzione ufficiale.

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintRelease
```

Per la release, impostare `CAMPOPRONTO_UPLOAD_KEYSTORE`, `CAMPOPRONTO_UPLOAD_STORE_PASSWORD` e `CAMPOPRONTO_UPLOAD_KEY_PASSWORD` nell'ambiente; alias `campopronto-upload`. Non inserire password nel repository o nei comandi registrati. La chiave di caricamento e la relativa configurazione locale si trovano nella cartella privata `~/Library/CampoProntoAndroidSigning/`; vanno conservate per i futuri aggiornamenti. Google Play App Signing conserva separatamente la chiave di distribuzione.

```sh
./gradlew :app:bundleRelease :app:assembleRelease
```

Debug usa unità pubblicitarie di test Google e non può attribuire crediti reali attraverso tali unità. La release usa le unità Android del progetto AdMob, consenso UMP europeo, richieste non personalizzate e controllo SSV sul backend.

## Verifiche e distribuzione

Sette test Android su intervalli, sovrapposizioni, chiusure inclusive, ora italiana/DST, validazione numerica e distanze. Sei test backend AdMob su firma, importo, unità ammesse, duplicati e limite giornaliero. Build firmata e controllo lint completati. Sul simulatore sono stati verificati ingresso, prova, cambio ruolo, prenotazione, saldo, ricerca giocatori, cancellazione, statistiche e chiusura di un periodo.

Google Play: account StaffAI, app 4975870204600993703. Il test interno è attivo; il requisito del test chiuso con almeno 12 partecipanti per almeno 14 giorni precede la richiesta di accesso alla produzione. La pubblicazione pubblica richiede inoltre l'approvazione Google.

Per i revisori è stato creato uno stabilimento permanente separato, CampoPronto Demo, con gestore e clienti fittizi. Le sue credenziali sono archiviate fuori dal repository e vengono fornite soltanto nel modulo riservato di Google Play.
