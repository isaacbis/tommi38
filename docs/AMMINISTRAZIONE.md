# Stabilimenti e gestori

L’account esistente `admin` di Tommi38 è quello indicato dal proprietario per l’amministrazione globale. L’assegnazione iniziale usa una transazione che attribuisce soltanto a quell’account il flag `platformAdmin`, purché sia già un amministratore attivo. Non crea account, non cambia password, non modifica saldi. Se esiste un altro amministratore globale, si ferma. Un marcatore rende l’operazione unica: un’eventuale revoca successiva non viene annullata dai riavvii.

## Amministratore globale

Accedi al tuo account di Tommi38: la panoramica **Tutti gli stabilimenti** mostra gli stabilimenti, il loro stato e i rispettivi gestori. La dicitura **Amministratore globale** distingue questo accesso da quello dei gestori locali.

Da **Crea stabilimento**, inserisci nome, codice univoco, username e password iniziale del gestore. La password richiede almeno 12 caratteri e al massimo 72 byte, viene salvata con bcrypt e non viene restituita nelle risposte. Comunicala al proprietario tramite un canale riservato. La creazione prepara insieme stabilimento, gestore e configurazione iniziale; i campi si aggiungono dalla gestione del nuovo stabilimento.

Ogni scheda propone **Gestisci →** e **Opzioni**. Da **Opzioni** puoi consultare tutti i gestori e il loro stato, modificare il nome dello stabilimento oppure sospenderne e riattivarne l’accesso. La sospensione conserva i dati e impedisce l’accesso a utenti e gestori locali. L’amministratore globale può ancora aprirne la gestione. Tommi38 rimane attivo per consentire l’accesso all’amministrazione globale.

Premi **Gestisci →** sulla scheda desiderata. Il nome e il banner di gestione indicano sempre lo stabilimento attivo; **Tutti gli stabilimenti** riporta alla panoramica. Da qui puoi aprirne un altro senza usare le credenziali dei suoi gestori. Usa **Indietro** e **Avanti** sotto l’elenco per raggiungere gli altri stabilimenti.

### Contesto di gestione e identità

L’accesso globale conserva l’account originale anche mentre gestisce un altro stabilimento. Le operazioni riguardano soltanto lo stabilimento selezionato e le registrazioni amministrative mantengono l’identità di chi le esegue. Non viene creato un account locale e non si assume l’identità di un utente con lo stesso username.

Nel contesto di gestione, le azioni personali come cambio della propria password, richiesta di crediti, lista d’attesa e prenotazione personale sono escluse. Per prenotare per qualcuno usa l’agenda amministrativa e scegli esplicitamente l’utente locale. Le funzioni amministrative continuano a consentire gestione degli utenti, crediti, recupero accesso e moderazione dei gruppi.

Il contesto è conservato dal server nella sessione e viene ripristinato al ricaricamento. Se cambi stabilimento in una scheda, una richiesta rimasta aperta sullo stabilimento precedente viene rifiutata: ricarica quella scheda per riallinearla. Disabilitazione, eliminazione, reset password o revoca dell’account globale impediscono di continuare a operare nel contesto selezionato.

### Creare utenti e assegnare gestori

Apri lo stabilimento e poi **Utenti → Crea utente o gestore**. Scegli il ruolo **Utente** oppure **Gestore** insieme a username, password iniziale e crediti. Puoi anche cambiare il ruolo di un account locale esistente da **Gestisci → Cambia ruolo**. Il cambio ruolo richiede un nuovo accesso sui dispositivi di quell’account.

Nell’elenco utenti, **Crediti** apre la rettifica del saldo; **Gestisci** raccoglie password, rinomina e abilitazione o disabilitazione dell’account. Per un’iscrizione in attesa compare l’approvazione. Il cambio di ruolo è disponibile all’amministratore globale. La ricerca per username e i pulsanti di paginazione permettono di raggiungere ogni account.

