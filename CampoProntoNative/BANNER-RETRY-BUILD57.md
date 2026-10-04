# CampoPronto ADS 2.1 (57)

Verifica del problema segnalato: build 56 disponibile su TestFlight, AdMob app Pronta, banner production correttamente collegato. Utente conferma che il banner è successivamente comparso sul proprio telefono con build 56. Nessun problema di distribuzione. Non attribuita una causa certa alla mancata visualizzazione iniziale.

Correzione aggiuntiva: inizializzazione pubblicità completata solo dopo risposta API e consenso riusciti; fino a tre tentativi per errori transitori con pause 5/15 secondi. Se non riesce, riprova al ritorno in primo piano. Interstitial ingresso non riproposto tardivamente durante i tentativi; accesso libero dopo primo errore. Richieste contemporanee di consenso/inizializzazione SDK condividono un'unica operazione, per evitare conflitti fra banner e video premio.

Verifiche: build Debug e archivio Release firmato riusciti; cinque test backend AdMob superati. Nessuna modifica al premio di un credito, ai limiti, ai blocchi AdMob o al layout. Desktop sincronizzato. Simulatore spento dall'utente prima dell'ulteriore verifica visiva; layout già verificato nella 56.
