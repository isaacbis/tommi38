# CampoPronto — release App Store

Stato aggiornato il **10 settembre 2026**. CampoPronto è il nuovo nome dell’app; **Tommi38 resta il nome dello stabilimento**. Il cambio di nome e icona mantiene la stessa scheda Apple, gli account e le prenotazioni.

## Stato della pubblicazione

La versione **1.0, build 1**, con il nome Tommi38, è stata caricata e inviata ad Apple il **10 settembre 2026 alle 16:52, Europe/Rome**. L’invio `a527ec0d-ac78-4a02-8660-ba4cd2da9a99` è stato successivamente ritirato per sostituire nome e icona.

La versione **1.0, build 2**, con il nome CampoPronto e l’icona blu scelta dal titolare, è stata archiviata, validata e **caricata con successo il 10 settembre 2026 alle 17:17, Europe/Rome**. La build 2 è stata elaborata da Apple e associata alla versione 1.0. Il nome pubblico **CampoPronto: prenota campi** è già salvato nella scheda. Dopo il ritiro, la versione 1.0 risulta `developerRejected`; **il nuovo invio per la revisione non è ancora stato effettuato**. L’app non viene quindi dichiarata approvata o disponibile al pubblico.

| Campo | Valore |
| --- | --- |
| Nome nella scheda | CampoPronto: prenota campi |
| Nome sul dispositivo | CampoPronto |
| Lingua e categoria | Italiano; Sport / Sports |
| App Store Connect app ID | `6810684742` |
| Bundle ID invariato | `isaacmorganti.Tommi38IOS` |
| Team Apple | `82M5KZ26B2` |
| SKU invariato | `tommi38-ios` |
| Versione associata | `1.0`, build `2`; nuovo invio in preparazione |
| Prezzo e disponibilità | Gratuita, Italia |
| Pubblicazione | Automatica dopo l’approvazione Apple |
| Dispositivi | iPhone e iPad; disponibilità Mac e Apple Vision Pro disattivata |
| Titolare e copyright | Isaac Morganti; © 2026 Isaac Morganti |
| Email pubblica di assistenza e privacy | isaacmorg93@virgilio.it |

