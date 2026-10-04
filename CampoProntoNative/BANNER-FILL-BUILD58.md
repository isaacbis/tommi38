# CampoPronto ADS 2.1 (58)

Il banner occupa spazio e mostra la scritta Pubblicità solo dopo bannerViewDidReceiveAd. Prima del caricamento e dopo un errore/no-fill, l'intera riga è alta zero, invisibile e esclusa dall'accessibilità; l'istanza SDK rimane disponibile per il caricamento. Il banner caricato misura 320×50, con una riga alta 74 punti che include etichetta e margini, senza tagliare l'annuncio.

Errori: nuovo tentativo dopo 60 secondi solo mentre il cliente è in primo piano. Ritorno in primo piano riavvia un banner non caricato; richieste già in corso non vengono duplicate. Timer cancellato quando si lascia la schermata o l'app passa in background. Richieste continuano a usare consenso e pubblicità non personalizzate. Manager e demo esclusi. Nessuna modifica a premio, limite giornaliero o interstitial.

Verifiche: test sul controller Swift effettivo con SDK sostituito da stub (nascosto inizialmente/dopo errore, visibile su successo, assenza richieste duplicate anche passando in background, pulizia delegate). Cinque test backend AdMob superati. Banner Google di test ricevuto sul simulatore iPhone 18 Pro Max con user004. Nessun annuncio reale usato per test. Desktop sincronizzato.

Su richiesta dell’utente: interstitial dopo login portato a una impressione ogni 2 minuti (120 secondi), sia nel client sia nella quota AdMob, salvata e verificata. Nessun interstitial a intervalli mentre si usa l’app.
