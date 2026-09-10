# Tommi38 — preparazione App Store

Bozza italiana aggiornata il **10 settembre 2026**. I testi descrivono le funzioni dell’applicazione; le verifiche native, gli screenshot e le dichiarazioni del titolare devono corrispondere alla build effettivamente inviata. Questo documento non attesta una pubblicazione o un’approvazione Apple.

## Dati ricevuti dal titolare

| Campo | Valore comunicato | Stato |
| --- | --- | --- |
| Nome app | Tommi38 | Proposto per la scheda |
| Lingua principale | Italiano | Scelta comunicata |
| Titolare | Isaac Morganti | Confermato dal titolare |
| Assistenza e privacy: email pubblica | isaacmorg93@virgilio.it | Confermata dal titolare |
| Natura del progetto | Personale, non commerciale | Dichiarazione del titolare |
| Bundle ID | `isaacmorganti.Tommi38IOS` | Da confrontare con scheda e build finali |
| SKU | `tommi38-ios` | Scelta comunicata per la nuova scheda |
| Apple ID della scheda | `6810684742` | Creazione confermata nel lavoro principale |
| Versione App Store | `1.0` | Scheda preparata; build finale da associare |
| Prezzo e disponibilità | Gratuita, Italia | Impostazioni confermate nel lavoro principale |

## Metadata italiani pronti come bozza

| Campo | Testo | Lunghezza |
| --- | --- | --- |
| Nome | Tommi38 | 7 caratteri |
| Sottotitolo | Prenota campi, trova giocatori | 30 caratteri |
| Categoria principale proposta | Sport / Sports | Da confermare nella scheda |
| Parole chiave | sport,tennis,beach volley,disponibilità,agenda,organizzazione,crediti,gruppi,attesa | 84 byte UTF-8 |

Nome e sottotitolo ammettono al massimo 30 caratteri. [Apple: informazioni dell’app](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information).

### Testo promozionale

Scegli lo stabilimento, prenota il tuo campo e organizza la partita. Controlla crediti, richieste e lista d’attesa in un’unica app.

### Descrizione

Tommi38 ti aiuta a organizzare le partite e a prenotare i campi sportivi degli stabilimenti che usano il servizio.

Scegli il tuo stabilimento e accedi con il relativo account. Consulta i campi e gli orari disponibili, seleziona la fascia che preferisci e conferma la prenotazione. Ritrovi le tue partite e lo storico nell’app e puoi annullare una prenotazione secondo le regole dello stabilimento.

CERCA GIOCATORI
Apri una ricerca per la tua partita, consulta quelle disponibili e invia una richiesta di partecipazione. Gestisci le tue ricerche e le richieste ricevute dalle sezioni dedicate.
Puoi segnalare contenuti al gestore e bloccare altri account nello stabilimento. Il blocco nasconde reciprocamente ricerche e contatti e impedisce nuove interazioni.

CREDITI E LISTA D’ATTESA
Controlla il saldo e i movimenti dei crediti e invia al gestore una richiesta di ricarica. I crediti servono alle prenotazioni di campi fisici presso lo stabilimento: non sbloccano contenuti digitali. L’app non effettua pagamenti online.
Se l’orario che desideri è occupato, puoi seguirlo nella lista d’attesa e controllarne la disponibilità mentre usi l’app. La prenotazione richiede sempre una tua conferma.

PROMEMORIA SU IPHONE
Puoi autorizzare i promemoria locali sul dispositivo per ricordarti le prenotazioni. La lista d’attesa non invia notifiche push dal server.

PER GLI STABILIMENTI
Gli account abilitati alla gestione dispongono di agenda, gestione degli utenti e dei crediti, configurazione dei campi e degli orari, statistiche e chiusure programmate, anche per più giorni. Ogni account opera nello stabilimento a cui appartiene; l’amministratore globale può gestire gli stabilimenti autorizzati.

Per usare il servizio occorrono una connessione internet e un account attivo nello stabilimento scelto. La registrazione è disponibile quando il gestore la abilita e può richiedere la sua approvazione. Disponibilità, accesso e condizioni delle prenotazioni dipendono dallo stabilimento.

### Limiti e campi da completare

