# Stabilimenti e gestori

L’account esistente `admin` di Tommi38 è quello indicato dal proprietario per l’amministrazione globale. L’assegnazione iniziale usa una transazione che attribuisce soltanto a quell’account il flag `platformAdmin`, purché sia già un amministratore attivo. Non crea account, non cambia password, non modifica saldi. Se esiste un altro amministratore globale, si ferma. Un marcatore rende l’operazione unica: un’eventuale revoca successiva non viene annullata dai riavvii.

## Amministratore globale

Accedi al tuo account di Tommi38: la panoramica **Tutti gli stabilimenti** mostra gli stabilimenti, il loro stato e i rispettivi gestori. La dicitura **Amministratore globale** distingue questo accesso da quello dei gestori locali.

Da **Crea stabilimento**, inserisci nome, codice univoco, username e password iniziale del gestore. La password richiede almeno 12 caratteri e al massimo 72 byte, viene salvata con bcrypt e non viene restituita nelle risposte. Comunicala al proprietario tramite un canale riservato. La creazione prepara insieme stabilimento, gestore e configurazione iniziale; i campi si aggiungono dalla gestione del nuovo stabilimento.

Puoi modificare il nome di uno stabilimento oppure sospenderne e riattivarne l’accesso. La sospensione conserva i dati e impedisce l’accesso a utenti e gestori locali. L’amministratore globale può ancora aprirne la gestione. Tommi38 rimane attivo per consentire l’accesso all’amministrazione globale.

Premi **Gestisci stabilimento →** sulla scheda desiderata. Il nome e il banner di gestione indicano sempre lo stabilimento attivo; **Tutti gli stabilimenti** riporta alla panoramica. Da qui puoi aprirne un altro senza usare le credenziali dei suoi gestori.

### Contesto di gestione e identità

L’accesso globale conserva l’account originale anche mentre gestisce un altro stabilimento. Le operazioni riguardano soltanto lo stabilimento selezionato e le registrazioni amministrative mantengono l’identità di chi le esegue. Non viene creato un account locale e non si assume l’identità di un utente con lo stesso username.

Nel contesto di gestione, le azioni personali come cambio della propria password, richiesta di crediti, lista d’attesa e prenotazione personale sono escluse. Per prenotare per qualcuno usa l’agenda amministrativa e scegli esplicitamente l’utente locale. Le funzioni amministrative continuano a consentire gestione degli utenti, crediti, recupero accesso e moderazione dei gruppi.

Il contesto è conservato dal server nella sessione e viene ripristinato al ricaricamento. Se cambi stabilimento in una scheda, una richiesta rimasta aperta sullo stabilimento precedente viene rifiutata: ricarica quella scheda per riallinearla. Disabilitazione, eliminazione, reset password o revoca dell’account globale impediscono di continuare a operare nel contesto selezionato.

### Creare utenti e assegnare gestori

Apri lo stabilimento e poi **Utenti → Crea utente o gestore**. Scegli il ruolo **Utente** oppure **Gestore** insieme a username, password iniziale e crediti. Puoi anche cambiare il ruolo di un account locale esistente. Il cambio ruolo richiede un nuovo accesso sui dispositivi di quell’account.

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

Su una prenotazione confermata, **Annulla prenotazione** chiede conferma, libera il campo e conserva la prenotazione nello storico con l’autore dell’annullamento. **L’annullamento dalla gestione non rimborsa crediti automaticamente**, anche quando la prenotazione era stata pagata dall’utente. L’eventuale rettifica si esegue da **Utenti → Crediti** ed è registrata nello storico dei crediti.

## Utilizzo da telefono

La gestione usa schede e moduli adattabili allo schermo. La barra inferiore dà accesso a **Riepilogo**, **Agenda** e **Utenti**; il gestore trova anche **Gioca**, mentre l’amministratore globale dispone del collegamento **Orari**. Il nome dello stabilimento e il banner del contesto restano il riferimento prima di una modifica.