Il ruolo **Gestore** vale soltanto nello stabilimento selezionato. Questi comandi non assegnano il privilegio globale e non consentono di alterare il ruolo dell’account globale protetto di Tommi38.

## Gestore dello stabilimento

Seleziona il tuo stabilimento all’apertura e accedi con le credenziali ricevute. La gestione mostra **Amministratore del tuo stabilimento**, il nome dello stabilimento e il riepilogo della giornata. Puoi:

- Aggiungere campi, impostare orari di apertura/chiusura, durata delle partite e limiti di prenotazione.
- Consultare l’agenda, prenotare per un utente attivo e annullare prenotazioni del tuo stabilimento.
- Creare utenti ordinari, approvare le iscrizioni se abilitate, aggiungere o rimuovere crediti, impostare password e gestire richieste di assistenza.
- Creare pacchetti crediti e approvare o rifiutare le richieste di ricarica. Ogni approvazione accredita una sola volta e registra il movimento. Non viene effettuato un pagamento online.
- Vedere statistiche correnti e programmare chiusure dei campi. Le fasce già prenotate non possono essere chiuse; i campi con prenotazioni attive non possono essere rimossi. La durata delle partite può cambiare quando non ci sono prenotazioni attive.

Ogni gestore accede soltanto ai dati del proprio stabilimento e può creare soltanto utenti ordinari. Non può assegnare altri gestori, creare stabilimenti o aprire un contesto globale. Un nome utente uguale in due stabilimenti identifica due account distinti. Per cambiare stabilimento occorre uscire e accedere con un account di quello stabilimento.

## Agenda: prenotazioni e annullamenti

Apri **Agenda prenotazioni**, scegli **Oggi**, **Domani** o una data e, se serve, filtra per campo. Ogni scheda mostra orario, campo, titolare e stato **Confermata**, **Conclusa** oppure **Cancellata**. Le date seguono il fuso orario di Roma. Gli utenti ordinari vedono la disponibilità senza i nomi di chi ha prenotato altri posti.

Per creare una prenotazione dall’agenda, scegli un utente attivo dello stabilimento, giorno, campo e uno degli orari disponibili. Il server verifica nuovamente disponibilità, orari e chiusure quando confermi. La prenotazione è intestata all’utente scelto e registra separatamente l’amministratore che l’ha inserita.

**Le prenotazioni inserite dalla gestione non scalano crediti.** Anche il successivo annullamento da parte dell’utente non può generare il rimborso di un credito mai addebitato. Le prenotazioni personali degli utenti ordinari continuano a costare 1 credito.

Su una prenotazione confermata, **Annulla** apre la conferma dell’annullamento, libera il campo e conserva la prenotazione nello storico con l’autore dell’annullamento. **L’annullamento dalla gestione non rimborsa crediti automaticamente**, anche quando la prenotazione era stata pagata dall’utente. L’eventuale rettifica si esegue da **Utenti → Crediti** ed è registrata nello storico dei crediti.

## Chiusure per un periodo

Apri **Statistiche e chiusure → Nuova chiusura**, scegli il campo e indica le date **Dal** e **Al**, entrambe comprese. Per chiudere un solo giorno, usa la stessa data nei due campi. La data iniziale può essere oggi o una data futura e quella finale deve essere uguale o successiva.

**Intera giornata** blocca tutti gli orari del campo in ciascuna data del periodo. Disattivala per indicare una fascia **Dalle–Alle** che si ripete ogni giorno: per esempio, dal 17 al 19 settembre, dalle 14:00 alle 16:00, chiude quella fascia il 17, il 18 e il 19. L’ora finale deve seguire quella iniziale. Le prenotazioni che terminano esattamente all’inizio della chiusura o iniziano esattamente alla sua fine rimangono consentite.

Inserisci il motivo e premi **Blocca periodo**. Se una prenotazione esistente del campo si sovrappone alla fascia anche in un solo giorno, l’intero inserimento viene rifiutato: nessuna parte della chiusura viene applicata. Le prenotazioni personali e quelle create dalla gestione rispettano entrambe il periodo bloccato; anche la lista d’attesa tiene conto delle chiusure.