Il testo promozionale ha 131 caratteri; il limite è 170. La descrizione deve rimanere testo semplice entro 4.000 caratteri; le parole chiave hanno un limite di 100 byte. Per la prima versione non si compila “Novità”; negli aggiornamenti il testo dovrà descrivere i cambiamenti effettivi. L’URL di assistenza deve mostrare recapiti reali: l’email da sola non sostituisce il campo URL. [Apple: proprietà della versione](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

Le pagine di assistenza e privacy sono preparate nella release ai percorsi `/support.html` e `/privacy.html`. Dopo averne verificato la pubblicazione, i relativi URL per la scheda sono `https://tommi38.onrender.com/support.html` e `https://tommi38.onrender.com/privacy.html`. Build, screenshot, categorie, dichiarazioni e copyright definitivo restano da completare. Non sono stati inventati numeri di telefono.

## Screenshot da produrre

Apple richiede da 1 a 10 screenshot JPEG/JPG/PNG, senza trasparenza. Per iPhone 6,9″ sono accettati, in verticale, **1320 × 2868**, **1290 × 2796** oppure **1260 × 2736** pixel; si può preparare un insieme coerente a una di queste dimensioni. Se non si fornisce la classe 6,9″, la tabella Apple prevede la classe 6,5″. Se la build supporta iPad, servono anche screenshot iPad 13″: **2064 × 2752** oppure **2048 × 2732** pixel. Le dimensioni orizzontali sono invertite. [Apple: specifiche screenshot](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

Proposta editoriale, da acquisire nella build iOS con dati sintetici:

| Ordine | Schermata reale | Didascalia proposta |
| --- | --- | --- |
| 1 | Campo, data e griglia completa degli orari | Il tuo prossimo campo, a portata di mano |
| 2 | Le proprie prenotazioni con una partita futura | Le tue partite sempre in ordine |
| 3 | Cerca giocatori, elenco con ricerche dimostrative | Trova giocatori per la tua partita |
| 4 | Home, scheda Crediti con movimenti sintetici | Controlla il saldo e le richieste |
| 5 | Home, scheda Attesa | Segui gli orari che ti interessano |
| 6 | Selezione dello stabilimento | Scegli dove giocare |

Un’eventuale schermata della gestione va indicata come riservata ai gestori. Le immagini finali devono mostrare funzioni disponibili nella build, senza credenziali, contatti o prenotazioni di persone reali. Acquisire alla risoluzione richiesta; le precedenti verifiche web a 320 px non costituiscono screenshot App Store. Nessun file screenshot viene dichiarato pronto da questo documento.

## Accesso e note per App Review

Occorre preparare un account dimostrativo attivo, con dati sintetici, crediti sufficienti e almeno un campo prenotabile, senza dipendere dall’approvazione manuale di una registrazione. Apple richiede credenziali dimostrative che non scadano quando l’app necessita dell’accesso; eventuali account aggiuntivi si descrivono nelle note. Servono anche nome, email e telefono del referente per la revisione. [Apple: informazioni per App Review](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

Il lavoro principale conferma l’inserimento di un account di revisione e dei contatti in App Store Connect. Le credenziali restano nei campi riservati e non vengono riportate nel repository. Resta da verificare il percorso completo con l’account scelto e da completare le istruzioni senza segnaposto. La fixture locale `127.0.0.1` usata per i test non è raggiungibile da Apple: le prove della revisione richiedono dati accessibili dalla build e non devono occupare campi reali. Un eventuale accesso gestore va limitato ai dati dimostrativi.

Bozza delle note, da completare dopo aver provato il percorso:

> Tommi38 consente di prenotare campi sportivi fisici presso gli stabilimenti presenti nel servizio. All’apertura selezionare [STABILIMENTO DIMOSTRATIVO DA PREPARARE] e usare le credenziali inserite nei campi di accesso per la revisione.
>
> Per verificare una prenotazione: aprire Prenota, scegliere [CAMPO DIMOSTRATIVO], una data disponibile e un orario, quindi confermare. L’account dispone di crediti dimostrativi. È possibile consultare le proprie prenotazioni, cercare giocatori e utilizzare la lista d’attesa con i dati di prova predisposti.
>
> I crediti sono utilizzati esclusivamente per prenotazioni di servizi sportivi svolti fisicamente presso lo stabilimento. L’app non vende contenuti digitali e non contiene pagamenti online; le richieste di ricarica sono gestite dallo stabilimento.
>
> Su iPhone i promemoria delle prenotazioni sono notifiche locali autorizzate dall’utente. Non è presente un servizio server di notifiche push per la lista d’attesa.
>
> Privacy, assistenza e regole sono raggiungibili dai collegamenti dell’app. L’area account permette di avviare “Elimina il tuo account”, confermando username, password attuale e cancellazione definitiva. In Cerca giocatori, “Segnala / blocca” apre le azioni sul contenuto; “Sicurezza” permette di gestire i propri blocchi. I gestori trovano “Segnalazioni” nel menu di amministrazione.

## Privacy: inventario da validare

Sono necessari un URL pubblico dell’informativa e le risposte “Privacy dell’app” in App Store Connect, comprensive dei soggetti terzi coinvolti. [Apple: gestione privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).

I dati inviati al backend e conservati rientrano nell’analisi: l’inclusione delle schermate in una webview non li esclude dalle dichiarazioni Apple. Anche l’assenza di pubblicità non equivale all’assenza di raccolta dati. [Apple: dettagli privacy](https://developer.apple.com/app-store/app-privacy-details/).

| Dati presenti o da verificare | Uso dell’app | Stato per la dichiarazione |
| --- | --- | --- |
| Username, hash della password, appartenenza allo stabilimento, ruolo e stato account | Accesso e autorizzazioni | Identificativo utente collegato all’account; validare categoria e finalità |
| Nomi, telefono e note inseriti nelle richieste di partecipazione | Organizzazione delle partite | Verificare dati di contatto e contenuti degli utenti, destinatari e visibilità |
| Prenotazioni, cronologia, crediti e richieste di ricarica | Erogazione del servizio e gestione del saldo | Definire categorie Apple e conservazione; non equivalgono a dati di pagamento con carta |
| Richieste di recupero accesso o assistenza | Supporto gestito dallo stabilimento | Verificare contenuto, accesso e tempi di conservazione |
| Segnalazioni, testo contestato, blocchi e attribuzione della moderazione | Sicurezza della community | Dati collegati agli account; il report non duplica il telefono della partecipazione |
| Sessioni, registrazioni tecniche, eventuali IP e servizi esterni | Funzionamento e sicurezza | Completare l’audit di server, hosting, database e codice nativo |
| Preferenze e promemoria locali | Funzioni del dispositivo | Distinguere dati solo sul dispositivo da dati delle prenotazioni presenti sul server |

L’audit del codice ha rilevato Render e Google Firebase/Firestore, immagini esterne da URL impostati dai gestori e collegamenti telefono/WhatsApp aperti su azione dell’utente. Il meteo usa coordinate fisse tramite il server, senza acquisire la posizione del dispositivo. Non sono stati rilevati SDK pubblicitari, analytics o IDFA. La sessione scade dopo otto ore di inattività; questo non dimostra l’eliminazione fisica immediata di ogni record scaduto. Non sono codificati termini automatici di conservazione per ogni storico o lista d’attesa scaduta.

Il manifest nativo preparato nell’audit elenca Name, PhoneNumber, UserID, OtherUserContent, CustomerSupport, PurchaseHistory, ProductInteraction e PhotosOrVideos, collegati all’utente per AppFunctionality, senza tracking. Le dichiarazioni App Store Connect vanno completate e confrontate con la build finale, includendo la componente web. I promemoria sono locali e si riallineano quando l’app si sincronizza; non garantiscono aggiornamenti istantanei per modifiche effettuate altrove mentre l’app è chiusa.

Questa tabella è un inventario operativo, non una dichiarazione privacy già approvata da Apple. Il titolare è **Isaac Morganti**, contattabile per assistenza e privacy a **isaacmorg93@virgilio.it**; l’informativa preparata deve restare coerente con i fornitori, la gestione degli stabilimenti e la conservazione effettiva. Non selezionare “Dati non raccolti” sulla sola base del funzionamento della parte nativa.

## Verifiche richieste prima dell’invio

| Area | Verifica da chiudere |
| --- | --- |
| Eliminazione account | Implementata l’iniziativa nell’app e la rimozione dei dati dello stabilimento, con procedura riprendibile dopo errori. Per proprietario globale e ultimo gestore viene registrata una richiesta di passaggio di gestione prima della cancellazione: verificare la gestione operativa di questi casi e il percorso nella build. La sola disattivazione non soddisfa il requisito. [Apple: eliminazione account](https://developer.apple.com/support/offering-account-deletion-in-your-app/) |
| Contenuti degli utenti | Implementati filtro di base su note e nomi, segnalazioni con motivi predefiniti, blocchi reciproci e coda gestore con oscuramento ricerca, disabilitazione account e archiviazione. Le pagine pubbliche indicano regole e contatto. Il titolare deve assicurare la presa in carico tempestiva; i test software non dimostrano il servizio umano di moderazione. [Linee guida Apple, 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) |
| Crediti per campi fisici | Il modello descritto riguarda servizi consumati fuori dall’app: documentare questa destinazione nelle note per Apple e mantenere coerente il flusso. [Linee guida Apple, 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods) |
| Utilità dell’app nativa | Verificare esperienza completa, qualità e valore d’uso della build iOS; l’approvazione non è garantita dal solo inserimento di un sito in una webview. [Linee guida Apple, 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality) |
| Classificazione per età | Compilare il questionario con le interazioni e i contenuti effettivi; non assegnare automaticamente una fascia o la categoria Bambini. [Apple: classificazione per età](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/) |
| Crittografia | Completare il questionario di esportazione in base alla build, incluso l’uso della crittografia del sistema. Stabilire l’eventuale esenzione prima di impostare la relativa dichiarazione; HTTPS non giustifica una risposta “nessuna crittografia”. [Apple: conformità delle esportazioni](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance) |
| Distribuzione UE | Il titolare dichiara un progetto personale non commerciale. Confermare la dichiarazione DSA appropriata in App Store Connect; per chi opera come trader sono richiesti recapiti verificati e pubblicati nella scheda UE. [Apple: requisiti DSA](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/) |
| Build e firma | Dal 28 aprile 2026 Apple richiede Xcode 26 o successivo con SDK iOS 26 o successivo per gli upload. Verificare toolchain, firma, identificativi, icona, dispositivi supportati e build archiviata. Il requisito SDK non impone lo stesso valore come versione minima di iOS supportata. [Apple: requisiti in vigore](https://developer.apple.com/news/upcoming-requirements/) |

## Materiale ancora da completare

- Verifica pubblica delle pagine di assistenza, privacy e regole e inserimento degli URL nella scheda.
- Verifica dell’account di revisione già inserito e istruzioni complete senza segnaposto; contatti riservati mantenuti in App Store Connect.
- Risposte privacy, età, esportazione e DSA; categoria e copyright confermati. Prezzo gratuito e distribuzione Italia risultano già impostati.
- Screenshot nativi nelle classi richieste dai dispositivi supportati, icona e build firmata associata alla versione corretta.
- Esiti verificati dei percorsi di eliminazione account e moderazione, insieme alla prova delle funzioni principali nella build iOS.

La suite della release ha superato **127 test su 127**, senza fallimenti, test saltati o annullati. Sono inclusi **17 test UGC** su blocchi reciproci, isolamento degli stabilimenti, visibilità dei contatti, segnalazioni, moderazione, rinomina e riutilizzo degli username, oltre alle interazioni con la cancellazione concorrente. La sintassi dei **17 JavaScript applicativi** e il controllo delle differenze sono validi. I test di concorrenza usano transazioni serializzate nel database simulato; non riproducono i tentativi automatici di Firestore. Gli esiti visuali e l’avvenuto upload della build vengono confermati separatamente nel lavoro di pubblicazione: non sono impliciti nella presenza di questo documento.

In App Store Connect si completa la versione con i metadata richiesti e la build corretta, poi si usa **Add for Review** e infine **Submit for Review**: il primo passaggio prepara la bozza, il secondo la invia. Questo documento non esegue tali operazioni. [Apple: inviare un’app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).