Creazione utenti, modifica dei ruoli, crediti, prenotazioni e conferme si svolgono in finestre dell’app. Le password possono essere mostrate o nascoste dai controlli dedicati. Durante un cambio di stabilimento i dati e i moduli precedenti vengono svuotati; le risposte tardive non devono ripopolare la gestione appena aperta.

## Account e compatibilità

Le registrazioni autonome sono disabilitate finché il gestore non le abilita in **Orari e regole**. I nuovi iscritti attendono l’approvazione. Il recupero accesso è assistito dal gestore, che deve verificare l’identità; non sono inviate email automatiche. Da **Avvisi → Cambia password** ogni utente può aggiornare la propria password e revocare le altre sessioni.

Le sessioni cifrate persistono in Firestore per 8 ore di inattività. Un cambio password, una disabilitazione o una revoca vengono verificati dal server a ogni richiesta. La migrazione iniziale dalle vecchie sessioni in memoria richiede un nuovo accesso. Mantenere stabile `SESSION_SECRET`. È possibile configurare una policy TTL Firestore per `_privateSessions.expiresAt` per eliminare i record abbandonati; la scadenza di accesso è applicata anche senza TTL.

Lo storico delle partite concluse/cancellate inizia con l’introduzione dell’agenda: le prenotazioni eliminate dalle versioni precedenti non sono recuperabili. Le partite future esistenti e i saldi sono conservati. La cancellazione da parte dell’utente entro il giorno precedente restituisce il credito addebitato; le prenotazioni inserite gratuitamente dalla gestione non danno diritto a un rimborso.

La lista d’attesa si aggiorna mentre l’app è aperta; non prenota automaticamente. I promemoria nativi iPhone esistenti sono conservati. Questa versione non introduce notifiche web push, pagamenti online o recupero password via email.

## Pubblicazione e verifiche

Repository: `isaacbis/tommi38`, ramo predefinito `main`; servizio esistente Render: `tommi38`. Dopo il deploy, `/api/health` restituisce il commit attivo. Il log `Platform administrator migration` distingue l’assegnazione eseguita dalle condizioni che la impediscono.

Eseguire dalla radice: `node --test tests/*.test.cjs`. I test usano dati sintetici e un database simulato, con verifiche HTTP del server e delle sessioni; non modificano Firestore di produzione. La suite comprende cambio di contesto globale, isolamento degli account omonimi, revoche, ruoli locali, prenotazioni amministrative, rimborsi e protezioni dalle risposte tardive.

Verifiche di questa release: **75 test superati**, senza fallimenti. L’interfaccia è stata controllata nel browser a **320, 390 e 430 px**, senza overflow orizzontale né errori nella console. Sono stati verificati il passaggio globale dallo stabilimento A a B e il ripristino dopo ricaricamento, creazione e annullamento di una prenotazione amministrativa, accesso e percorsi del gestore locale e dell’utente ordinario.

Per verificare l’interfaccia con dati sintetici, avviare `node tests/preview-server.cjs 4173` e aprire `http://127.0.0.1:4173/__preview/session?persona=root`. Le altre sessioni disponibili sono `manager-a`, `manager-b` e `user-a`. Il passaggio prepara anche la scelta dello stabilimento nel browser. Il server ascolta soltanto sul computer locale, usa Express e l’applicazione reali con sessioni e database in memoria, simula il meteo e non carica Firebase o credenziali di produzione. Il riavvio ripristina i dati dimostrativi. Verificare a 320 px almeno panoramica globale, gestione A → B → panoramica, agenda, utenti e finestre di conferma.

Il server espone soltanto una lista esplicita di risorse frontend. Due vecchi file operativi sono stati rimossi e l’intera cartella interna non è più servita. Le copie nella storia Git non sono state riscritte: le credenziali eventualmente contenute in quelle copie devono essere cambiate dai titolari o tramite il gestore. Nessuna password di produzione è stata letta o cambiata durante questa modifica.