La scheda **Programmate** mostra date, fascia giornaliera e motivo. **Riapri periodo** chiede conferma e rimuove quella chiusura da tutte le date indicate. Le chiusure a giorno singolo già esistenti restano valide, visibili e rimovibili. Un periodo già iniziato rimane elencato fino alla sua data finale.

## Utilizzo da telefono

La gestione usa schede e moduli adattabili allo schermo. La barra inferiore dà accesso a **Riepilogo**, **Agenda** e **Utenti**; il gestore trova anche **Gioca**, mentre l’amministratore globale dispone del collegamento **Orari**. Il nome dello stabilimento e il banner del contesto restano il riferimento prima di una modifica.

Gli elenchi sono suddivisi in pagine con **Indietro**, indicatore della pagina corrente e **Avanti**. Il numero di elementi visibili si adatta allo spazio disponibile. La paginazione riguarda stabilimenti, utenti, agenda, partite, ricerche di giocatori, attesa, movimenti dei crediti e gli altri elenchi di gestione. Quando l’aggiornamento restituisce lo stesso elenco, la pagina scelta viene conservata. Cambiare stabilimento o i filtri di giorno e campo apre il relativo elenco dall’inizio.

Gli orari di prenotazione usano una griglia completa senza comandi di paginazione. Se la configurazione genera molti orari, la griglia dispone di uno scorrimento interno per raggiungerli tutti.

La **Home** ha quattro schede:

- **Riepilogo**: saldo, numero di partite, gruppi aperti e prossima partita, con i collegamenti per prenotare e trovare giocatori.
- **Crediti**: movimenti del saldo e richiesta di ricarica.
- **Attesa**: posti seguiti, stato della disponibilità e comandi per prenotare o lasciare la lista.
- **Avvisi**: comunicazione del gestore.

In **Cerca giocatori**, le tre schede **Aperte**, **Le tue** e **Richieste** separano le partite a cui partecipare, le proprie ricerche da gestire e le richieste di partecipazione inviate. Ogni elenco mantiene i propri comandi e la propria paginazione.

**Statistiche e chiusure** apre tre schede: **Statistiche** mostra utenti, crediti e prenotazioni per campo; **Nuova chiusura** contiene il modulo per campo, periodo, intera giornata o fascia oraria e motivo; **Programmate** elenca le chiusure e permette di rimuoverle. Dopo aver bloccato un periodo si apre la scheda **Programmate**.

Creazione utenti, modifica dei ruoli, crediti, prenotazioni e conferme si svolgono in finestre dell’app. Le password possono essere mostrate o nascoste dai controlli dedicati. Durante un cambio di stabilimento i dati e i moduli precedenti vengono svuotati; le risposte tardive non devono ripopolare la gestione appena aperta.

## Account e compatibilità

Le registrazioni autonome sono disabilitate finché il gestore non le abilita in **Orari e regole**. I nuovi iscritti attendono l’approvazione. Il recupero accesso è assistito dal gestore, che deve verificare l’identità; non sono inviate email automatiche. Da **Avvisi → Cambia password** ogni utente può aggiornare la propria password e revocare le altre sessioni.

Le sessioni cifrate persistono in Firestore per 8 ore di inattività. Un cambio password, una disabilitazione o una revoca vengono verificati dal server a ogni richiesta. La migrazione iniziale dalle vecchie sessioni in memoria richiede un nuovo accesso. Mantenere stabile `SESSION_SECRET`. È possibile configurare una policy TTL Firestore per `_privateSessions.expiresAt` per eliminare i record abbandonati; la scadenza di accesso è applicata anche senza TTL.

Lo storico delle partite concluse/cancellate inizia con l’introduzione dell’agenda: le prenotazioni eliminate dalle versioni precedenti non sono recuperabili. Le partite future esistenti e i saldi sono conservati. La cancellazione da parte dell’utente entro il giorno precedente restituisce il credito addebitato; le prenotazioni inserite gratuitamente dalla gestione non danno diritto a un rimborso.

