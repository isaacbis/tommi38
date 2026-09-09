# Stabilimenti e gestori

L’account esistente `admin` di Tommi38 è quello indicato dal proprietario per l’amministrazione centrale. Al primo avvio di questa versione, una transazione assegna soltanto a quell’account il flag `platformAdmin`, purché sia già un amministratore attivo. Non crea account, non cambia password, non modifica saldi. Se esiste un altro amministratore centrale, si ferma. Un marcatore rende l’operazione unica: un’eventuale revoca successiva non viene annullata dai riavvii.

## Amministratore centrale

Dalla Home, apri **I tuoi stabilimenti → Aggiungi uno stabilimento**. Inserisci nome, codice univoco, username e password iniziale del gestore. La password richiede almeno 12 caratteri, viene salvata con bcrypt e non viene restituita nelle risposte. Comunicala al proprietario tramite un canale riservato. Puoi rinominare uno stabilimento oppure sospenderne e riattivarne l’accesso; la sospensione conserva tutti i dati. Tommi38 rimane attivo per consentire l’accesso all’amministrazione centrale.

## Gestore

Seleziona il tuo stabilimento all’apertura e accedi con le credenziali ricevute. Da **Gestisci stabilimento** puoi:

- Aggiungere campi, impostare orari di apertura/chiusura, durata delle partite e limiti di prenotazione.
- Consultare **Agenda prenotazioni** per oggi, domani o qualsiasi data, filtrare per campo e vedere chi ha prenotato, con stato confermata, conclusa o cancellata.
- Creare utenti ordinari, approvare le iscrizioni se abilitate, aggiungere o rimuovere crediti, impostare password e gestire richieste di assistenza.
- Creare pacchetti crediti e approvare o rifiutare le richieste di ricarica. Ogni approvazione accredita una sola volta e registra il movimento. Non viene effettuato un pagamento online.
- Vedere statistiche correnti e programmare chiusure dei campi. Le fasce già prenotate non possono essere chiuse; i campi con prenotazioni attive non possono essere rimossi. La durata delle partite può cambiare quando non ci sono prenotazioni attive.

Ogni gestore può accedere soltanto ai dati del proprio stabilimento. Un nome utente uguale in due stabilimenti identifica due account distinti. Il ruolo di gestore non concede l’amministrazione centrale.

## Account e compatibilità

Le registrazioni autonome sono disabilitate finché il gestore non le abilita in **Orari e regole**. I nuovi iscritti attendono l’approvazione. Il recupero accesso è assistito dal gestore, che deve verificare l’identità; non sono inviate email automatiche. Da **Avvisi → Cambia password** ogni utente può aggiornare la propria password e revocare le altre sessioni.

Le sessioni cifrate persistono in Firestore per 8 ore di inattività. Un cambio password, una disabilitazione o una revoca vengono verificati dal server a ogni richiesta. Il primo deploy di questa versione richiede di accedere nuovamente, perché le vecchie sessioni erano soltanto in memoria. Mantenere stabile `SESSION_SECRET`. È possibile configurare una policy TTL Firestore per `_privateSessions.expiresAt` per eliminare i record abbandonati; la scadenza di accesso è applicata anche senza TTL.

Lo storico delle partite concluse/cancellate inizia con questa versione: le prenotazioni eliminate dalle versioni precedenti non sono recuperabili. Le partite future esistenti e i saldi sono conservati. Una prenotazione utente costa 1 credito; la cancellazione da parte dell’utente entro il giorno precedente restituisce il credito. La politica di rimborso preesistente non cambia.

La lista d’attesa si aggiorna mentre l’app è aperta; non prenota automaticamente. I promemoria nativi iPhone esistenti sono conservati. Questa versione non introduce notifiche web push, pagamenti online o recupero password via email.

## Pubblicazione e verifiche

Repository: `isaacbis/tommi38`, ramo predefinito `main`; servizio esistente Render: `tommi38`. Dopo il deploy, `/api/health` restituisce il commit attivo. Il log `Platform administrator migration` distingue l’assegnazione eseguita dalle condizioni che la impediscono.

Eseguire dalla radice: `node --test tests/*.test.cjs`. I test usano dati sintetici e un database simulato, con verifiche HTTP del server e delle sessioni; non modificano Firestore di produzione. L’interfaccia è stata controllata nel browser a 320 px con dati dimostrativi.

Il server espone soltanto una lista esplicita di risorse frontend. Due vecchi file operativi sono stati rimossi e l’intera cartella interna non è più servita. Le copie nella storia Git non sono state riscritte: le credenziali eventualmente contenute in quelle copie devono essere cambiate dai titolari o tramite il gestore. Nessuna password di produzione è stata letta o cambiata durante questa modifica.