Scheda: [App Store Connect](https://appstoreconnect.apple.com/apps/6810684742/distribution/ios/version/inflight).

Il marchio CampoPronto è distribuito in produzione con il commit `95ea019` (PR #8), mantenendo gli URL esistenti. Le pagine [privacy](https://tommi38.onrender.com/privacy.html), [assistenza](https://tommi38.onrender.com/support.html) e [regole della community](https://tommi38.onrender.com/community-rules.html) sono pubbliche. Il controllo di produzione ha rilevato un 404 per `/icons/apple-touch-icon-v3.png`: il file è presente ma mancava nella lista esplicita delle risorse pubbliche. La correzione aggiunge solo quel percorso, conserva l’icona v2 e resta da distribuire; fino al deploy il 404 impedisce anche l’installazione completa della cache PWA v18.

## Testi della scheda italiana

| Campo | Testo | Lunghezza |
| --- | --- | --- |
| Nome | CampoPronto: prenota campi | 26 caratteri |
| Sottotitolo | Prenota campi, trova giocatori | 30 caratteri |
| Parole chiave | sport,tennis,beach volley,disponibilità,agenda,organizzazione,crediti,gruppi,attesa | 84 byte UTF-8 |

Nome e sottotitolo rispettano il limite di 30 caratteri. Il testo promozionale seguente occupa 131 caratteri su 170 disponibili; le parole chiave restano entro 100 byte. Per la prima versione non si compila “Novità”. [Informazioni dell’app](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information), [proprietà della versione](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

### Testo promozionale

Scegli lo stabilimento, prenota il tuo campo e organizza la partita. Controlla crediti, richieste e lista d’attesa in un’unica app.

### Descrizione

CampoPronto ti aiuta a organizzare le partite e a prenotare i campi sportivi degli stabilimenti che usano il servizio.

Scegli il tuo stabilimento e accedi con il relativo account. Consulta i campi e gli orari disponibili, seleziona la fascia che preferisci e conferma la prenotazione. Ritrovi le tue partite e lo storico nell’app e puoi annullare una prenotazione secondo le regole dello stabilimento.

CERCA GIOCATORI
Apri una ricerca per la tua partita, consulta quelle disponibili e invia una richiesta di partecipazione. Gestisci le tue ricerche e le richieste ricevute dalle sezioni dedicate. Puoi segnalare contenuti al gestore e bloccare altri account nello stabilimento. Il blocco nasconde reciprocamente ricerche e contatti e impedisce nuove interazioni.

CREDITI E LISTA D’ATTESA
Controlla il saldo e i movimenti dei crediti e invia al gestore una richiesta di ricarica. I crediti servono alle prenotazioni di campi fisici presso lo stabilimento: non sbloccano contenuti digitali. L’app non effettua pagamenti online.
Se l’orario che desideri è occupato, puoi seguirlo nella lista d’attesa e controllarne la disponibilità mentre usi l’app. La prenotazione richiede sempre una tua conferma.

PROMEMORIA SU IPHONE
Puoi autorizzare i promemoria locali sul dispositivo per ricordarti le prenotazioni. La lista d’attesa non invia notifiche push dal server.

PER GLI STABILIMENTI
Gli account abilitati alla gestione dispongono di agenda, gestione degli utenti e dei crediti, configurazione dei campi e degli orari, statistiche e chiusure programmate, anche per più giorni. Ogni account opera nello stabilimento a cui appartiene; l’amministratore globale può gestire gli stabilimenti autorizzati.

Per usare il servizio occorrono una connessione internet e un account attivo nello stabilimento scelto. La registrazione è disponibile quando il gestore la abilita e può richiedere la sua approvazione. Disponibilità, accesso e condizioni delle prenotazioni dipendono dallo stabilimento.

## Schermate e accesso per App Review

La build precedente dispone di **tre screenshot iPhone a 1320 × 2868 pixel** (Prenota, Home, Cerca giocatori) e **due screenshot iPad a 2064 × 2752 pixel** (Prenota, Home), acquisiti nei simulatori e già caricati nelle classi iPhone 6,9″ e iPad 13″. La sostituzione con schermate CampoPronto è ancora da completare. Usare schermate reali, coerenti con la build e senza dati dei clienti; le verifiche web a dimensioni ridotte non sostituiscono gli screenshot App Store. [Specifiche Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

L’accesso dimostrativo nello stabilimento **Tommi38** è stato provato su iPhone e iPad. Credenziali e contatti riservati per la revisione sono già salvati nei campi privati di App Store Connect: **non inserirli nel repository**. L’account deve restare disponibile durante la revisione, con crediti sufficienti e senza dipendere da una nuova approvazione del gestore. [Informazioni per App Review](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

### Note per la revisione

> CampoPronto consente di prenotare campi sportivi fisici presso gli stabilimenti presenti nel servizio. All’apertura selezionare Tommi38 e usare le credenziali inserite nei campi di accesso per la revisione.
>
> Per verificare una prenotazione, aprire Prenota, scegliere uno dei campi disponibili, una data e un orario libero, quindi confermare. L’account dispone di crediti dimostrativi. Le proprie prenotazioni sono consultabili in Le mie partite. Da una prenotazione è possibile aprire una ricerca giocatori; gli orari occupati possono essere seguiti nella lista d’attesa.
>
> I crediti sono utilizzati esclusivamente per prenotazioni di servizi sportivi svolti fisicamente presso lo stabilimento. L’app non vende contenuti digitali e non contiene pagamenti online; le richieste di ricarica sono gestite dallo stabilimento.
>
> Su iPhone i promemoria delle prenotazioni sono notifiche locali autorizzate dall’utente. Non è presente un servizio server di notifiche push per la lista d’attesa.
>
> Privacy, assistenza e regole sono raggiungibili dai collegamenti dell’app. L’area account permette di avviare “Elimina il tuo account”, confermando username, password attuale e cancellazione definitiva. In Cerca giocatori, “Segnala / blocca” apre le azioni sul contenuto; “Sicurezza” permette di gestire i propri blocchi. I gestori trovano “Segnalazioni” nel menu di amministrazione.
>
> La build 2 aggiorna il nome da Tommi38 a CampoPronto e l’icona dell’app. Tommi38 resta il nome dello stabilimento dimostrativo; il servizio e gli account appartengono alla stessa app.

## Dichiarazioni completate

- **Privacy dell’app pubblicata:** otto categorie, tutte collegate all’utente, finalità `AppFunctionality`, nessun tracking: `Name`, `PhoneNumber`, `UserID`, `OtherUserContent`, `CustomerSupport`, `PurchaseHistory`, `ProductInteraction`, `PhotosOrVideos`. Il manifest nativo `PrivacyInfo.xcprivacy` dichiara le stesse categorie; il cambio di marchio non introduce nuove raccolte.
- **Classificazione per età:** 13+, calcolata dal questionario compilato per i contenuti e le interazioni presenti.
- **Distribuzione UE:** stato DSA di non operatore commerciale salvato e attivo, sulla dichiarazione del titolare di progetto personale non commerciale.
- **Diritti sui contenuti:** il titolare ha confermato i diritti o il permesso per logo e fotografie; dichiarazione salvata nella scheda.
- **Crittografia:** uso della crittografia HTTPS fornita dal sistema; `ITSAppUsesNonExemptEncryption = NO` nella build. Non equivale a dichiarare assente ogni forma di crittografia.
- **Contratti e prezzo:** contratto per app gratuite attivo, prezzo €0 e Italia selezionata. Non sono previsti acquisti in-app o pagamenti online.

Riferimenti: [privacy Apple](https://developer.apple.com/app-store/app-privacy-details/), [classificazione per età](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/), [requisiti DSA](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/), [esportazione](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

## Implementazione e verifiche della release

L’app usa Render e Google Firebase/Firestore. Le immagini esterne sono caricate dagli URL configurati dai gestori; telefono e WhatsApp si aprono su azione dell’utente. Il meteo usa le coordinate dello stabilimento, senza acquisire la posizione del dispositivo. Non sono presenti SDK pubblicitari, analytics o IDFA. La sessione scade dopo otto ore di inattività; non sono implementati termini automatici di cancellazione per ogni storico o lista d’attesa scaduta. L’informativa deve restare coerente con la conservazione effettiva.

L’eliminazione dell’account richiede la password attuale, invalida le sessioni e rimuove i dati dello stabilimento con una procedura riprendibile dopo errori. Per l’amministratore globale e l’ultimo gestore viene registrata una richiesta di trasferimento della gestione prima della cancellazione. La community dispone di filtro di base, segnalazioni, blocchi reciproci, oscuramento dei contenuti e sospensione degli account. La presa in carico delle segnalazioni e dei trasferimenti di gestione resta un’attività del titolare e dei gestori. [Eliminazione account](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [contenuti degli utenti](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).

I crediti prenotano servizi sportivi consumati fisicamente presso lo stabilimento. I promemoria sono locali, con autorizzazione facoltativa, isolamento per account e stabilimento e riallineamento quando l’app recupera le prenotazioni; non garantiscono aggiornamenti istantanei a app chiusa per modifiche effettuate altrove. La lista d’attesa non prenota automaticamente e non invia push dal server. [Servizi fisici](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods).

La release CampoPronto con la correzione di distribuzione dell’icona ha superato **128 test JavaScript** e **8 scenari dei promemoria nativi**. La suite comprende 17 test UGC; i controlli di sintassi dei 17 JavaScript applicativi erano già validi nella release precedente. La verifica visiva di scelta stabilimento, accesso e Home a **320 × 568 pixel** non ha rilevato overflow (`scrollWidth: 320`, `scrollHeight: 568`). Sono stati verificati nel browser i percorsi di cancellazione account e segnalazione/blocco con dati sintetici; login e schermate principali sono stati provati nei simulatori iPhone e iPad. Le prove di concorrenza usano transazioni serializzate nel database simulato e non riproducono i tentativi automatici di Firestore. Il solo cambio di marchio mantiene invariati API, identificatori del database, storage locale e bridge nativo.

La build utilizza **Xcode 26.6 e SDK iOS 26.5**, con iOS minimo **16**. La firma è automatica per il team indicato; gli identificatori della scheda e del progetto devono rimanere invariati negli aggiornamenti. L’icona App Store è quadrata, opaca, a 1024 × 1024 pixel. Per ricreare e caricare l’archivio seguire il [README iOS](../Tommi38IOS/README.md). [Requisiti Apple per gli upload](https://developer.apple.com/news/upcoming-requirements/).

## Passaggi rimanenti per la build 2

1. Distribuire la correzione del percorso pubblico dell’icona v3 e verificare che tutte le risorse della cache PWA siano accessibili.
2. Ricontrollare la build 2 già elaborata e associata alla versione 1.0.
3. Aggiornare i testi della scheda e sostituire le schermate iPhone e iPad con acquisizioni del nuovo marchio.
4. Ricontrollare l’accesso dimostrativo e le dichiarazioni già salvate, senza riportare credenziali nei file.
5. Usare **Aggiungi per la verifica** e poi **Invia per la verifica**; registrare qui il nuovo identificativo di invio e lo stato effettivamente confermato.

Il primo pulsante prepara la bozza di invio; solo il secondo la trasmette ad Apple. La disponibilità pubblica richiede la successiva approvazione. [Inviare un’app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).