La lista d’attesa si aggiorna mentre l’app è aperta; non prenota automaticamente. I promemoria nativi iPhone esistenti sono conservati. Questa versione non introduce notifiche web push, pagamenti online o recupero password via email.

## Pubblicazione e verifiche

Repository: `isaacbis/tommi38`, ramo predefinito `main`; servizio esistente Render: `tommi38`. Dopo il deploy, `/api/health` restituisce il commit attivo. Il log `Platform administrator migration` distingue l’assegnazione eseguita dalle condizioni che la impediscono.

Eseguire dalla radice: `node --test tests/*.test.cjs`. I test usano dati sintetici e un database simulato, con verifiche HTTP del server e delle sessioni; non modificano Firestore di produzione. La suite comprende cambio di contesto globale, isolamento degli account omonimi, revoche, ruoli locali, prenotazioni amministrative, rimborsi e protezioni dalle risposte tardive.

La release con chiusure per periodo e griglia completa ha superato **90 test**, senza fallimenti, test saltati o annullati. La sintassi dei **17 file JavaScript applicativi** e il controllo delle differenze sono validi. I 15 nuovi test dei periodi coprono date comprese, fasce giornaliere, giornata intera, chiusure precedenti, conflitti, isolamento, concorrenza nel database simulato e annullamento delle scritture in caso di errore.

Nel browser a **320 × 568 px**, con dati sintetici, sono state verificate queste schermate e operazioni della nuova release:

- Il modulo con **Intera giornata**, date **Dal–Al**, motivo e pulsante **Blocca periodo** interamente visibile.
- Una sola chiusura del campo Tennis dal **12 al 14 settembre**: tutti i **15 orari** risultano bloccati sia il primo sia l’ultimo giorno; il **15 settembre** risultano nuovamente liberi.
- La griglia completa di **15 orari**, senza paginazione o elementi nascosti: selezionando l’ultimo orario, **19:30**, rimangono visibili conferma e navigazione. La pagina non presenta contenuti eccedenti il viewport né richiede scorrimento.
- Il tentativo di chiudere Volley dal **10 al 12 settembre**, con una prenotazione l’**11 settembre**, viene rifiutato con un messaggio di conflitto comprensibile e nessuna chiusura parziale.
- Impostando dal modulo dell’app partite di **40 minuti**, dalle **14:00 alle 20:00**, tutti i **9 orari** sono visibili in una griglia di tre colonne, senza elementi nascosti o paginazione. Dopo aver selezionato l’ultimo orario, **19:20**, il pulsante **Prenota** e la navigazione rimangono nel viewport di 320 × 568 px.
- **Riapri periodo** mostra la conferma riferita a tutte le date; dopo la conferma la chiusura scompare e l’elenco mostra **Nessuna chiusura programmata**.

Nessun errore nella console nelle verifiche finali.

Per verificare l’interfaccia con dati sintetici, avviare `node tests/preview-server.cjs 4173` e aprire `http://127.0.0.1:4173/__preview/session?persona=root`. Le altre sessioni disponibili sono `manager-a`, `manager-b` e `user-a`. Il passaggio prepara anche la scelta dello stabilimento nel browser. Il server ascolta soltanto sul computer locale, usa Express e l’applicazione reali con sessioni e database in memoria, simula il meteo e non carica Firebase o credenziali di produzione. Il riavvio ripristina i dati dimostrativi. Verificare a 320 px almeno panoramica globale, gestione A → B → panoramica, agenda, utenti e finestre di conferma.

Il server espone soltanto una lista esplicita di risorse frontend. Due vecchi file operativi sono stati rimossi e l’intera cartella interna non è più servita. Le copie nella storia Git non sono state riscritte: le credenziali eventualmente contenute in quelle copie devono essere cambiate dai titolari o tramite il gestore. Nessuna password di produzione è stata letta o cambiata durante questa modifica.
